import React, { useEffect, useRef, useState } from 'react';
// MatchaMaking.css is now imported once, eagerly, from App.js instead of
// here -- it's reused (class names only, no import) by MilkSelection.js and
// ToppingsStation.js too, and importing it from this file's own lazy chunk
// alongside OrderReceiptButton.css (also multi-chunk-shared) is what caused
// a webpack "Conflicting order" build failure under Vercel's CI=true. See
// App.js's own import comment for the full explanation.
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { getActionFromKeyEvent, shouldDebounceEnter } from '../gameloop/pal';
import { playButtonClick, playLiquidPouring, playMatchaWhisking, playMatchaPowderPour } from '../gameloop/sfx';
import ProgressBar from './ProgressBar';
import OrderReceiptButton from './OrderReceiptButton';
import { scoreMatchaMaking } from '../gameloop/scoring';

// Static (not yet interactive) countertop items, layered on top of the now-
// empty background art. Positions were worked out by compositing each item
// onto the background at a few candidate boxes and eyeballing the result
// (see the process notes -- each box is left/top/width/height as a % of the
// 1394x768 art, matching the milk station's percentage-box convention).
// Each item PNG has already been cropped to its own visible content (no
// leftover transparent padding), so width/height here can use the image's
// own aspect ratio without distortion.
// Base three, always available. Hojicha (added per request, order 4 onward
// only -- see hojichaUnlocked in the component below) sits at the end of
// this list, same "new one lands as the rightmost tin once unlocked"
// convention as MilkSelection.js's own BOTTLE_KEYS_WITH_STRAWBERRY. Unlike
// that file's bottle row though, there's no free space to its right to grow
// into here -- the tin cluster's right edge (86.35) already sits hard
// against the scoop spoons/bar (87.58+, see SCOOP_SPOON_LEFT/SCOOP_BAR_BOX
// below) -- so STATIC_ITEMS_WITH_HOJICHA below doesn't just append a
// same-sized fourth tin, it re-lays-out all four narrower within the exact
// same overall footprint the original three occupied (63.65 to 86.35), so
// order 4+ never needs more horizontal room than orders 1-3 already used.
const STATIC_ITEMS_BASE = [
  { key: 'cafe-grade', src: './CafeGrade.png', alt: 'Cafe grade matcha tin', left: 63.65, top: 25.66, width: 6.9, height: 19.34 },
  { key: 'classic-grade', src: './ClassicGrade.png', alt: 'Classic grade matcha tin', left: 71.55, top: 25.47, width: 6.9, height: 19.53 },
  { key: 'ceremonial-grade', src: './CeremonialGrade.png', alt: 'Ceremonial grade matcha tin', left: 79.45, top: 25.50, width: 6.9, height: 19.50 },
];

// Four tins packed into the same 63.65-86.35 span the three above occupy,
// matched by HEIGHT (not width -- an earlier version matched width
// instead, which left hojicha looking visibly smaller than the other three
// since HojichaGrade.png's own 303x455 canvas is squatter -- height/width
// 1.5017 -- than the other three PNGs' own ~1.54-1.56, so an equal-width
// tin came out shorter). Each tin's own width instead solves
// width_i = H * (9/16) / aspect_i (aspect_i = that tin's own pixel
// height/width -- cafe 176/114, classic 173/111, ceremonial 176/113,
// hojicha 455/303), so all four render at the exact same on-screen height,
// each keeping its own undistorted aspect ratio. H itself solves
// sum(width_i) + 3*0.75 (a fixed small gap between tins, same "sliver of
// space" sizing as MilkSelection's own BOTTLE_VISUAL_GAP) = 22.7 (the
// span's total width, i.e. 86.35 - 63.65) -> H ≈ 14.00. top is set so
// every tin's BOTTOM edge lands on the same 45.00 shelf line the three
// base tins' bottoms already share (e.g. cafe's base entry above:
// 25.66+19.34 = 45.00) -- since all four now share one height, that's just
// 45.00 - 14.00 = 31.00 for all of them, rather than a per-tin top.
const STATIC_ITEMS_WITH_HOJICHA = [
  { key: 'cafe-grade', src: './CafeGrade.png', alt: 'Cafe grade matcha tin', left: 63.65, top: 31.0, width: 5.102, height: 14.0 },
  { key: 'classic-grade', src: './ClassicGrade.png', alt: 'Classic grade matcha tin', left: 69.5, top: 31.0, width: 5.052, height: 14.0 },
  { key: 'ceremonial-grade', src: './CeremonialGrade.png', alt: 'Ceremonial grade matcha tin', left: 75.3, top: 31.0, width: 5.055, height: 14.0 },
  { key: 'hojicha-grade', src: './HojichaGrade.png', alt: 'Hojicha tin', left: 81.11, top: 31.0, width: 5.245, height: 14.0 },
];

// Display name per tin, keyed the same way as STATIC_ITEMS/SCOOP_FILL_COLORS
// above -- shown as a label beneath whichever tin currently has focus (see
// focusedTin/.matcha-tin-label below), not tied to selectedTin (a tin reads
// as "selected" to the player the moment it gets its white focus halo,
// same distinction the selectedTin comment above already draws between
// focus and confirm).
const TIN_LABELS = {
  'cafe-grade': 'cafe',
  'classic-grade': 'classic',
  'ceremonial-grade': 'ceremonial',
  'hojicha-grade': 'hojicha',
};

// Small gap between a tin's own bottom edge and its label below it.
const TIN_LABEL_GAP = 2;

// Anchor for the tin-picking hint label (see showTinHint further down) --
// 75 is the middle (classic-grade) tin's own horizontal center
// (71.55 + 6.9 / 2), which also happens to land exactly on the midpoint
// between the first and third tins' centers (67.1 and 82.9), so this one
// number centers the label over the whole three-tin cluster. Sits above
// the tins (which start at top: 25.5) rather than below, in the clear
// counter/wall space there -- nothing else in STATIC_ITEMS/MOVABLE_ITEMS
// occupies top < 25.5.
const TIN_HINT_LEFT = 75;
const TIN_HINT_TOP = 13;

// Scoop gauge -- the matcha-measuring counterpart to the heater's
// .heater-temp-bar, sitting to the right of the tins with a clear gap
// (ceremonial-grade, the rightmost tin, ends at 79.45 + 6.9 = 86.35) so it
// doesn't read as part of the tin cluster itself. Vertical instead of
// horizontal since it's meant to read as a measuring column rather than a
// temperature strip, but reuses the same gray-body/thick-outline look (see
// .scoop-bar in MatchaMaking.css, mirrored off .heater-temp-bar).
// Only rendered once a tin's been confirmed with Enter/Space (see
// selectedTin state below) -- merely having a tin focused/highlighted
// isn't enough, since that also happens while just browsing between tins.
// Pushed close to the right edge of the frame (right edge lands at
// 93 + 4 = 97%, leaving a small margin). top is set to sit entirely below
// the wall/counter seam in the background art -- that seam falls around
// 33-34% of the frame (measured off MatchaBaseStation.png's own pixels,
// which map straight to container % since the art is anchored to the
// container's top edge with no top letterbox -- see .matcha-making-art) --
// 42 nudges it a bit further down from that clearance line than before,
// still keeping the whole bar (and the spoons/slider that key off its box
// below) well within the counter.
const SCOOP_BAR_BOX = { left: 93, top: 42, width: 4, height: 40 };

// Just three light gray marks now -- top, middle, and bottom of the bar --
// rather than a full evenly-spaced run. Top and bottom sit an equal 8% in
// from their respective edges (previously 10 and 6 -- an uneven leftover
// from when this was a full evenly-spaced run of 8, not deliberately
// mismatched). Middle is the exact midpoint of the other two, (8 + 92) / 2
// = 50 (previously 46, another evenly-spaced-run leftover that actually
// sat closer to the top mark than the bottom one). Values match
// SCOOP_SPOON_LINES' tickTop entries below exactly, so each mark still
// lines up with its spoon.
const SCOOP_BAR_MARKERS = [8, 50, 92];

// How long the "measured amount" fill takes to grow from empty up to the
// stopped line once the player locks in a reading (see stopScoop and
// .scoop-bar-fill below) -- a one-shot reveal rather than a continuously
// running gauge, so this is its own (shorter, eased) constant rather than
// reusing FILL_DURATION_MS.
const SCOOP_FILL_DURATION_MS = 900;

// Once the fill above finishes rising to the caught line, how much longer
// the whole measuring assembly (bar, spoons, "x N" labels) lingers on
// screen -- fully filled, nothing left animating -- before it disappears
// and the big spoon takes over (see stopScoop/scoopConfirmTimerRef in the
// component below, which schedules that swap for SCOOP_FILL_DURATION_MS +
// this, not just SCOOP_FILL_DURATION_MS on its own).
const SCOOP_CONFIRM_LINGER_MS = 1500;

// Fill color keyed to which tin (grade) was scooped from -- first/second/
// third in the same left-to-right order as STATIC_ITEMS above (cafe,
// classic, ceremonial), each a step darker/more saturated than the last so
// the higher grades read as "richer". Falls back to the mid (classic)
// shade in SCOOP_FILL_COLORS[selectedTin] lookups if selectedTin is ever
// something unexpected (defensive only -- selectedTin is always one of
// these three keys or null in practice). Exported so MilkSelection.js can
// color its own matcha-pour effect/fill to match whichever grade was
// carried over (incomingBowl.grade), instead of picking its own separate
// palette that could drift out of sync with this one.
// hojicha-grade's own tone isn't part of the cafe/classic/ceremonial
// green-gradient scale above (it's a different tea, not a grade tier) --
// sampled directly off HojichaGradeScoop.png's own recolored powder mound
// (see that file's own generation notes) rather than picked arbitrarily, so
// this flat fallback color and that image's actual appearance match.
export const SCOOP_FILL_COLORS = {
  'cafe-grade': '#CADBAF',
  'classic-grade': '#A3B979',
  'ceremonial-grade': '#809B7A',
  'hojicha-grade': '#B58A63',
};

// Three small spoon icons sitting just to the left of the bar, in the gap
// between the tins and the bar itself (tins end at 86.35, bar starts at 93
// -- see SCOOP_BAR_BOX comment above), each lined up with one of the tick
// lines above: the topmost tick (8), the true middle tick (50), and the
// bottommost tick (92). spoon.png is a 500x500 square canvas with the
// spoon's own art only filling the vertical middle (~y160-359) -- rather
// than pre-cropping the file, the box below just keeps that 1:1 aspect
// ratio (width % converted from height % by the container's 16:9 ratio,
// same trick as KETTLE_SPOUT_OFFSET elsewhere) so the art doesn't distort,
// and the top/bottom padding it carries just centers it on the tick line
// automatically.
const SCOOP_SPOON_SIZE_HEIGHT = 7.47;
const SCOOP_SPOON_SIZE = { width: SCOOP_SPOON_SIZE_HEIGHT / (16 / 9), height: SCOOP_SPOON_SIZE_HEIGHT };
const SCOOP_SPOON_LEFT = 87.58;
const SCOOP_SPOON_LINES = [
  { key: 'top', tickTop: 8 },
  { key: 'middle', tickTop: 50 },
  { key: 'bottom', tickTop: 92 },
];
// Nudges the spoons (and, since SCOOP_SPOON_LABELS derives its top from
// each item's top below, their "x N" labels along with them) up slightly
// from dead-center-on-the-tick -- they read a bit low/off relative to the
// tick lines otherwise.
const SCOOP_SPOON_VERTICAL_SHIFT = 2.5;
const SCOOP_SPOON_ITEMS = SCOOP_SPOON_LINES.map((line) => ({
  key: line.key,
  left: SCOOP_SPOON_LEFT,
  top:
    SCOOP_BAR_BOX.top +
    (line.tickTop / 100) * SCOOP_BAR_BOX.height -
    SCOOP_SPOON_SIZE.height / 2 -
    SCOOP_SPOON_VERTICAL_SHIFT,
  width: SCOOP_SPOON_SIZE.width,
  height: SCOOP_SPOON_SIZE.height,
}));

// Scoop-count labels sitting right under each spoon -- "x 1" under the
// bottom spoon (the lowest line, closest to an empty tin), counting up to
// "x 3" under the top spoon, so the gauge reads as "the higher the line,
// the more scoops it represents". top is anchored to the spoon's actual
// VISIBLE bottom edge, not its full 500x500 box -- spoon.png's own art
// only fills y160-359 of that square canvas (see the SCOOP_SPOON_SIZE
// comment above), so using the raw box's bottom edge would leave a big
// unwanted gap between the spoon and its label. Centered under the spoon
// with a wider box than the spoon itself since the text is wider than the
// spoon art.
const SCOOP_SPOON_LABEL_TEXT = { top: 'x 3', middle: 'x 2', bottom: 'x 1' };
const SCOOP_SPOON_VISIBLE_BOTTOM_FRAC = 359 / 500;
const SCOOP_SPOON_LABEL_GAP = 1.2;
const SCOOP_SPOON_LABEL_WIDTH = 6;
const SCOOP_SPOON_LABELS = SCOOP_SPOON_ITEMS.map((item) => ({
  key: item.key,
  text: SCOOP_SPOON_LABEL_TEXT[item.key],
  left: item.left + item.width / 2 - SCOOP_SPOON_LABEL_WIDTH / 2,
  top: item.top + item.height * SCOOP_SPOON_VISIBLE_BOTTOM_FRAC + SCOOP_SPOON_LABEL_GAP,
  width: SCOOP_SPOON_LABEL_WIDTH,
}));

// Big scoop spoon -- replaces the three small reference spoons once a
// reading's confirmed (see scoopConfirmed in the component below). Rather
// than compositing a colored powder overlay onto the plain Spoon.png at
// runtime (which was hard to line up with the art), this uses one
// pre-made "spoon with a mound of matcha already on it" PNG per grade --
// see SCOOP_SPOON_IMAGES -- so the powder's shape/shading/perspective is
// baked into the art itself instead of approximated with CSS. Same
// 500x500-square-canvas framing as Spoon.png (same alpha bounding box too,
// per the source PNGs), so the SCOOP_SPOON_SIZE aspect-ratio trick applies
// unchanged, just a taller box.
const BIG_SPOON_SIZE_HEIGHT = 24;
const BIG_SPOON_SIZE = { width: BIG_SPOON_SIZE_HEIGHT / (16 / 9), height: BIG_SPOON_SIZE_HEIGHT };
// It's too wide to fit in the small spoons' narrow tin/bar gap (tins end at
// 86.35, bar starts at 93 -- a ~6.65-wide slot vs. this spoon's own ~9-wide
// box), so instead of squeezing in there it starts just to the *left* of
// the bar -- BIG_SPOON_GAP short of the bar's own left edge, vertically
// centered on the bar's box -- which lands it below the tins (tins' bottom
// edge is at 45; this puts the spoon's own top at 54, a clear ~9-point
// gap) rather than overlapping them.
const BIG_SPOON_GAP = 1;
const BIG_SPOON_START = {
  left: SCOOP_BAR_BOX.left - BIG_SPOON_GAP - BIG_SPOON_SIZE.width,
  top: SCOOP_BAR_BOX.top + SCOOP_BAR_BOX.height / 2 - BIG_SPOON_SIZE.height / 2,
};

// Anchor for the "press Enter to pour" hint (see showSpoonHint further
// down) -- fixed at the spoon's own spawn spot rather than tracking its
// live (possibly dragged) position, since the highlight is only up for the
// brief idle beat right after the spoon appears and retires the instant
// beginDump runs -- same "anchor at the spot the thing first appears"
// simplicity as every other hint in this file.
const SPOON_HINT_LEFT = BIG_SPOON_START.left + BIG_SPOON_SIZE.width / 2;
const SPOON_HINT_TOP = BIG_SPOON_START.top - 8;

// One pre-made "spoon with matcha mound" image per tin/grade -- keyed the
// same way as SCOOP_FILL_COLORS above (and with the same classic-grade
// fallback), swapped in wholesale as the big spoon's image source rather
// than layered as a separate overlay.
const SCOOP_SPOON_IMAGES = {
  'cafe-grade': './CafeGradeScoop.png',
  'classic-grade': './ClassicGradeScoop.png',
  'ceremonial-grade': './CeremonialGradeScoop.png',
  'hojicha-grade': './HojichaGradeScoop.png',
};

// The finished whisked liquid's look, one pre-made image per tin/grade --
// same keying/fallback convention as SCOOP_SPOON_IMAGES above. Swapped in
// once whiskStage reaches 'done' (see .bowl-whisked-liquid in the JSX/CSS
// below), replacing the plain-color bowl-powder/bowl-water circles with an
// actual "whisked matcha" image matching whichever grade was scooped.
// Exported (along with a few other constants/helpers below) so
// MilkSelection.js can re-render this same bowl+whisk+whisked-liquid
// composition once it's sent over via the "Make Drink" drop-zone -- see
// incomingBowl in MilkSelection.js.
export const WHISKED_LIQUID_IMAGES = {
  'cafe-grade': './WhiskedCafeGrade.png',
  'classic-grade': './WhiskedClassicGrade.png',
  'ceremonial-grade': './WhiskedCeremonialGrade.png',
  'hojicha-grade': './WhiskedHojichaGrade.png',
};

// Where the mound of powder actually sits *within* the spoon art, as a
// fraction of the image's own 500x500 canvas (same coordinate space
// BIG_SPOON_SIZE's aspect-ratio math already uses) -- measured directly off
// all three PNGs above (alpha centroid of the mound region, excluding the
// handle) rather than eyeballed, since all three share this exact framing:
// (0.194, 0.605). This is well left of the box's own horizontal center
// (0.5) -- the spoon is drawn on a diagonal with the handle trailing off to
// the upper right -- which is what the falling-powder pour effect
// (pourLeft/pourTop below) anchors to instead of the box center, so it
// tracks the actual mound wherever the spoon is currently positioned
// (including any SPOON_HOVER_RIGHT_SHIFT applied to the spoon overall).
const MOUND_CENTER_FRAC = { leftFrac: 0.194, topFrac: 0.605 };

// Where the dumped matcha mound sits on top of the bowl, as a fraction of
// the bowl's own *current* MOVABLE_ITEMS box (it can be dragged anywhere --
// see bowlPos/bowlItem in the component below). Eyeballed starting guess,
// same caveat as BIG_SPOON_START above -- there's no pre-made "bowl with
// matcha in it" art yet, so this is still the plain colored-mound approach
// (see .bowl-powder in MatchaMaking.css), just for the bowl rather than the
// spoon.
const BOWL_POWDER_OFFSET = { leftFrac: 0.5, topFrac: 0.57 };
const BOWL_POWDER_SIZE_FRAC = 0.62;
// Height-to-width ratio for the matcha mound (bowlPowderWidth * this = its
// rendered height) -- a flat 0.5 read as too wide/shallow an ellipse,
// poking out past the bowl's own rounded silhouette on the sides; taller
// than wide reads as sitting inside the bowl's interior instead. The water
// pool below has its own, taller, BOWL_WATER_HEIGHT_FRAC rather than
// reusing this one -- see that constant's comment for why.
const BOWL_MOUND_HEIGHT_FRAC = 0.7;

// ---- Dump sequence: hover above the bowl, pour, *then* the bowl gets its
// mound -- see bigSpoonStage in the component below ('idle' -> 'moving' ->
// 'pouring' -> 'done'). Confirming the drop (drag onto the bowl, or
// Enter/Space) doesn't teleport the powder into the bowl instantly; it
// glides the spoon to a fixed "hovering over the bowl" spot first (still
// fully visible, not hidden), then plays a falling-powder effect for the
// whole 'pouring' stage -- during which the mound on the bowl (bowlPowder)
// is mounted and grows from empty up to full size via a CSS animation (see
// .bowl-powder in MatchaMaking.css), rather than popping in at full size
// only once pouring finishes.
const BIG_SPOON_MOVE_MS = 350; // time to glide from wherever it was to the hover spot -- comfortably longer than .big-spoon's own 0.2s left/top transition so it always finishes the glide first
const BIG_SPOON_POUR_MS = 2400; // how long the falling-powder effect (.spoon-pour) plays, and also how long the bowl mound's grow-in takes -- the two are timed to finish together
const SPOON_HOVER_GAP = 2; // gap, in container %, left between the spoon's bottom edge and the bowl's top edge while hovering -- this is also where .spoon-pour's falling grains travel
const SPOON_HOVER_RIGHT_SHIFT = 6; // nudges the hover spot right of dead-center over the bowl, in container % -- the pour effect (pourLeft) is derived from the spoon's own position, so it shifts right along with it automatically

// Centered horizontally on the bowl's own current box (plus
// SPOON_HOVER_RIGHT_SHIFT), sitting entirely above it (not overlapping)
// with SPOON_HOVER_GAP of clearance -- takes bowlPos/bowlItem as arguments
// since the bowl can be dragged anywhere before the player ever confirms a
// scoop.
function getSpoonHoverPos(bowlPos, bowlItem) {
  return {
    left: bowlPos.left + bowlItem.width / 2 - BIG_SPOON_SIZE.width / 2 + SPOON_HOVER_RIGHT_SHIFT,
    top: bowlPos.top - BIG_SPOON_SIZE.height - SPOON_HOVER_GAP,
  };
}

// Heater plate: rendered separately from the other static items because it
// carries two hotspots positioned relative to its own art (see below).
const HEATER_BOX = { left: 3, top: 51.5, width: 25, height: 17.5 };

// The heater's power button sits on the top surface, upper-left of the
// plate, centered on the molded oval drawn into the art (image x 27-91,
// y 66-89 of the 337x130 Heater.png -- see gs-feedback process notes) so
// the button visually covers it, but a bit smaller than that oval.
// Expressed here as a fraction of the heater image's own width/height,
// then converted to a box relative to the outer container the same way
// HEATER_BOX itself is positioned -- since HEATER_BOX is already sized to
// the image's exact aspect ratio (no distortion), plain fraction-of-parent
// math applies with no extra aspect correction needed, unlike a box
// positioned directly against the background art.
function heaterRelativeBox(imgLeft, imgTop, imgRight, imgBottom, imgWidth, imgHeight) {
  return {
    left: HEATER_BOX.left + (imgLeft / imgWidth) * HEATER_BOX.width,
    top: HEATER_BOX.top + (imgTop / imgHeight) * HEATER_BOX.height,
    width: ((imgRight - imgLeft) / imgWidth) * HEATER_BOX.width,
    height: ((imgBottom - imgTop) / imgHeight) * HEATER_BOX.height,
  };
}

const HEATER_BUTTON_BOX = heaterRelativeBox(33, 68.5, 85, 86.5, 337, 130);

// Anchor for the "heat up water" hint (see showHeaterHint further down) --
// left-aligned (not centered like the other hints) since the button sits
// right in the corner near the frame's own left edge; centering via
// translateX(-50%) here would risk pushing the box into negative left.
// Placed below the heater plate + temp bar (HEATER_BOX ends at top 69,
// TEMP_BAR_BOX ends at 75.4 -- see both above), the one clear stretch of
// counter in this left column that nothing else occupies.
const HEATER_HINT_LEFT = 2;
const HEATER_HINT_TOP = 78;

// Temperature gauge -- sits on the counter/table directly in front of the
// heater rather than on the plate itself, so it's positioned as its own
// fixed box (not derived from HEATER_BOX) on the counter surface below.
// Only mounted while heaterOn is true (same "hidden until confirmed"
// pattern as the scoop gauge/selectedTin below) -- pressing the heater
// button is what reveals it, and switching the heater back off unmounts it
// again. It also unmounts on its own, independently of heaterOn, a beat
// after the player stops it -- see tempBarVisible/TEMP_BAR_LINGER_MS in the
// component below -- so the gauge doesn't linger on screen forever once
// its job (letting the player catch a reading) is done. The solid
// light-blue fill lives on a separate .heater-temp-bar-fill child that's
// scaled to 0 width by default and animates open left-to-right once
// mounted, so the color progressively advances across the bar instead of
// appearing instantly.
const TEMP_BAR_BOX = { left: 3, top: 72, width: 21, height: 3.4 };

// Two tick marks in the gauge's white middle zone, positioned as a % of the
// bar's own box (TEMP_BAR_BOX) since they're rendered as children of the
// bar div -- shifted right of center, with a wider gap between them, sized
// to sit flush inside the bar's own height (see .heater-temp-bar-tick).
// The button's green window (GREEN_AT_MS/RED_AT_MS below) is derived
// directly from these two entries' own left/width, so moving or resizing
// the ticks automatically keeps the timing in sync.
const TEMP_BAR_TICKS = [
  { key: 'tick-left', left: 52, width: 3.5 },
  { key: 'tick-right', left: 60.5, width: 3.5 },
];

// Thin marker line sitting in the gap between the two green ticks above --
// the single exact "right on target" temperature, as opposed to the wider
// green window the two ticks themselves bound (see GREEN_AT_MS/RED_AT_MS
// below, still the whole green span the button/tempZone actually key off
// of -- this line is purely a visual bullseye within that span, not a
// narrower pass/fail zone of its own). Derived from the ticks' own left/
// width (their outer edges -- tick-left's own left, tick-right's own
// right) rather than a separate hardcoded number, so it always sits
// exactly centered in the green window even if the ticks themselves are
// ever moved/resized.
const TEMP_BAR_EXACT_LINE = (TEMP_BAR_TICKS[0].left + TEMP_BAR_TICKS[TEMP_BAR_TICKS.length - 1].left + TEMP_BAR_TICKS[TEMP_BAR_TICKS.length - 1].width) / 2;

// How long the fill takes to grow from empty to full (see the inline
// transitionDuration on .heater-temp-bar-fill below) -- kept as a single
// JS constant, rather than living only in the CSS, so the button's
// green/red timing below can be scheduled against the exact same number.
// The fill's timing function is linear (see MatchaMaking.css) specifically
// so that "elapsed time / duration" is an accurate stand-in for "how far
// across the bar the fill edge currently is" -- with an eased curve these
// setTimeout delays would drift out of sync with where the color visually
// is.
const FILL_DURATION_MS = 5000;

// The button turns green the moment the fill edge reaches the left edge of
// the first tick, and turns red the moment it passes the right edge of the
// second (last) tick -- i.e. green for exactly as long as the fill is
// touching either tick or the gap between them. Both expressed as a
// fraction of FILL_DURATION_MS since the fill grows linearly.
const GREEN_AT_MS = FILL_DURATION_MS * (TEMP_BAR_TICKS[0].left / 100);
const RED_AT_MS =
  FILL_DURATION_MS *
  ((TEMP_BAR_TICKS[TEMP_BAR_TICKS.length - 1].left + TEMP_BAR_TICKS[TEMP_BAR_TICKS.length - 1].width) / 100);

// How long the gauge lingers on screen, fully frozen at its caught reading,
// after the player stops it (see stopBar/tempBarVisible in the component
// below) before it disappears and the kettle becomes the thing to interact
// with -- same "let the player register the result before it goes away"
// idea as SCOOP_CONFIRM_LINGER_MS, just simpler here since the temp bar's
// fill freezes instantly (no fill-then-linger animation to wait out first).
const TEMP_BAR_LINGER_MS = 1500;

// Kettle, bowl, and whisk are the first three items made movable -- freely
// draggable (mouse/touch/remote pointer) and D-pad-selectable with the same
// white shape-hugging focus halo used on the Milk Selection screen's glass
// cup / ice cubes. Unlike that screen, there's no destination/drop-zone
// mechanic designed yet for these three, so movement here is intentionally
// free-form (no snapping, no Enter-to-toggle) -- just "pick it up, put it
// down anywhere on the counter". Width/height stay fixed at their starting
// size; only left/top change while dragging. Exported so MilkSelection.js
// can look up the bowl/whisk boxes' own width/height when re-rendering the
// carried-over bowl+whisk (see incomingBowl there) -- it needs the same
// box dimensions this screen uses so the reused position math (WHISK_BOWL_
// OFFSET, getWhiskMixPos, etc. below) comes out the same.
export const MOVABLE_ITEMS = [
  { key: 'kettle', src: './kettle.png', alt: 'Pour-over kettle', left: 3.5, top: 26.1, width: 24, height: 31.4 },
  { key: 'bowl', src: './Bowl.png', alt: 'Matcha mixing bowl', left: 38, top: 33.8, width: 24, height: 45.7 },
  // Scaled down 0.85x from the doubled 15.6x55.64 box (a touch smaller than
  // "doubled" read), keeping left/top centered on (69, 57.7) through all
  // three resizes -- then nudged 2 lower (top only) from that centered
  // position per request, so it now sits a little below dead-center. Then
  // raised back up 8 points (top 36.05 -> 28.05) per feedback that this
  // same spot -- also where the whisk glides back to once whisking
  // finishes, see MOVABLE_START.whisk -- put its tall 47.29%-height box low
  // enough to overlap the ProgressBar (whose top edge sits at roughly 84%
  // down the container). Then nudged back down further (top 28.05 -> 33.05
  // -> 35.00) across two rounds of feedback that it should sit a bit lower
  // on the table both before whisking (its resting spot) and after
  // (MOVABLE_START.whisk, where it glides back to once whiskStage reaches
  // 'done' -- see the mixing physics effect further down) -- doesn't touch
  // its position *during* whisking itself, which is driven separately by
  // WHISK_BOWL_OFFSET/getWhiskMixPos below. Bottom edge is now
  // 35.00 + 47.29 = 82.29%, still clear of the bar by ~1.7 points -- and
  // even where it does brush the bar, ProgressBar now renders on its own
  // explicit z-index (25, see ProgressBar.css) well above any in-station
  // item, so an overlap here can't visually cover it the way it used to be
  // able to.
  { key: 'whisk', src: './whisk.png', alt: 'Bamboo whisk', left: 62.37, top: 35.0, width: 13.26, height: 47.29 },
];

const MOVABLE_START = MOVABLE_ITEMS.reduce((acc, item) => {
  acc[item.key] = { left: item.left, top: item.top };
  return acc;
}, {});

// Anchor for the "pour water in the bowl" hint (see showKettleHint further
// down) -- fixed at the kettle's own spawn spot (MOVABLE_ITEMS' kettle
// entry) rather than tracking its live (possibly dragged) position, same
// "anchor at the spot the thing first appears" simplicity as the spoon's
// own hint -- the kettle hasn't been touched yet by the time this beat
// starts (it only picks up right after the temp bar sequence finishes).
// Centered above it (kettle top: 26.1), same open counter/wall space the
// tin hint above already uses.
const KETTLE_HINT_LEFT = MOVABLE_ITEMS[0].left + MOVABLE_ITEMS[0].width / 2;
const KETTLE_HINT_TOP = MOVABLE_ITEMS[0].top - 12;

// Anchor for the "start whisking" hint (see showWhiskHint further down) --
// same "fixed at the item's own spawn spot" simplicity as the kettle hint
// above. The whisk sits decoratively on the counter (MOVABLE_ITEMS' whisk
// entry) up until this beat fires, so its resting spot is a reliable
// anchor. Centered above it, clear of the whisk's own top (28.05).
const WHISK_HINT_LEFT = MOVABLE_ITEMS[2].left + MOVABLE_ITEMS[2].width / 2;
const WHISK_HINT_TOP = MOVABLE_ITEMS[2].top - 12;

// Where the kettle steam anchors, as a fraction (0-1) of the kettle's own
// box (its MOVABLE_ITEMS width/height). Horizontally lined up with the
// spout tip's leftmost opaque pixel in the 48x32 kettle.png source (~x4 of
// 48), but pulled up well above the spout opening itself (topFrac 0.4 was
// the actual spout pixel, at y~14 of 32) so the wisps read clearly above
// the kettle's silhouette instead of starting low and getting lost against
// it. Steam wisps anchor here so they track the kettle wherever it's been
// dragged, rather than sitting at a fixed spot on the counter.
const KETTLE_SPOUT_OFFSET = { leftFrac: 0.06, topFrac: 0.08 };

// ---- Kettle water-pour sequence: same "hover above the bowl, then pour"
// shape as the matcha spoon's dump sequence (bigSpoonStage), but the
// kettle is a reusable tool rather than a used-up scoop -- see
// kettleStage/beginKettleDump in the component below -- so once it
// finishes pouring it glides back to its counter spot (MOVABLE_START.kettle)
// and goes straight back to 'idle', ready to be picked up again, instead of
// disappearing the way the spoon does.
const KETTLE_MOVE_MS = 350; // time to glide to the hover-over-the-bowl spot -- same reasoning as BIG_SPOON_MOVE_MS
const KETTLE_POUR_MS = 2000; // how long the falling-water effect plays, and how long the bowl's water fill takes to grow in, before the kettle heads back to the counter
const KETTLE_HOVER_GAP = 2; // gap, in container %, between the spout and the bowl's top edge while hovering/pouring

// The *true* spout opening, as a fraction of the kettle's own box -- distinct
// from KETTLE_SPOUT_OFFSET above, which is deliberately pulled up well
// above the actual spout pixel so the *steam* wisps read clearly above the
// kettle's silhouette (see that comment). Pouring water should anchor to
// where the spout opening actually is (topFrac 0.4, per that same
// comment's pixel measurement), not the raised steam anchor point.
const KETTLE_POUR_SPOUT_TOP_FRAC = 0.4;

// Tilts the kettle to read as "pouring" while moving/pouring (applied
// inline in the MOVABLE_ITEMS JSX below, not a CSS class) -- rotated around
// the spout opening itself (KETTLE_SPOUT_OFFSET.leftFrac/KETTLE_POUR_SPOUT_
// TOP_FRAC, set as the kettle's transform-origin inline) so the spout tip
// stays anchored in place -- lined up with the falling-water effect below
// -- while the kettle's body swings around it, rather than the whole image
// drifting as it rotates. Eyeballed angle/direction (same caveat as this
// file's other not-yet-checked-against-the-live-render guesses) -- flip the
// sign or adjust the degrees if it tips the wrong way once seen against the
// actual kettle.png art.
const KETTLE_POUR_ROTATE_DEG = -35;

// Centered horizontally on the bowl's own current box, with the spout
// opening sitting KETTLE_HOVER_GAP above the bowl's top edge -- takes
// bowlPos/bowlItem/kettleItem as arguments since the bowl can be dragged
// anywhere before the player ever confirms a temperature. Unlike the
// spoon's getSpoonHoverPos, this positions the kettle by its *spout*, not
// its box center, since that's the point that needs to end up over the
// bowl.
function getKettleHoverPos(bowlPos, bowlItem, kettleItem) {
  return {
    left: bowlPos.left + bowlItem.width / 2 - KETTLE_SPOUT_OFFSET.leftFrac * kettleItem.width,
    top: bowlPos.top - KETTLE_POUR_SPOUT_TOP_FRAC * kettleItem.height - KETTLE_HOVER_GAP,
  };
}

// Where the water sits on top of the bowl, and how big it grows -- same
// "eyeballed, not yet checked against the live render" caveat as
// BOWL_POWDER_OFFSET, and the same fraction-of-the-bowl's-own-box
// coordinate space. topFrac here is deliberately the same starting value as
// BOWL_POWDER_OFFSET.topFrac -- the water pool's *actual* rendered top
// position (bowlWaterTop in the component below) then shifts up from this
// shared starting point to compensate for the pool being taller than the
// mound, so the two end up sharing the same bottom edge rather than the
// taller pool's bottom sitting further down. Roughly the same spot as the
// matcha mound (water fills in around/under it) but wider, since it's meant
// to read as filling the whole bowl rather than a separate second pile
// sitting next to the matcha.
const BOWL_WATER_OFFSET = { leftFrac: 0.5, topFrac: 0.57 };
const BOWL_WATER_SIZE_FRAC = 0.7;
// Taller than BOWL_MOUND_HEIGHT_FRAC (the matcha mound's own ratio) -- the
// water pool should read as noticeably bigger/deeper than the mound sitting
// in it, not just wider. bowlWaterTop's upward shift (see above) is derived
// from the *difference* between this and BOWL_MOUND_HEIGHT_FRAC, so bumping
// this up further to make the pool even taller keeps the bottom-edge
// alignment correct automatically -- no other constant needs retuning.
const BOWL_WATER_HEIGHT_FRAC = 0.95;
// Used by the falling-water pour effect (.spoon-pour-grain-N), which stays
// fairly opaque so the stream itself reads clearly while it's pouring.
const WATER_COLOR = 'rgba(211, 230, 236, 0.85)'; // #D3E6EC
// Used by the *pool* that sits in the bowl (bowlWater below) -- much more
// transparent than WATER_COLOR above, and deliberately painted *after*
// bowlPowder in the JSX (i.e. on top of it -- see the comment down there)
// so the matcha mound shows through underneath, reading as water sitting
// over the powder rather than a solid disc covering it.
const BOWL_WATER_FILL_COLOR = 'rgba(211, 230, 236, 0.45)';

// ---- Whisking: the last interactive step in this station. Pick up the
// whisk (drag it onto the bowl once matcha and water are both in, or select
// it and press Enter/Space) and it settles right *into* the bowl -- not
// hovering above it like the kettle/spoon do, since whisking needs the tool
// actually in the mixture (see whiskStage/beginWhiskMix in the component
// below: 'idle' -> 'moving' -> 'mixing' -> 'done'). Once it's in, the whisk
// starts stirring in place (see .station-item.movable.mixing in
// MatchaMaking.css) and a balance minigame bar appears: keep a small ball
// inside the green zone in the middle of the bar, using Left/Right, for
// WHISK_MIX_DURATION_MS. Same as the heater/scoop gauges, there's no pass/
// fail gate on this -- it always finishes after the timer regardless of how
// well the player balanced it, matching the "engaging busywork, not a hard
// blocker" spirit those two already have.
const WHISK_MOVE_MS = 350; // time to glide into the bowl -- same reasoning as BIG_SPOON_MOVE_MS/KETTLE_MOVE_MS
const WHISK_MIX_DURATION_MS = 10000; // 10s, per request (originally 6s)

// Where the whisk settles once dropped in the bowl, as a fraction of the
// bowl's own current box -- centers it horizontally and drops it roughly
// where the mixture already is (same topFrac neighborhood as
// BOWL_POWDER_OFFSET/BOWL_WATER_OFFSET), so it reads as dipped into the
// bowl rather than hovering over it the way the spoon/kettle do. Eyeballed
// starting guess, same caveat as those two -- likely needs tuning once
// actually seen against the live render. Exported for MilkSelection.js's
// carried-over bowl display -- see the comment on MOVABLE_ITEMS above.
export const WHISK_BOWL_OFFSET = { leftFrac: 0.5, topFrac: 0.0 };

// Pivot point for both the static 180deg "upside down once picked up" flip
// and the @keyframes whiskStir wobble in MatchaMaking.css -- set here,
// unconditionally, on the whisk at all times (not just while actually
// mixing) so the pivot never changes between whiskStage's 'moving' ->
// 'mixing' -> 'done' states; see the comment on .station-item.movable.mixing
// in that CSS file for why a *changing* origin would visibly jump the
// whisk sideways for a frame at each stage transition. Biased down toward
// the lower portion of the whisk's own box (rather than dead-center) so
// the wobble/flip both pivot from roughly where a hand would be gripping
// the handle. Exported for MilkSelection.js's carried-over bowl display.
export const WHISK_STIR_ORIGIN_FRAC = { leftFrac: 0.5, topFrac: 0.68 };

// The "upside down once picked up" flip angle -- single source of truth for
// the inline static rotate below (applied during 'moving'/'done') AND for
// every step of @keyframes whiskStir in MatchaMaking.css (applied during
// 'mixing', since a running CSS animation on `transform` overrides an inline
// `style.transform` on the same element -- see that keyframe's own comment).
// CSS keyframes can't reference this constant directly, so if this value
// ever changes, whiskStir's 0%/50%/100% steps need to be updated to match.
// Exported for MilkSelection.js's carried-over bowl display -- the whisk
// stays in this same "flipped, resting" pose once it lands there.
export const WHISK_FLIP_DEG = 180;

// Centers the whisk's own box horizontally on the bowl and vertically at
// WHISK_BOWL_OFFSET.topFrac down into it -- takes bowlPos/bowlItem/
// whiskItem as arguments since the bowl can be dragged anywhere before the
// player ever confirms a mix, same pattern as getSpoonHoverPos/
// getKettleHoverPos above. Exported so MilkSelection.js can reuse the exact
// same math to position the carried-over whisk on top of the carried-over
// bowl, given whatever position it chooses to rest that bowl at.
export function getWhiskMixPos(bowlPos, bowlItem, whiskItem) {
  return {
    left: bowlPos.left + bowlItem.width / 2 - whiskItem.width / 2,
    top: bowlPos.top + WHISK_BOWL_OFFSET.topFrac * bowlItem.height - whiskItem.height / 2,
  };
}

// ---- Balance minigame bar -- sits *above* the bowl (not below it -- a
// fixed bottom-of-screen spot was tried first and landed right under
// ProgressBar's own pill-shaped footer, which paints over anything behind
// it there and hid the bar completely), centered horizontally on the
// bowl's own *current* box the same way getSpoonHoverPos/getKettleHoverPos
// position themselves -- see getMixBarPos below, which takes bowlPos/
// bowlItem as arguments for exactly that reason (the bowl can be dragged
// anywhere). Reuses the gray-body/thick-outline look of the other two
// gauges (see .mix-bar/.heater-temp-bar/.scoop-bar in MatchaMaking.css) but
// horizontal, since the ball travels left-right with the arrow keys rather
// than a fill rising vertically.
const MIX_BAR_WIDTH = 26;
const MIX_BAR_HEIGHT = 4;
const MIX_BAR_GAP = 3; // gap, in container %, between the bar's bottom edge and the bowl's top edge

function getMixBarPos(bowlPos, bowlItem) {
  return {
    left: bowlPos.left + bowlItem.width / 2 - MIX_BAR_WIDTH / 2,
    top: bowlPos.top - MIX_BAR_HEIGHT - MIX_BAR_GAP,
  };
}

// The green target zone sits centered in the middle of the bar, as a
// fraction of the bar's own width -- unlike the heater's ticks (which
// just mark a window a one-shot fill passes through), this is a fixed
// target the ball has to actively be kept inside of for the whole minigame.
const MIX_ZONE_WIDTH_FRAC = 0.26;
const MIX_ZONE_LEFT_FRAC = (1 - MIX_ZONE_WIDTH_FRAC) / 2;

// The ball's own width, as a fraction of the bar's width -- used both for
// sizing it in the JSX and for clamping its travel range in the physics
// below (it can only travel until its *right edge* reaches the bar's own
// right edge, not until its left edge/anchor point does).
const MIX_BALL_WIDTH_FRAC = 0.06;

// ---- Ball balance physics -- a simple 1D "keep the marble on the plank"
// simulation, run every animation frame while whiskStage === 'mixing' (see
// that effect in the component below): a constantly-varying "drift" force
// (a smooth sine wave, not random, so the challenge is consistent/
// learnable rather than erratic) pushes the ball, and holding Left/Right
// applies a continuous acceleration in that direction. All the numbers
// below were picked by feel (there's no reference physics here) -- tune
// them together if the ball feels too twitchy or too sluggish once
// actually played.
//
// This used to add a one-time velocity "kick" on every qualifying keydown
// instead of a continuous held-acceleration -- per feedback that the ball's
// motion looked "robotic" rather than smooth. The problem was that each
// keydown (including the browser's own auto-repeat firings while a key is
// held) instantly jumped the velocity by a fixed amount, then friction
// immediately started dragging it back down until the next repeat firing --
// a little sawtooth of sudden speed-up/slow-down every ~30-50ms, which reads
// as jerky/mechanical rather than fluid. Switching to a continuous
// acceleration (applied every animation frame, scaled by dt, for as long as
// a direction is considered "held") produces a smooth analog ramp up and
// down instead. See MIX_HOLD_GRACE_MS below for how "held" is tracked
// without relying on keyup (which pal.js explicitly warns TV remotes may
// not fire reliably).
const MIX_HOLD_ACCEL = 150; // %/s^2 continuous acceleration while a direction is held
// How long a direction stays "held" after its most recent qualifying
// keydown -- bridges the gap between the browser's own auto-repeat events
// (which don't fire at a perfectly guaranteed interval) so holding the key
// down reads as one continuous push rather than flickering on/off between
// repeats. Deliberately keyup-free, same reasoning as the rest of this
// minigame's input handling.
const MIX_HOLD_GRACE_MS = 150;
const MIX_DRIFT_AMPLITUDE = 34; // %/s^2 peak strength of the sine drift
const MIX_DRIFT_ANGULAR_FREQ = 1.3; // radians/second -- how fast the drift's direction cycles
const MIX_FRICTION_HALF_LIFE_S = 0.35; // seconds for velocity to decay to half, with no further input/drift

// How often (at minimum) a fresh spill event can trigger while the ball is
// sitting outside the green zone during mixing -- see the spills state and
// the tick() logic below. Not gated to "only once per exit" since a player
// who's sloppy for a long stretch should keep looking sloppy (matcha keeps
// flicking out), not just once per excursion.
const MIX_SPILL_INTERVAL_MS = 550;

// ---- Spill puddles: one pre-made PNG per mess-up, shown in order (1st
// mess-up of a mixing session -> stage-1 PNG, 2nd -> stage-2, etc.) on
// whichever side of the bowl the ball actually drifted off toward -- see the
// spills state and side-detection in the balance-minigame physics effect
// further down. Replaces the old plain-CSS droplet-burst effect entirely.
const SPILL_IMAGE_COUNT = 4;
// One set of 4 per grade -- same keying/classic-grade-fallback convention as
// SCOOP_FILL_COLORS/SCOOP_SPOON_IMAGES/WHISKED_LIQUID_IMAGES above, so the
// spill color follows whichever tin was actually scooped from instead of
// always showing one fixed shade. The cafe-grade set is the original
// hand-made art; classic-grade/ceremonial-grade are that same art
// recolored (hue/saturation/brightness re-anchored to each grade's own
// SCOOP_FILL_COLORS swatch, shading preserved) rather than separately
// drawn, so all three stay visually consistent with each other.
const SPILL_IMAGES_BY_GRADE = {
  'cafe-grade': ['./Spill1.png', './Spill2.png', './Spill3.png', './Spill4.png'],
  'classic-grade': [
    './Spill1ClassicGrade.png',
    './Spill2ClassicGrade.png',
    './Spill3ClassicGrade.png',
    './Spill4ClassicGrade.png',
  ],
  'ceremonial-grade': [
    './Spill1CeremonialGrade.png',
    './Spill2CeremonialGrade.png',
    './Spill3CeremonialGrade.png',
    './Spill4CeremonialGrade.png',
  ],
  // Same recolor treatment as classic-grade/ceremonial-grade above --
  // cafe-grade's original art, hue-shifted to hojicha-grade's own
  // SCOOP_FILL_COLORS tone rather than separately drawn.
  'hojicha-grade': [
    './Spill1HojichaGrade.png',
    './Spill2HojichaGrade.png',
    './Spill3HojichaGrade.png',
    './Spill4HojichaGrade.png',
  ],
};
// Each PNG's own native pixel size (measured directly off the source files),
// used below to size each puddle without distorting it -- same
// width-from-height aspect-ratio conversion this file already uses for
// square art like SCOOP_SPOON_SIZE, just per-image here since these four
// PNGs aren't all the same shape.
const SPILL_IMAGE_DIMS = [
  { width: 102, height: 85 },
  { width: 123, height: 136 },
  { width: 275, height: 206 },
  { width: 238, height: 193 },
];
// Rendered height (as a % of the container), one per stage -- escalating
// step by step so the puddles read as an increasingly messy spill, matching
// how the source art itself gets bigger/more irregular from Spill1 to
// Spill4.
const SPILL_STAGE_HEIGHTS = [5, 6.2, 7.5, 9];
// A little rotation per stage, purely decorative, so a run of puddles
// landing on the same side doesn't look like the same stamp repeated.
const SPILL_STAGE_ROTATIONS = [-8, 10, -6, 5];
const SPILL_DIMS = SPILL_STAGE_HEIGHTS.map((heightPercent, i) => ({
  height: heightPercent,
  width: heightPercent * (SPILL_IMAGE_DIMS[i].width / SPILL_IMAGE_DIMS[i].height) / (16 / 9),
}));

// Anchor points for the puddle cluster on each side of the bowl, as a
// fraction of the bowl's own box -- mirror images of each other, just
// outside the bowl's left/right edge respectively. topFrac sits down near
// the bowl's base (not up by the rim, where it visually read as spilling
// out of thin air above the counter) -- roughly where liquid flung out
// during whisking would actually land and pool on the counter beside the
// bowl. Bumped down from an earlier 0.4 (rim-height) per feedback.
const RIGHT_SPILL_BASE = { leftFrac: 1.06, topFrac: 0.78 };
const LEFT_SPILL_BASE = { leftFrac: -0.06, topFrac: 0.78 };
// How far each additional puddle landing on the *same* side nudges away
// from the previous one (further out horizontally, further down vertically)
// -- so a run of mess-ups on one side spreads into a puddle trail rather
// than stacking on the exact same spot. topFrac's step is shrunk from an
// earlier 0.16 now that the base itself sits much lower (0.78) -- the old
// step would have pushed a third/fourth same-side puddle well below the
// bowl's own box.
const SPILL_SLOT_STEP = { leftFrac: 0.05, topFrac: 0.08 };

// Once all SPILL_IMAGE_COUNT stages have appeared, further mess-ups don't
// add a new image (there are only 4) -- instead every puddle already on
// screen grows a bit bigger together, so continued sloppy whisking keeps
// reading as "getting worse" instead of just going quiet. Capped so it
// doesn't balloon indefinitely.
const SPILL_GROWTH_STEP = 0.08;
const SPILL_GROWTH_CAP = 1.5;

// How big the stirring swirl (.bowl-mix-swirl) renders relative to
// bowl-water's own full size -- shrunk down from an initial 1:1 overlay
// per feedback that it read as too large/covered too much of the pool.
// Scaling width/height by this fraction (rather than picking new fixed
// numbers) keeps it centered exactly the same way, since bowl-water's own
// left/top are already the pool's *center* point (see the translate(-50%,
// -50%) comment on .bowl-mix-swirl in MatchaMaking.css) -- shrinking around
// a fixed center needs no left/top adjustment at all.
const BOWL_MIX_SWIRL_SIZE_FRAC = 0.8;

// Where the bowl's actual inner rim opening sits, measured directly off
// Bowl.png (327x343) rather than eyeballed like BOWL_WATER_OFFSET/
// BOWL_POWDER_OFFSET above -- the rim renders as a true ellipse (a circular
// rim viewed at an angle) spanning roughly x:[3,323]/y:[6,239] in the
// source PNG's own pixel space (back-of-rim peak at the top, front-of-rim
// dip at the bottom, widest point at the vertical midpoint of that span --
// found by scanning the image's opaque-pixel bounding box row by row).
// Converted to fractions of the source canvas (center x = 0.5, center y =
// (6+239)/2/343 = 0.357, width = (323-3)/327 = 0.978, height =
// (239-6)/343 = 0.679) and, since bowlItem's own width/height already
// reproduce Bowl.png's real aspect ratio (the project's usual canvas-aspect-
// correction convention), those same fractions apply directly to
// bowlItem.width/height with no further conversion. Used to make the
// finished whisked-matcha image (.bowl-whisked-liquid) fill exactly the
// bowl's visible interior instead of the smaller, more-circular guess
// bowl-water's own box was using (bowl-water/bowl-powder still use their
// own approximate offsets -- this only affects the whisked-liquid image,
// which is the one place a mismatch was visible/reported). Center-point
// convention (not top-left) matches bowl-water/bowl-powder's own
// translate(-50%, -50%) centering. Width/height nudged down from the exact
// measured 0.978/0.679 across a few rounds of "teeny bit smaller" feedback
// (0.978/0.679 -> 0.93/0.645 -> 0.9/0.625 -> current) -- scaled evenly
// (same factor on both) around the same fixed center so the ellipse's
// aspect ratio/shape match is preserved, just increasingly inset from the
// rim's outline instead of touching it. topFrac nudged down slightly from
// the exact measured rim center per feedback (0.357 -> 0.377 -> 0.383 ->
// 0.388 -> 0.389). Exported for MilkSelection.js's carried-over bowl
// display, so the whisked-liquid image lines up with the bowl's rim there
// too.
export const BOWL_INNER_RIM_CENTER = { leftFrac: 0.5, topFrac: 0.389 };
export const BOWL_INNER_RIM_WIDTH_FRAC = 0.87;
export const BOWL_INNER_RIM_HEIGHT_FRAC = 0.605;

function clampPct(value, size) {
  return Math.min(Math.max(value, 0), 100 - size);
}

// Same "generous margin, percentage-box hit test" idea as MilkSelection's
// isOverCup, but against the bowl's *current* position/size rather than a
// fixed spot -- the bowl is itself freely draggable (see MOVABLE_ITEMS), so
// this takes its live position/box as arguments instead of a module-level
// constant.
function isOverBowl(leftPct, topPct, bowlPos, bowlItem) {
  const margin = 3;
  return (
    leftPct >= bowlPos.left - margin &&
    leftPct <= bowlPos.left + bowlItem.width + margin &&
    topPct >= bowlPos.top - margin &&
    topPct <= bowlPos.top + bowlItem.height + margin
  );
}

// The "Make Drink" drop-zone label -- only rendered once whiskStage is
// 'done' (see the JSX below). Sits in the bottom-right corner, clear of
// the ProgressBar (which is bottom-center, min-width min(1140px, 54.625vw)
// -- at most ~54.6% of the container, so its right edge never passes
// ~77.3% from center) and clear of the whisk's own resting spot (right
// edge 62.37 + 13.26 = 75.63%, see MOVABLE_ITEMS above), so it can't ever
// visually collide with either regardless of exact vertical overlap.
const MAKE_DRINK_ZONE = { left: 78, top: 66, width: 19, height: 18 };

// Generous hit-test box for "was the bowl dropped on the Make Drink
// label", same margin-based approach as isOverBowl above -- takes the
// drag's live left/top (percentage points) rather than reading state
// directly, matching every other isOverX helper in this file.
function isOverMakeDrinkZone(leftPct, topPct) {
  const margin = 3;
  return (
    leftPct >= MAKE_DRINK_ZONE.left - margin &&
    leftPct <= MAKE_DRINK_ZONE.left + MAKE_DRINK_ZONE.width + margin &&
    topPct >= MAKE_DRINK_ZONE.top - margin &&
    topPct <= MAKE_DRINK_ZONE.top + MAKE_DRINK_ZONE.height + margin
  );
}

// Once whisking's done and the player sends the bowl off (see bowlStage/
// beginBowlCarry in the component below), it glides into the Make Drink
// zone above rather than the screen advancing immediately -- this is how
// long that glide takes before the bowl starts fading/shrinking away
// (BOWL_VANISH_MS), comfortably longer than .station-item.movable's own
// 0.2s left/top transition so it always finishes the glide first, same
// reasoning as KETTLE_MOVE_MS/WHISK_MOVE_MS. The whisk stays behind on the
// counter rather than going along for this -- only the bowl itself moves.
const BOWL_CARRY_MOVE_MS = 350;
// How long the shrink/fade-out itself takes (see .bowl-vanishing in
// MatchaMaking.css) once the bowl's arrived at the Make Drink zone, before
// it actually unmounts.
const BOWL_VANISH_MS = 350;

// Reads the fill's current live scaleX mid-transition (e.g. computed
// style's transform matrix reports whatever the browser has interpolated
// to at this exact frame) -- this is what lets stopping the gauge freeze
// it exactly where it visually is, rather than snapping to 0 or 1.
function getCurrentScaleX(el) {
  const transform = window.getComputedStyle(el).transform;
  if (!transform || transform === 'none') return 0;
  return new DOMMatrixReadOnly(transform).a;
}

const MatchaMaking = ({ activeStep, customerNumber, onNavigate, onAdvance, order, onSendToMilk, onScored }) => {
  const containerRef = useRef(null);
  // Hojicha tin unlocked order 4 onward, same "read once, unmounts between
  // customers" reasoning as CustomerOrdering.js's own baseOptions/
  // toppingOptions -- this whole component unmounts/remounts each new
  // customer, so customerNumber is fixed for this mount's lifetime. tinItems
  // drives both JSX loops below (the tins themselves and the focused-tin
  // label) -- see STATIC_ITEMS_BASE/STATIC_ITEMS_WITH_HOJICHA above for the
  // actual layout math.
  const hojichaUnlocked = customerNumber >= 4;
  const tinItems = hojichaUnlocked ? STATIC_ITEMS_WITH_HOJICHA : STATIC_ITEMS_BASE;
  // Declared up here (rather than scattered near where each one used to
  // live -- heaterButtonRef/kettleRef/whiskRef were each declared right
  // before the effect that hands them focus mid-gameplay; bowlRef is new)
  // purely so the keyboard-nav bridge effect right below -- which needs
  // all four -- can be registered before useFlatFocusNav(containerRef)
  // further down is. See that effect's own comment for why the
  // registration order matters (same reasoning already worked out for
  // Customer Ordering's own version of this).
  const heaterButtonRef = useRef(null);
  const kettleRef = useRef(null);
  const whiskRef = useRef(null);
  const bowlRef = useRef(null);
  // Ref (not state) purely so the lockdown handler right below -- which has
  // to be declared/registered up here, before this station's own nav-graph
  // effect and useFlatFocusNav(containerRef) further down, same ordering
  // reasons as those two -- can read the CURRENT value without needing
  // showOrderButtonLock (declared much further down this component, past
  // the Order-hint/spotlight state) in its own dependency array. Kept in
  // sync every render by the effect sitting right after showOrderButtonLock's
  // own declaration below. Same "ref declared early, synced late" pattern
  // as Customer Ordering's own restrictNavigationRef.
  const restrictNavigationRef = useRef(false);

  // First-order-only walkthrough lockdown -- same idea as Customer
  // Ordering's own restrictNavigationRef (see that file's matching comment):
  // while the player hasn't yet pressed Enter on the Order receipt button
  // once (showOrderButtonLock below), arrow keys shouldn't move focus
  // anywhere else on this station -- the button is pre-focused the instant
  // this walkthrough beat starts (see the focus effect near
  // showOrderButtonLock's own declaration) and Enter on it is the only
  // thing that should do anything until then. Without this, Up/Down/Left/
  // Right would still fall through to this station's own nav-graph handler
  // right below and let the player wander off to the tins/whisk/etc before
  // the walkthrough's actually pointed them at the Order button yet.
  //
  // Registered here, before both that graph and useFlatFocusNav, for the
  // exact same "attach the window listener first so it runs first"
  // reasoning that graph's own comment explains -- stopImmediatePropagation
  // makes this a hard stop rather than merely a first opinion those other
  // handlers could still override.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!restrictNavigationRef.current) return;
      const action = getActionFromKeyEvent(e);
      if (action !== 'Up' && action !== 'Down' && action !== 'Left' && action !== 'Right') return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // This station's own explicit keyboard nav graph, per request -- same
  // "exact fixed graph, not generic spatial nearest-neighbor matching"
  // approach as Customer Ordering's order-form nav and Settings' own
  // popover nav: station dot Up -> whisk; whisk Up -> first (cafe-grade)
  // tin; tins Left/Right cycle among the three (DOM order, via the
  // '.selectable' class shared by all three -- see STATIC_ITEMS' JSX
  // below); any tin Up -> Order button (top-right), Down -> first tin
  // (from the Order button) or back to whisk (from any tin); Order button
  // Left -> Settings gear, Settings Right -> back to Order button; whisk
  // Left -> bowl, bowl Left -> heater/"kettle" button, and back via Right;
  // heater button Up -> kettle, kettle Up -> Settings gear; Settings Down
  // (while its popover is closed -- while open, SettingsPanel's own
  // handler owns Down, moving into the popover instead) -> kettle, kettle
  // Down -> heater button; whisk/bowl/heater button Down -> station dot.
  //
  // Registered here, before useFlatFocusNav(containerRef) below, for the
  // same reason (and avoiding the same possible cascade) worked out for
  // Customer Ordering's own bridges: useFlatFocusNav's own spatial Up/Down/
  // Left/Right handling calls focus() synchronously, updating
  // document.activeElement immediately within the same event dispatch --
  // if this effect were registered after useFlatFocusNav's own, a single
  // press could let that generic hook move focus first and then have this
  // handler immediately act again on the same press, skipping a step.
  // Registering this one first means it only ever sees focus as it was
  // *before* any handler for this keypress has run.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Up' && action !== 'Down' && action !== 'Left' && action !== 'Right') return;
      const active = document.activeElement;

      const orderButton = document.querySelector('.order-receipt-button');
      const gearButton = document.querySelector('.settings-toggle-button');
      const tins = containerRef.current
        ? Array.from(containerRef.current.querySelectorAll('.selectable'))
        : [];
      const firstTin = tins[0] ?? null;

      // Station dot -> whisk.
      if (active === document.querySelector('.progress-step.current')) {
        if (action === 'Up') {
          e.preventDefault();
          e.stopImmediatePropagation();
          whiskRef.current?.focus();
        }
        return;
      }

      // Any matcha tin: Left/Right cycles siblings, Up -> Order button,
      // Down -> whisk.
      const tinIndex = tins.indexOf(active);
      if (tinIndex !== -1) {
        if (action === 'Left' || action === 'Right') {
          e.preventDefault();
          e.stopImmediatePropagation();
          const nextIndex = action === 'Right' ? tinIndex + 1 : tinIndex - 1;
          tins[nextIndex]?.focus();
        } else if (action === 'Up') {
          e.preventDefault();
          e.stopImmediatePropagation();
          orderButton?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          whiskRef.current?.focus();
        }
        return;
      }

      if (active === orderButton) {
        if (action === 'Left') {
          e.preventDefault();
          e.stopImmediatePropagation();
          gearButton?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          firstTin?.focus();
        }
        return;
      }

      if (active === gearButton) {
        if (action === 'Right') {
          e.preventDefault();
          e.stopImmediatePropagation();
          orderButton?.focus();
        } else if (action === 'Down') {
          const popoverOpen = !!document.querySelector('.settings-popover');
          if (popoverOpen) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          kettleRef.current?.focus();
        }
        return;
      }

      if (active === whiskRef.current) {
        if (action === 'Left') {
          e.preventDefault();
          e.stopImmediatePropagation();
          bowlRef.current?.focus();
        } else if (action === 'Up') {
          e.preventDefault();
          e.stopImmediatePropagation();
          firstTin?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          document.querySelector('.progress-step.current')?.focus();
        } else if (action === 'Right') {
          // Trapped (a no-op) -- the whisk is the rightmost item in this
          // row, so it shouldn't fall through to useFlatFocusNav's generic
          // spatial fallback, which was jumping Right straight to whatever
          // ProgressBar dot happened to be nearest (station 5/Serve) once
          // whisking finished and moved the bowl/dropzone layout around --
          // same "don't let an unhandled direction escape this row" trap as
          // guava-powder's/banana-foam's own Right trap in ToppingsStation.js.
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }

      if (active === bowlRef.current) {
        if (action === 'Left') {
          e.preventDefault();
          e.stopImmediatePropagation();
          heaterButtonRef.current?.focus();
        } else if (action === 'Right') {
          e.preventDefault();
          e.stopImmediatePropagation();
          whiskRef.current?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          document.querySelector('.progress-step.current')?.focus();
        }
        return;
      }

      if (active === heaterButtonRef.current) {
        if (action === 'Right') {
          e.preventDefault();
          e.stopImmediatePropagation();
          bowlRef.current?.focus();
        } else if (action === 'Up') {
          e.preventDefault();
          e.stopImmediatePropagation();
          kettleRef.current?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          document.querySelector('.progress-step.current')?.focus();
        }
        return;
      }

      if (active === kettleRef.current) {
        if (action === 'Up') {
          e.preventDefault();
          e.stopImmediatePropagation();
          gearButton?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          heaterButtonRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useFlatFocusNav(containerRef);

  // First-visit highlight on the Order receipt button (top-right, see
  // OrderReceiptButton.js/.css) -- on the moment this station mounts, so
  // it's the very first thing that blinks here. Keeps flashing (hint label
  // swapping between "check back at any time" (closed) and "close it back
  // up" (open), see hintText/hintTextOpen below) through as many opens as
  // the player likes, and only retires once they've opened *and then
  // closed* it -- see the onToggle passed to <OrderReceiptButton> below,
  // which is what flips this to false. That retirement is also the cue for
  // the next highlight beat, on the tins themselves (see showTinHint further
  // down, by selectedTin).
  const [showOrderHint, setShowOrderHint] = useState(true);

  // First-order-only continuation of Customer Ordering's own walkthrough
  // spotlight (see showProgressPhase/showSpotlight in CustomerOrdering.js
  // for the earlier beats) -- lands on this screen already pink-tinted,
  // exempting only the Order receipt button (top-right, see
  // spotlightExempt on <OrderReceiptButton> below) instead of the
  // ProgressBar this time, and clears on the exact same rising edge that
  // retires showOrderHint above: once the player's opened the drawer AND
  // closed it again. Reuses that flag directly rather than tracking its
  // own separate one-way state, since the two lifecycles are identical by
  // design. customerNumber === 1 keeps this off for the 2nd/3rd rounds,
  // same as every other beat in this walkthrough -- they still get the
  // plain flashing highlight/hint text showOrderHint already drives, just
  // without the pink tint over everything else.
  const showStationSpotlight = customerNumber === 1 && showOrderHint;

  // First-order-only nav lockdown -- separate, shorter-lived flag from
  // showOrderHint/showStationSpotlight above (which stay up through as many
  // opens as the player likes and only retire once the drawer's been opened
  // AND closed again): this one exists purely to gate restrictNavigationRef
  // (declared/registered far above, before this station's own nav-graph
  // effect -- see that ref's own comment) and retires the instant the
  // player's pressed Enter on the Order button ONCE, same "unlocks the
  // moment the thing it was pointing at gets used" rising-edge shape as
  // Customer Ordering's own showButtonPhase/hasOpenedOrderForm. Set true by
  // the onToggle passed to <OrderReceiptButton> below, on the opening
  // toggle specifically (nowOpen === true) -- unlike showOrderHint's own
  // onToggle branch, which only cares about the closing one.
  const [hasOpenedOrderReceipt, setHasOpenedOrderReceipt] = useState(false);
  const showOrderButtonLock = customerNumber === 1 && !hasOpenedOrderReceipt;

  // Moves focus onto the Order receipt button the instant showOrderButtonLock
  // turns on -- pairs with suppressInitialFocus on <ProgressBar> below so
  // the station dot never grabs the walkthrough's very first selection
  // instead, same "the highlighted thing becomes the next thing selected"
  // pattern as Customer Ordering's own showButtonPhase focus effect. Reaches
  // for the button by class (same as this station's own nav-graph effect
  // above) since OrderReceiptButton doesn't expose a ref up to its parent.
  useEffect(() => {
    if (showOrderButtonLock) {
      document.querySelector('.order-receipt-button')?.focus();
    }
  }, [showOrderButtonLock]);

  // Keeps restrictNavigationRef (declared/read far above the lockdown
  // handler -- see that ref's own comment for why it exists at all) in sync
  // with showOrderButtonLock. No dependency array -- this just re-reads it
  // every render, which is cheap and means the ref can never go stale a
  // render behind the flag.
  useEffect(() => {
    restrictNavigationRef.current = showOrderButtonLock;
  });

  // Used to send focus to the first matcha tin once showOrderHint retired
  // -- removed per request, now that this station has its own explicit,
  // deterministic keyboard nav graph (see the big keydown effect below)
  // starting from ProgressBar's own current-step dot on mount, same as
  // Customer Ordering. That graph is what gets a player from the station
  // dot to the tins now (Up, Up again), rather than this effect
  // auto-stealing focus there once a separate hint dismissed.

  // ---- Heater power button: on/off toggle, plus a green/red "temp zone"
  // light keyed to how far the temp bar fill has progressed (see
  // GREEN_AT_MS/RED_AT_MS above) -- scheduled with plain timers against
  // the same duration the fill itself animates over. Pressing the button
  // sends focus straight to the gauge (barRef) so the player can stop it
  // with Enter/Space right away -- that's the actual minigame: catch the
  // fill while it's between the two ticks by stopping it there.
  const [heaterOn, setHeaterOn] = useState(false);
  const [tempZone, setTempZone] = useState('below'); // 'below' | 'target' | 'over'
  // How far across the gauge (0-100, same percent-space TEMP_BAR_TICKS/
  // TEMP_BAR_EXACT_LINE already use) the fill actually was the instant the
  // player stopped it -- 0 until stopBar below captures a real reading, same
  // "continuous reading, not just which discrete zone it landed in" role
  // scoopFillPercent plays for the matcha scoop gauge. tempZone above still
  // drives the button's own below/target/over color and the kettle-pour
  // gate (tempConfirmed); this is purely for scoreMatchaMaking's own
  // graduated "how close to the exact line" credit (see gameloop/
  // scoring.js), which needs the real distance, not just which zone.
  const [tempFillPercent, setTempFillPercent] = useState(0);
  // Whether the gauge is actively animating right now -- true from the
  // moment the heater is switched on until the player stops it (or the
  // heater is switched off). Enter/Space on the gauge is a no-op once this
  // is false, so it can't be "stopped" twice.
  const [barRunning, setBarRunning] = useState(false);
  // Whether a temperature reading's been locked in (see stopBar below) for
  // the *current* heater-on session -- gates the kettle's water-pour
  // sequence (kettleStage/beginKettleDump further down) the same way
  // scoopConfirmed gates the matcha spoon's. Reset alongside the other
  // heater state whenever heaterOn changes, so switching the heater off
  // and on again always requires a fresh reading before pouring's allowed.
  const [tempConfirmed, setTempConfirmed] = useState(false);
  // Whether the gauge itself is still on screen -- true for the whole
  // heater-on session up through the TEMP_BAR_LINGER_MS beat after
  // stopBar freezes it, then flips false so the bar disappears and the
  // kettle (now pourable, since tempConfirmed is already true by then) is
  // the only remaining thing to interact with. Reset to true whenever
  // heaterOn changes, same as tempConfirmed, so a fresh heater-on session
  // always shows the bar again from scratch.
  const [tempBarVisible, setTempBarVisible] = useState(true);
  // Holds the timer scheduled by stopBar below that flips tempBarVisible
  // off after the linger -- cleared on a fresh heater toggle/unmount so a
  // still-pending one from an abandoned reading can't fire late.
  const tempBarHideTimerRef = useRef(null);
  // Separate from heaterOn (which just mounts/unmounts the gauge -- see the
  // JSX below): this is what actually applies the "on" modifier class that
  // triggers the fill's scaleX(0) -> scaleX(1) transition. Since the gauge
  // only mounts when heaterOn flips true, applying "on" in that very same
  // render would give the fill its "on" (scaleX(1)) class before the
  // browser ever paints the scaleX(0) frame -- CSS transitions only fire on
  // a *change* of computed style across two painted frames, so it would
  // just appear already full instead of animating. Starting this false and
  // flipping it true a couple of frames after mount (see the rAF pair
  // below) guarantees that first scaleX(0) frame actually gets painted.
  const [fillActive, setFillActive] = useState(false);
  const zoneTimersRef = useRef([]);
  const rafIdsRef = useRef([]);
  const barRef = useRef(null);
  const fillRef = useRef(null);

  useEffect(() => {
    zoneTimersRef.current.forEach(clearTimeout);
    zoneTimersRef.current = [];
    rafIdsRef.current.forEach(cancelAnimationFrame);
    rafIdsRef.current = [];
    // Clear any freeze left over from a previous run (see stopBar below)
    // so a fresh press of the heater button always restarts the fill from
    // empty instead of resuming from wherever it was last frozen. Only the
    // transitionProperty longhand is touched here (never the `transition`
    // shorthand) -- setting the shorthand also wipes the inline
    // transitionDuration React applies via the style prop below, which
    // silently dropped the duration to CSS's 0s default and made the fill
    // jump straight to full instead of animating.
    if (fillRef.current) {
      fillRef.current.style.transitionProperty = '';
      fillRef.current.style.transform = '';
    }
    setTempZone('below');
    setTempFillPercent(0);
    setTempConfirmed(false);
    setTempBarVisible(true);
    clearTimeout(tempBarHideTimerRef.current);
    if (heaterOn) {
      setBarRunning(true);
      setFillActive(false);
      // Focuses the gauge itself the moment it's revealed -- this is
      // different from the "advance to the next already-existing/reachable
      // control" guidance jumps removed elsewhere in this file (those
      // stayed removed): the heater button's own four arrow directions are
      // already fully spoken for (Right/Up/Down per the explicit nav graph
      // near the top of this component), so there's no spare direction
      // left to reach this brand-new gauge with. Same idea as Dropdown's
      // firstOptionRef auto-focus in CustomerOrdering.js -- opening a new
      // widget focuses *into* it, it just never got removed there. Without
      // this, Enter/Space can never land on the gauge at all, so stopBar
      // never fires and the fill/zone animations never play.
      barRef.current?.focus();
      // Two nested rAFs (one frame to let the just-mounted gauge paint at
      // its resting scaleX(0), a second to actually flip the class) --
      // see the fillActive comment above for why a single rAF/tick isn't
      // reliably enough for the browser to have committed that first
      // paint yet. The zone timers are scheduled from inside the same
      // callback that flips fillActive so they stay keyed to the instant
      // the fill visually starts moving, not to whenever heaterOn changed.
      rafIdsRef.current = [
        requestAnimationFrame(() => {
          rafIdsRef.current = [
            requestAnimationFrame(() => {
              setFillActive(true);
              zoneTimersRef.current = [
                setTimeout(() => setTempZone('target'), GREEN_AT_MS),
                setTimeout(() => setTempZone('over'), RED_AT_MS),
              ];
            }),
          ];
        }),
      ];
    } else {
      setBarRunning(false);
      setFillActive(false);
    }
    return () => {
      zoneTimersRef.current.forEach(clearTimeout);
      rafIdsRef.current.forEach(cancelAnimationFrame);
      clearTimeout(tempBarHideTimerRef.current);
    };
  }, [heaterOn]);

  // Freezes the fill exactly where it currently is (see getCurrentScaleX)
  // and stops the zone timers, locking in whatever color the button is
  // showing at that instant as the "reading" the player caught. Also flips
  // tempConfirmed on -- unlike the matcha scoop (whose scoopConfirmed
  // deliberately waits out a fill animation + linger first), there's no
  // similar "settle" beat needed here, since the temp bar's fill freezes
  // instantly rather than animating open like the scoop bar's does. Then,
  // after TEMP_BAR_LINGER_MS -- long enough for the player to actually
  // register the reading they just caught -- tempBarVisible flips off and
  // the whole gauge disappears (see the JSX below), leaving the kettle as
  // the only remaining thing to interact with.
  const stopBar = () => {
    if (!barRunning) return;
    zoneTimersRef.current.forEach(clearTimeout);
    zoneTimersRef.current = [];
    const fill = fillRef.current;
    if (fill) {
      const frozenScaleX = getCurrentScaleX(fill);
      // transitionProperty (longhand), not the transition shorthand -- see
      // the comment above in the reset effect for why.
      fill.style.transitionProperty = 'none';
      fill.style.transform = `scaleX(${frozenScaleX})`;
      // Same 0-100 percent-space TEMP_BAR_TICKS/TEMP_BAR_EXACT_LINE already
      // use (frozenScaleX is the fraction of the bar's full width the fill
      // had reached) -- see tempFillPercent's own comment above.
      setTempFillPercent(frozenScaleX * 100);
    }
    setBarRunning(false);
    setTempConfirmed(true);
    clearTimeout(tempBarHideTimerRef.current);
    tempBarHideTimerRef.current = setTimeout(() => setTempBarVisible(false), TEMP_BAR_LINGER_MS);
  };

  // Stops the gauge on Enter, same "confirm/select" gesture every other
  // item in this game already uses -- this (and the scoop gauge below)
  // used to be stopped on Backspace instead, but per request Backspace/Back
  // is no longer used for playing any challenge in this game at all; it's
  // exclusively the "would you like to exit?" prompt now (see App.js's own
  // Back handler), from every screen, so it needed to stop being
  // overloaded as a per-station "stop the running challenge" gesture here.
  const handleBarKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    stopBar();
  };

  // ---- Movable countertop items: free drag anywhere on the counter -------
  const [itemPositions, setItemPositions] = useState(MOVABLE_START);
  // Which item (if any) is being dragged right now, and its live position.
  const [drag, setDrag] = useState(null); // { key, left, top } | null
  const dragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });

  // Sends focus to the kettle itself the instant the temp gauge disappears
  // (tempBarVisible flipping false, TEMP_BAR_LINGER_MS after stopBar). Same
  // "the control that was focused is unmounting, so it must hand focus off
  // explicitly or it falls into the void" reasoning as the scoop-bar/big-
  // spoon pair above -- the gauge (barRef) is what's been focused since it
  // opened, and it's about to be removed from the DOM outright -- but
  // rather than landing back on the heater button that opened it, this
  // sends focus straight on to the kettle, exactly where play continues
  // next (arrow over and press Enter to pour the water, same beat
  // showKettleHint/showKettleSpotlight below already flash on).
  useEffect(() => {
    if (!tempBarVisible) {
      kettleRef.current?.focus();
    }
  }, [tempBarVisible]);

  // ---- Kettle water-pour sequence: same "hover, then pour" shape as the
  // matcha spoon's dump sequence, but layered on top of the *shared*
  // itemPositions/drag state above (kettle is still one of MOVABLE_ITEMS)
  // rather than its own dedicated position state the way the spoon has,
  // since the kettle needs to keep behaving like an ordinary movable item
  // outside of an actual pour.
  //   'idle'    -- normal, freely draggable/placeable, same as ever.
  //   'moving'  -- confirmed (drag-dropped on the bowl once tempConfirmed,
  //                or Enter/Space) -- gliding to the fixed hover-over-the-
  //                bowl spot (getKettleHoverPos), tilted via .pouring (see
  //                KETTLE_POUR_ROTATE_DEG). No longer draggable.
  //   'pouring' -- arrived; the falling-water effect is playing and the
  //                bowl's water fill (bowlWater below) is growing in step.
  // Then automatically (no distinct 'done' stage needed) it glides back to
  // MOVABLE_START.kettle and returns straight to 'idle', ready to be picked
  // up again -- unlike the spoon, the kettle isn't a used-up item.
  const [kettleStage, setKettleStage] = useState('idle');
  // The "liquid pour" Audio instance currently playing for the kettle's
  // water pour (see playLiquidPouring below) -- held in a ref, same
  // reasoning/shape as Milk Selection's and Toppings Station's own
  // pourAudioRef, so it can be cut short the moment KETTLE_POUR_MS ends
  // rather than playing out past the pour itself.
  const pourAudioRef = useRef(null);

  // The bowl's own persistent "has water been poured in" state -- same
  // "doesn't reset on tin/selection changes" persistence as bowlPowder,
  // and the same caveat that a second pour just restarts this rather than
  // accumulating a bigger fill. { } | null (no color needed -- always
  // BOWL_WATER_FILL_COLOR -- so just a presence flag in object form for
  // consistency with bowlPowder's shape).
  const [bowlWater, setBowlWater] = useState(null);

  // Tenth highlight beat: picks up the instant the temp bar sequence
  // finishes (tempBarVisible flipping false is exactly what focuses the
  // kettle -- see the effect above) and retires the instant the water's
  // actually poured into the bowl (bowlWater flips truthy the moment
  // kettleStage reaches 'pouring' -- see that stage's effect further down),
  // not just the moment the player starts the pour -- the flash/label
  // should stay up through the whole glide-to-the-bowl beat and only clear
  // once the water's actually landed.
  const showKettleHint = !tempBarVisible && !bowlWater;

  // Fifth walkthrough beat, first order only -- see the big comment on
  // showTinSpotlight/showScoopSpotlight/showSpoonSpotlight further up.
  // Reuses showKettleHint's own boundary, exempting the kettle itself
  // instead of a hint label + flashing halo.
  const showKettleSpotlight = customerNumber === 1 && showKettleHint;

  // Sixth beat -- covers the actual pour, once the kettle's reached the
  // bowl and water starts falling (kettleStage 'pouring', the same instant
  // bowlWater is set -- see that stage's own effect further down). Ends the
  // moment kettleStage resets to 'idle' again (pour finished), which is
  // also exactly when showWhiskHint's own conditions first become true --
  // see that flag further down for the next beat. Exempts the kettle, the
  // falling-water effect (.spoon-pour, reused from the matcha spoon's own
  // pour -- see the JSX further down), and the bowl itself plus its
  // powder/water contents, so the whole "water landing in the bowl" moment
  // stays visible rather than being cut off by the tint mid-pour.
  const showKettlePourSpotlight = customerNumber === 1 && kettleStage === 'pouring';
  // This used to also be bumped once per pour and used as bowl-water's React
  // `key`, so a repeat pour got a fresh mount and the grow animation reliably
  // replayed. Dropped entirely -- confirmed (via a live DOM count during
  // troubleshooting) that repeating the tin -> scoop -> dump -> heat -> pour
  // flow more than once in a session was leaving old key={waterPourCount}
  // instances mounted instead of being cleaned up, silently piling up
  // .bowl-water/.bowl-powder ghosts on the counter (only visible for the
  // matcha mound, since the water pool's own whiskStage !== 'done' gate
  // happened to hide all of them at once regardless of count). bowl-water
  // is now a single stable (unkeyed) element -- it always exists at most
  // once, by construction, at the cost of not replaying its grow-in
  // animation if the player redoes the pour within the same session.

  // ---- Whisking sequence: same "hover/settle, then act" shape as the
  // kettle's above, but the whisk settles *into* the bowl rather than
  // hovering over it (see getWhiskMixPos above) and doesn't glide back out
  // afterward -- once the mixing's done, it just stays resting in the bowl
  // for the rest of this visit, since this is the last interactive step in
  // the station rather than a reusable tool.
  //   'idle'    -- normal, freely draggable/placeable, same as ever.
  //   'moving'  -- confirmed (drag-dropped on the bowl once matcha and
  //                water are both already in, or Enter/Space) -- gliding
  //                into the bowl (getWhiskMixPos). No longer draggable.
  //   'mixing'  -- arrived; stirring in place (see .mixing in
  //                MatchaMaking.css) while the balance minigame bar is up
  //                and the ball-physics effect further down is running.
  //   'done'    -- minigame's timer ran out; stirring stops, the bar
  //                unmounts, and the whisk just rests in the bowl (still
  //                focusable -- see the settling comment further down for
  //                why that's deliberately not also disabled).
  const [whiskStage, setWhiskStage] = useState('idle');
  // DOM ref for the balance minigame's ball -- its position is written
  // directly via this ref inside the physics effect further down, once per
  // animation frame, rather than through React state -- see that effect's
  // own comment for why (avoiding a re-render on every single frame).
  const mixBallRef = useRef(null);
  // Physics state for the ball above -- plain mutable refs, not React
  // state, since they're read/written every animation frame by the effect
  // further down and have no reason to ever trigger a re-render themselves
  // (the DOM is updated directly via mixBallRef instead). Both are reset
  // fresh at the start of every mixing attempt.
  const mixPositionRef = useRef(0); // % along the bar, left edge of the ball
  const mixVelocityRef = useRef(0); // %/second
  // One entry per mess-up during the current mixing session, in the order
  // they happened -- { side: 'left' | 'right', left, top } -- capped at
  // SPILL_IMAGE_COUNT entries (there are only that many PNGs). left/top are
  // *absolute* container percentages, frozen at the exact spot on the
  // counter the puddle landed at the moment it was created (see
  // bowlPosRef/bowlItemRef below) -- deliberately not re-derived from the
  // bowl's own live position on every render, so the puddles stay put on
  // the table even once the bowl is later dragged around or carried off to
  // the Make Drink zone, rather than following it. Entry i always renders
  // with SPILL_DIMS[i] and whichever grade's SPILL_IMAGES_BY_GRADE[i] the
  // scooped tin was (see bowlPowder.grade in the JSX below), so the puddles
  // visibly escalate in size/mess as the array grows. See the balance
  // physics effect further down for how entries get pushed and how
  // mess-ups beyond the cap are handled instead (spillGrowth below).
  const [spills, setSpills] = useState([]);
  // Mirrors the spills state array above, kept in perfect lockstep (see
  // every setSpills call below, which always also updates this) -- exists
  // purely so the tick() closure inside the physics effect can synchronously
  // read "how many puddles are already on this side" (for the slot-stagger
  // math) without waiting a render cycle for state to catch up, since
  // several mess-ups can each want to push their own entry within the same
  // animation frame's neighborhood.
  const spillsRef = useRef([]);
  // Always-current snapshot of the bowl's own live position/box, refreshed
  // every render via the effect right below (bowlPos/bowlItem themselves are
  // plain consts recomputed each render, not refs, so they're not otherwise
  // reachable from inside the tick() closure, which only runs its setup once
  // per mixing session). This is what lets a freshly-created spill capture
  // "wherever the bowl actually is right now" even though the bowl may have
  // been dragged since mixing began.
  const bowlPosRef = useRef({ left: 0, top: 0 });
  const bowlItemRef = useRef({ width: 0, height: 0 });
  // How many mess-ups have happened *after* the spills array above already
  // hit its cap -- scales every puddle already on screen up together (see
  // SPILL_GROWTH_STEP/SPILL_GROWTH_CAP) rather than adding a 5th image that
  // doesn't exist.
  const [spillGrowth, setSpillGrowth] = useState(0);
  // Raw count of every qualifying mess-up this mixing session, tracked in a
  // ref (not state) purely so the tick() closure below can cheaply decide
  // "is this the Nth mess-up" without depending on the spills state array
  // itself (which would need to be threaded through the rAF closure).
  const messUpCountRef = useRef(0);

  const handlePointerDown = (item) => (e) => {
    const base = itemPositions[item.key];
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      left: base.left,
      top: base.top,
    };
    setDrag({ key: item.key, left: base.left, top: base.top });
  };

  const handlePointerMove = (item) => (e) => {
    if (!drag || drag.key !== item.key) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - dragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - dragStartRef.current.pointerY) / rect.height) * 100;
    setDrag({
      key: item.key,
      left: clampPct(dragStartRef.current.left + dxPct, item.width),
      top: clampPct(dragStartRef.current.top + dyPct, item.height),
    });
  };

  // Snap back to the item's original counter spot if it's dropped close to
  // it -- "close" is scaled to the item's own footprint (half its width/
  // height) rather than a flat distance, so the tiny whisk needs a
  // reasonably precise drop while the much bigger bowl has a more forgiving
  // catch zone. Dropped anywhere else, it just stays exactly where it landed.
  const SNAP_FRACTION = 0.5;

  const handlePointerUp = (item) => (e) => {
    if (!drag || drag.key !== item.key) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // Special case: dropping the *kettle* on the bowl once a temperature's
    // been confirmed starts the water-pour sequence (beginKettleDump,
    // defined further down alongside the bowl/kettle position math it
    // needs) instead of the ordinary snap-back-or-stay-put placement below.
    // Before tempConfirmed (or for the bowl/whisk, or once already mid-
    // pour), this falls through to that same ordinary placement, same as
    // always.
    if (
      item.key === 'kettle' &&
      tempConfirmed &&
      kettleStage === 'idle' &&
      isOverBowl(drag.left, drag.top, bowlPos, bowlItem)
    ) {
      setDrag(null);
      beginKettleDump();
      return;
    }
    // Same idea, for the *whisk* -- dropping it on the bowl once both the
    // matcha and the water are already in (bowlPowder/bowlWater both
    // truthy) starts the mixing sequence (beginWhiskMix, defined further
    // down alongside the bowl/whisk position math it needs) instead of
    // falling through to the ordinary placement below. Before either of
    // those, or once already mid-mix, this falls through same as always --
    // there's nothing to whisk yet, or it's already being whisked.
    if (
      item.key === 'whisk' &&
      bowlPowder &&
      bowlWater &&
      whiskStage === 'idle' &&
      isOverBowl(drag.left, drag.top, bowlPos, bowlItem)
    ) {
      setDrag(null);
      beginWhiskMix();
      return;
    }
    // Same idea, for the *bowl* -- once whisking is done, dropping it on
    // the "Make Drink" label (see MAKE_DRINK_ZONE/isOverMakeDrinkZone
    // above) carries it into that zone and fades it away (the whisk stays
    // put on the counter), same beginBowlCarry sequence the bowl's own
    // Enter press triggers (see handleBowlKeyDown further down) -- rather
    // than the ordinary placement below. Before whiskStage is 'done', or
    // dropped anywhere else, this falls through same as always.
    if (item.key === 'bowl' && whiskStage === 'done' && bowlStage === 'idle' && isOverMakeDrinkZone(drag.left, drag.top)) {
      setDrag(null);
      beginBowlCarry();
      return;
    }
    const start = MOVABLE_START[item.key];
    const snapBack =
      Math.abs(drag.left - start.left) < item.width * SNAP_FRACTION &&
      Math.abs(drag.top - start.top) < item.height * SNAP_FRACTION;
    setItemPositions((prev) => ({
      ...prev,
      [item.key]: snapBack ? { left: start.left, top: start.top } : { left: drag.left, top: drag.top },
    }));
    setDrag(null);
  };

  // D-pad/keyboard equivalent of successfully dragging the kettle onto the
  // bowl -- same "no keyboard equivalent of 'drag it partway', so Enter
  // goes straight to the one meaningful outcome" reasoning as the spoon's
  // handleBigSpoonKeyDown. Only kettle/whisk get their own onKeyDown (see
  // the conditional onKeyDown in the MOVABLE_ITEMS JSX below) -- the bowl
  // still has no keyboard action of its own.
  const handleKettleKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (!tempConfirmed || kettleStage !== 'idle') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    playButtonClick();
    beginKettleDump();
  };

  // Same idea, for the whisk -- see beginWhiskMix further down for the
  // bowlPowder/bowlWater gating reasoning (mirrors the isOverBowl special
  // case in handlePointerUp above).
  const handleWhiskKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (!bowlPowder || !bowlWater || whiskStage !== 'idle') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    playButtonClick();
    beginWhiskMix();
  };

  // ---- "Make Drink": once whisking is done, carries the bowl into the
  // Make Drink zone and fades it away (the whisk stays behind on the
  // counter -- it was only ever resting in the bowl visually, not actually
  // tracking its position), rather than advancing to the next station
  // immediately -- the player still moves on via the ordinary ProgressBar
  // action (Right arrow / the current-step dot) whenever they're actually
  // ready, same as leaving any other station -- see the final highlight
  // beat further down that flashes the bar once this is done.
  //   'idle'      -- normal, bowl still sits wherever it was left.
  //   'carrying'  -- confirmed (dropped on the Make Drink label, or
  //                  Enter/Space) -- gliding to the zone's own center. Still
  //                  fully visible, no longer draggable.
  //   'vanishing' -- arrived; shrinking/fading away (see .bowl-vanishing in
  //                  MatchaMaking.css).
  //   'sent'      -- fade's finished; the bowl stops rendering entirely
  //                  (see the MOVABLE_ITEMS.map JSX below).
  const [bowlStage, setBowlStage] = useState('idle');

  // Twelfth highlight beat: picks up the instant whisking finishes
  // (whiskStage settles on 'done') and retires the instant the player
  // actually sends the bowl off (beginBowlCarry moves bowlStage off
  // 'idle'), same "flash until acted on" shape as every earlier beat.
  const showBowlHint = whiskStage === 'done' && bowlStage === 'idle';

  // Ninth walkthrough beat, first order only -- reuses showBowlHint's own
  // boundary, exempting the bowl (see MOVABLE_ITEMS' isBowl handling
  // further down) and the whole ProgressBar (see spotlightExempt passed to
  // <ProgressBar> further down, OR'd together with showStationAdvanceSpotlight
  // below so the bar stays exempt continuously across both of this
  // screen's last two beats) instead of a hint label + flashing halo.
  const showBowlCarrySpotlight = customerNumber === 1 && showBowlHint;

  // Tenth and final walkthrough beat -- reuses the SAME boundary this
  // screen's own final highlight beat already uses (bowlStage === 'sent',
  // see highlightCurrentStep on <ProgressBar> further down), exempting the
  // whole ProgressBar instead of its plain currentStepHint label.
  const showStationAdvanceSpotlight = customerNumber === 1 && bowlStage === 'sent';

  useEffect(() => {
    if (bowlStage === 'carrying') {
      const t = setTimeout(() => setBowlStage('vanishing'), BOWL_CARRY_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (bowlStage === 'vanishing') {
      const t = setTimeout(() => setBowlStage('sent'), BOWL_VANISH_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [bowlStage]);

  // Snapshotting bowlPowder here (rather than letting MilkSelection read
  // this screen's own state, which won't exist anymore once the player
  // eventually does advance away) is what lets the next screen know which
  // grade's whisked-liquid image to show -- see onSendToMilk (a prop from
  // App.js, which stores it in state and passes it down to MilkSelection as
  // incomingBowl). Fired right away, at the moment the bowl starts its
  // carry, not deferred until the fade finishes -- the data hand-off itself
  // doesn't need to wait on the animation, only the actual station
  // transition (now decoupled from this entirely) would.
  const beginBowlCarry = () => {
    if (!bowlPowder || whiskStage !== 'done' || bowlStage !== 'idle') return;
    onSendToMilk?.({ ...bowlPowder });
    // Grades this station's own four beats (tin/grade, scoop amount, water
    // temperature, whisking-without-spilling) against the placed order --
    // see gameloop/scoring.js's own big comment on scoreMatchaMaking for
    // what each of these captures. This is the last moment any of that
    // transient minigame state still exists to read (this whole component
    // unmounts the instant App.js advances to Milk Selection), same "read
    // it right at the handoff" reasoning as onSendToMilk itself just above.
    // messUpCountRef.current (not spills.length, which caps at however many
    // puddle images exist) is the true, uncapped spill count for this
    // whisking session -- see that ref's own comment further up.
    onScored?.(
      scoreMatchaMaking({
        selectedTin,
        scoopFillPercent,
        tempFillPercent,
        spillCount: messUpCountRef.current,
        order,
      })
    );
    setItemPositions((prev) => ({
      ...prev,
      bowl: {
        left: MAKE_DRINK_ZONE.left + MAKE_DRINK_ZONE.width / 2 - bowlItem.width / 2,
        top: MAKE_DRINK_ZONE.top + MAKE_DRINK_ZONE.height / 2 - bowlItem.height / 2,
      },
    }));
    setBowlStage('carrying');
  };

  // D-pad/keyboard equivalent of dropping the bowl on the Make Drink label
  // -- same "no keyboard equivalent of 'drag it partway'" reasoning as
  // handleKettleKeyDown/handleWhiskKeyDown above.
  const handleBowlKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (whiskStage !== 'done' || bowlStage !== 'idle') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    playButtonClick();
    beginBowlCarry();
  };

  // ---- Matcha tin selection: reveals the scoop gauge -------------------
  // Which tin (if any) has been confirmed -- null hides the scoop gauge
  // entirely. Deliberately not tied to focus (a tin still gets its white
  // halo just from being focused/clicked, via :focus-visible in the CSS,
  // same as any other selectable item) -- the gauge itself only shows up
  // once the player actually presses Enter/Space on a tin, same "confirm"
  // gesture used everywhere else in the game (cup, ice cubes, temp bar).
  // Enter on the already-confirmed tin toggles it back off; Enter on a
  // different tin swaps straight to that one instead.
  const [selectedTin, setSelectedTin] = useState(null);

  // Which tin (if any) currently has the white focus halo -- driven by
  // plain onFocus/onBlur on each tin (see the JSX below), separate from
  // selectedTin above since the halo shows up just from being
  // focused/clicked, before Enter ever confirms anything. Powers the
  // name label under whichever tin is currently focused (see TIN_LABELS/
  // .matcha-tin-label). The onBlur guard (only clear if this tin is still
  // the one recorded) avoids a stale clear if focus has already moved to a
  // different tin by the time this one's blur fires.
  const [focusedTin, setFocusedTin] = useState(null);

  // Fifth highlight beat: picks up the instant showOrderHint retires (see
  // its comment above) -- the three tins themselves flash and a hint
  // points out arrow keys + Enter, same "the highlighted thing becomes the
  // next thing selected" flow as every other beat, retiring in turn once
  // selectedTin actually has a real grade in it (Enter confirms one --
  // see handleTinKeyDown below).
  const showTinHint = !showOrderHint && !selectedTin;

  const handleTinKeyDown = (item) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    playButtonClick();
    setSelectedTin((prev) => (prev === item.key ? null : item.key));
  };

  // ---- Scoop gauge: focuses itself the moment a tin is confirmed --------
  // selectedTin flipping to a real key both reveals the bar (see the JSX
  // below) and sends focus straight to it, so the very next Enter/Space the
  // player presses -- no extra navigating needed -- stops the slider right
  // where it is. If the slider was left frozen from a previous stop, clear
  // that freeze first so switching to a fresh tin always leaves it running.
  const [scoopRunning, setScoopRunning] = useState(false);
  // How full the green "measured amount" fill reads, 0-100 -- 0 while the
  // slider's still running (no reading locked in yet) and whenever a fresh
  // tin is selected, then set once by stopScoop below. Plain state (not a
  // ref-driven freeze like the slider/heater bar) since it only ever moves
  // in one direction, from 0 up to its target, and never needs to be
  // frozen mid-animation.
  const [scoopFillPercent, setScoopFillPercent] = useState(0);
  // Whether a reading's been locked in for the *current* tin selection --
  // flips the display over from the three small reference spoons to the
  // big carryable spoon (see the JSX below). Reset alongside scoopFillPercent
  // whenever selectedTin changes so re-opening (or switching) a tin always
  // starts a fresh scoop attempt.
  const [scoopConfirmed, setScoopConfirmed] = useState(false);
  const scoopBarRef = useRef(null);
  const scoopSliderRef = useRef(null);
  // Holds the timer that flips scoopConfirmed on, scheduled from stopScoop
  // below to fire only once the fill's finished animating up to the caught
  // line (SCOOP_FILL_DURATION_MS) -- not the instant Enter/Space is
  // pressed. Cleared on tin-change/unmount so a still-pending one from an
  // abandoned attempt can't fire late against a fresh selection.
  const scoopConfirmTimerRef = useRef(null);

  // ---- Big scoop spoon: pick up, drag onto the bowl, dump the powder ----
  // Appears once scoopConfirmed flips true (see above); position resets to
  // BIG_SPOON_START each time a fresh tin selection starts, same as
  // scoopFillPercent/scoopConfirmed.
  const [bigSpoonPos, setBigSpoonPos] = useState(BIG_SPOON_START);
  const [bigSpoonDrag, setBigSpoonDrag] = useState(null); // { left, top } | null
  // Where the spoon is in the dump sequence -- see the BIG_SPOON_MOVE_MS/
  // BIG_SPOON_POUR_MS comment above:
  //   'idle'    -- normal, freely draggable/placeable.
  //   'moving'  -- confirmed (drag-dropped on the bowl, or Enter/Space);
  //                gliding to the fixed hover-above-bowl spot. Still fully
  //                visible and no longer draggable.
  //   'pouring' -- arrived; .spoon-pour's falling-powder effect is playing,
  //                and the bowl's mound (bowlPowder below) is growing in
  //                step with it.
  //   'done'    -- pour finished, mound's at full size, spoon is put away
  //                (unmounted -- see the JSX below) for the rest of this
  //                tin selection.
  const [bigSpoonStage, setBigSpoonStage] = useState('idle');
  // The "matcha powder pour" Audio instance currently playing for the
  // spoon's dump (see playMatchaPowderPour below) -- held in a ref, same
  // reasoning/shape as pourAudioRef above, so it can be cut short the
  // moment BIG_SPOON_POUR_MS ends rather than playing out past the pour.
  const spoonPourAudioRef = useRef(null);

  // Seventh highlight beat: picks up the instant the spoon itself appears
  // (scoopConfirmed flipping true is exactly what mounts it -- see the JSX
  // below) and retires the instant the player actually starts the pour
  // (beginDump moves bigSpoonStage off 'idle' -- see beginDump further
  // down) -- there's no need to keep flashing once they've already acted.
  const showSpoonHint = scoopConfirmed && bigSpoonStage === 'idle';

  // First-order-only walkthrough, continued from Customer Ordering and
  // showStationSpotlight above -- three more beats, one per remaining step
  // on this station, each swapping the spotlight's own exempt target as the
  // player works through the tins -> scoop gauge -> spoon-into-bowl chain.
  // All pink, same as every other beat in this whole walkthrough (an
  // earlier pass tried a green tint for the scoop-gauge beat specifically,
  // per an since-reversed request -- back to plain pink like the rest).
  // All three reuse an EXISTING state boundary that already exactly matches
  // the target's own on-screen lifecycle, rather than tracking a separate
  // one-way flag each -- the underlying UI already appears/disappears at
  // precisely the right moments for this to just tag along:
  //   - showTinSpotlight: same window as showTinHint above (order hint's
  //     retired, no tin picked yet). Exempts the three tins.
  //   - showScoopSpotlight: selectedTin is set but scoopConfirmed hasn't
  //     flipped yet -- the exact same span the whole measuring assembly
  //     (bar/fill/slider/reference spoons, see the JSX below) stays
  //     mounted for, including the post-stop linger before the reading
  //     locks in. Exempts the scoop bar.
  //   - showSpoonSpotlight: scoopConfirmed is true and the big spoon hasn't
  //     finished its pour yet (bigSpoonStage !== 'done') -- the exact same
  //     span the big spoon itself is mounted for. Exempts the big spoon,
  //     the bowl, AND the bowl-powder mound that grows in as it pours (see
  //     .bowl-powder further down) -- that one's easy to miss since it only
  //     exists once the pour's actually started, well after this phase
  //     itself begins. Deliberately keyed off scoopConfirmed (not the
  //     earlier moment the player stops the slider) since the spoon this
  //     phase is supposed to exempt doesn't actually exist in the DOM until
  //     then -- ending this phase any earlier would leave a gap with
  //     nothing exempted at all.
  // A fourth beat, showHeaterSpotlight, lives further down (right by
  // showHeaterHint, which it reuses the exact same boundary of) since that
  // one depends on state declared later in the component.
  // Each phase's own arrow+label callout (further down in the JSX) shares
  // these same booleans, and each one's presence also suppresses that
  // step's OLD plain-text hint (matcha-tin-hint/scoop-bar-hint/big-spoon-
  // hint) so the two don't show at once -- same "new pink-styled callout
  // replaces the old text hint for the first order only" treatment
  // showStationSpotlight already uses for the Order button above; orders
  // 2/3 (customerNumber !== 1) still get exactly those old hints, untouched.
  const showTinSpotlight = customerNumber === 1 && showTinHint;
  const showScoopSpotlight = customerNumber === 1 && !!selectedTin && !scoopConfirmed;
  const showSpoonSpotlight = customerNumber === 1 && scoopConfirmed && bigSpoonStage !== 'done';

  // Moves focus onto the first (cafe-grade) tin the instant showTinSpotlight
  // turns on -- same "the highlighted thing becomes the next thing
  // selected" pattern as showOrderButtonLock's own focus effect above, this
  // time for the walkthrough's next beat. Reaches for the tin by class
  // (same '.selectable' query this station's own nav-graph effect above
  // uses for firstTin) rather than a dedicated ref, since the three tins are
  // rendered from tinItems below with no ref array of their own.
  useEffect(() => {
    if (showTinSpotlight) {
      containerRef.current?.querySelector('.selectable')?.focus();
    }
  }, [showTinSpotlight]);

  // The bowl's own persistent "what's in it" state -- deliberately *not*
  // reset when selectedTin changes (unlike the state above), so closing the
  // tin selector or picking a different tin doesn't erase matcha that's
  // already been tipped into the bowl. { color } | null. Mounted the moment
  // 'pouring' starts (see the stage-transition effect below).
  const [bowlPowder, setBowlPowder] = useState(null);

  // Eleventh highlight beat: picks up the instant both the matcha and the
  // water are actually in the bowl and the kettle's back to idle (the same
  // conditions beginWhiskMix/handleWhiskKeyDown themselves gate on -- see
  // those further down), and retires the instant the player actually
  // starts whisking (beginWhiskMix moves whiskStage off 'idle'), same
  // "flash until acted on" shape as every earlier beat.
  const showWhiskHint = Boolean(bowlPowder) && Boolean(bowlWater) && kettleStage === 'idle' && whiskStage === 'idle';

  // Seventh and final walkthrough beat, first order only -- reuses
  // showWhiskHint's own boundary, exempting the whisk itself instead of a
  // hint label + flashing halo.
  const showWhiskSpotlight = customerNumber === 1 && showWhiskHint;

  // Eighth and final walkthrough beat, first order only -- picks up the
  // instant the player actually selects the whisk (showWhiskSpotlight above
  // retires the same instant, since whiskStage leaving 'idle' is exactly
  // what ends showWhiskHint too), covering both the brief glide-into-the-
  // bowl beat ('moving') and the whole balance minigame ('mixing'). No
  // further beat follows this one -- it just clears once whiskStage reaches
  // 'done'. Exempts the bowl and its contents (bowl-powder/bowl-water,
  // same as showKettlePourSpotlight/showWhiskSpotlight above), the whisk
  // itself, the stirring swirl effect, the balance-minigame bar, and any
  // spill puddles, so the whole minigame -- everything the player actually
  // needs to see to play it -- stays visible while the rest of the counter
  // tints.
  const showMixSpotlight = customerNumber === 1 && (whiskStage === 'moving' || whiskStage === 'mixing');

  const bigSpoonDragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });
  const bigSpoonRef = useRef(null);

  useEffect(() => {
    setScoopFillPercent(0);
    setScoopConfirmed(false);
    setBigSpoonPos(BIG_SPOON_START);
    setBigSpoonStage('idle');
    clearTimeout(scoopConfirmTimerRef.current);
    if (selectedTin) {
      if (scoopSliderRef.current) {
        scoopSliderRef.current.style.animation = '';
        scoopSliderRef.current.style.top = '';
      }
      setScoopRunning(true);
      // Focuses the gauge itself the moment it's revealed -- same
      // "opening a new widget focuses into it" exception as the heater
      // bar above (see its comment for the full reasoning): the tin's own
      // four arrow directions are already fully spoken for (Left/Right to
      // cycle tins, Up to the order button, Down to the whisk), so
      // there's no spare direction to reach this brand-new gauge with.
      // Without this, Enter/Space can never land on it, so stopScoop
      // never fires and neither the fill nor the big-spoon animation that
      // follows it ever plays.
      scoopBarRef.current?.focus();
    } else {
      setScoopRunning(false);
    }
    return () => clearTimeout(scoopConfirmTimerRef.current);
  }, [selectedTin]);

  // Sends focus straight to the big spoon the instant it's revealed
  // (scoopConfirmed flipping true, which is also exactly when the gauge
  // above unmounts -- see the JSX below). Same "opening a new widget
  // focuses into it" exception as the gauge/heater-bar auto-focus above,
  // not the "advance to the next already-existing control" guidance jumps
  // that stayed removed elsewhere in this file: the spoon has no other
  // reachable path to it (the tin that spawned it has all four arrow
  // directions already spoken for), and the gauge it's replacing is about
  // to disappear out from under whatever focus was on it, so without this
  // focus would simply fall off into the void and Enter could never reach
  // beginDump -- the spoon would sit there permanently inert.
  useEffect(() => {
    if (scoopConfirmed) {
      bigSpoonRef.current?.focus();
    }
  }, [scoopConfirmed]);

  // Freezes the slider exactly where it currently is -- same
  // getComputedStyle-mid-animation trick as the heater's stopBar/
  // getCurrentScaleX above, just reading the live `top` instead of a
  // transform, since that's the property the keyframes animate here. Then
  // translates that frozen position into a fill reading: the slider's
  // `top` lives in the same top-percent space as SCOOP_BAR_MARKERS/
  // SCOOP_SPOON_LINES above (0% = top of the bar = "x 3" = most scoops,
  // 100% = bottom = "x 1" = fewest), so the green fill -- which grows
  // upward from the bottom, like a level gauge -- should reach exactly
  // (100 - that percent), the same "how close to the top" reading the
  // spoon labels already use. scoopConfirmed itself doesn't flip until
  // SCOOP_FILL_DURATION_MS + SCOOP_CONFIRM_LINGER_MS later (see
  // scoopConfirmTimerRef below) -- the player should see the color actually
  // finish rising to their caught line, then have a couple of beats to
  // register the fully-filled reading, before the whole measuring assembly
  // disappears and the big spoon takes over, rather than either vanishing
  // out from under the still-animating fill or swapping over the instant
  // it settles.
  const stopScoop = () => {
    if (!scoopRunning) return;
    const el = scoopSliderRef.current;
    if (el) {
      const frozenTop = window.getComputedStyle(el).top;
      el.style.animation = 'none';
      el.style.top = frozenTop;

      const bar = scoopBarRef.current;
      const barHeight = bar?.clientHeight ?? 0;
      const topPx = parseFloat(frozenTop);
      if (barHeight > 0 && !Number.isNaN(topPx)) {
        const topPercent = Math.min(Math.max((topPx / barHeight) * 100, 0), 100);
        setScoopFillPercent(100 - topPercent);
      }
    }
    setScoopRunning(false);
    clearTimeout(scoopConfirmTimerRef.current);
    scoopConfirmTimerRef.current = setTimeout(
      () => setScoopConfirmed(true),
      SCOOP_FILL_DURATION_MS + SCOOP_CONFIRM_LINGER_MS
    );
  };

  // Stops the slider on Enter, same "confirm/select" gesture the heater
  // gauge's own handleBarKeyDown above now uses -- see that handler's own
  // comment for why Backspace/Back is no longer used for this.
  const handleScoopKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    stopScoop();
  };

  // Color the carried/dumped matcha reads -- keyed to whichever tin the
  // reading was just confirmed against, same lookup the scoop-bar-fill
  // itself uses.
  const scoopColor = SCOOP_FILL_COLORS[selectedTin] ?? SCOOP_FILL_COLORS['classic-grade'];

  // Kicks off the dump sequence (see bigSpoonStage above) -- shared by both
  // the drag-and-drop path and the Enter/Space path below, since they
  // should end up doing exactly the same thing once the drop/press is
  // confirmed. Guarded to 'idle' so a stray extra Enter press (or trying to
  // pick the spoon back up) mid-sequence can't retrigger or overlap it.
  const beginDump = () => {
    if (bigSpoonStage !== 'idle') return;
    setBigSpoonPos(getSpoonHoverPos(bowlPos, bowlItem));
    setBigSpoonStage('moving');
  };

  // Advances the dump sequence's later stages on a timer -- 'moving' holds
  // just long enough for the glide-to-hover-spot CSS transition to finish
  // (see BIG_SPOON_MOVE_MS), then 'pouring' mounts the bowl's mound (see the
  // JSX below -- no longer separately keyed, see that div's own comment for
  // why), timed to finish exactly when BIG_SPOON_POUR_MS's falling-powder
  // effect does, then finally puts the spoon away. Re-running this effect
  // (e.g. selectedTin resetting
  // bigSpoonStage back to 'idle' mid-sequence) cleans up whichever timer
  // was pending via the return below, so an abandoned sequence can't fire
  // late.
  useEffect(() => {
    if (bigSpoonStage === 'moving') {
      const t = setTimeout(() => setBigSpoonStage('pouring'), BIG_SPOON_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (bigSpoonStage === 'pouring') {
      // "matcha powder pour" SFX -- fires once right as the powder
      // actually lands, same "on the 'pouring' transition, not 'moving'"
      // timing every other pour SFX here uses. Cut short (not left to
      // finish on its own) the moment BIG_SPOON_POUR_MS elapses below, and
      // also on cleanup (e.g. unmounting mid-pour).
      spoonPourAudioRef.current = playMatchaPowderPour();
      // grade (selectedTin at the moment of the dump) is what
      // WHISKED_LIQUID_IMAGES gets keyed off of once whiskStage reaches
      // 'done' -- captured here rather than read live off selectedTin later,
      // since selectedTin could in principle change/reset well before the
      // whisking minigame actually finishes.
      setBowlPowder({ color: scoopColor, grade: selectedTin });
      const t = setTimeout(() => {
        spoonPourAudioRef.current?.pause();
        spoonPourAudioRef.current = null;
        setBigSpoonStage('done');
      }, BIG_SPOON_POUR_MS);
      return () => {
        clearTimeout(t);
        spoonPourAudioRef.current?.pause();
        spoonPourAudioRef.current = null;
      };
    }
    return undefined;
  }, [bigSpoonStage, scoopColor, selectedTin]);

  // Eighth highlight beat: picks up the instant the pour finishes
  // (bigSpoonStage settling on 'done' -- see the effect above) and retires
  // the instant the player actually switches the heater on (its own native
  // button onClick flips heaterOn -- see the JSX below) -- same "flash
  // until acted on" shape as every earlier beat.
  const showHeaterHint = bigSpoonStage === 'done' && !heaterOn;

  // Fourth walkthrough beat, first order only -- see the big comment on
  // showTinSpotlight/showScoopSpotlight/showSpoonSpotlight above. Reuses
  // showHeaterHint's own boundary directly (same rising/falling edge: pour
  // finished, heater not on yet), exempting the heater button itself
  // instead of a hint label + flashing halo.
  const showHeaterSpotlight = customerNumber === 1 && showHeaterHint;

  // Continuation of the fourth beat -- once the heater's actually switched
  // on, the spotlight stays up but its exempt target grows to also cover
  // the temp gauge itself (see heaterOn && tempBarVisible's own render
  // condition further down, the exact same span this matches). The heater
  // button STAYS exempt through this too (see the combined condition on
  // .heater-button's own className further down) since it's still on
  // screen and still a valid thing to look at, not just the new gauge.
  // Ends the same instant the gauge itself would normally disappear
  // (tempBarVisible flipping false, after stopBar's own post-catch
  // linger) -- see showKettleSpotlight further down for the beat right
  // after this one.
  const showTempBarSpotlight = customerNumber === 1 && heaterOn && tempBarVisible;

  // Sends focus to the heater/kettle button the moment the pour finishes
  // (bigSpoonStage settling on 'done'). Not a "guided next step" nudge like
  // the ones that stayed removed elsewhere -- the big spoon that was
  // focused right up until this point actually unmounts the instant
  // bigSpoonStage hits 'done' (see the JSX below), so without handing focus
  // off explicitly it would just fall into the void (document.body) instead
  // of landing somewhere a player can see and act on. The heater button is
  // also exactly where play continues next (press Enter to heat the water,
  // same beat showHeaterHint/showHeaterSpotlight above already flash on),
  // so its white focus halo doubles as the cue for where to go.
  useEffect(() => {
    if (bigSpoonStage === 'done') {
      heaterButtonRef.current?.focus();
    }
  }, [bigSpoonStage]);

  const handleBigSpoonPointerDown = (e) => {
    if (bigSpoonStage !== 'idle') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    bigSpoonDragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      left: bigSpoonPos.left,
      top: bigSpoonPos.top,
    };
    setBigSpoonDrag({ left: bigSpoonPos.left, top: bigSpoonPos.top });
  };

  const handleBigSpoonPointerMove = (e) => {
    if (!bigSpoonDrag) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - bigSpoonDragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - bigSpoonDragStartRef.current.pointerY) / rect.height) * 100;
    setBigSpoonDrag({
      left: clampPct(bigSpoonDragStartRef.current.left + dxPct, BIG_SPOON_SIZE.width),
      top: clampPct(bigSpoonDragStartRef.current.top + dyPct, BIG_SPOON_SIZE.height),
    });
  };

  // Dropped over the bowl (using its *current* position -- see bowlPos/
  // bowlItem below, computed the same way kettlePos/kettleItem already are)
  // starts the dump sequence -- see beginDump above, which takes over from
  // here (glide to hover, pour, then stamp the bowl). Dropped anywhere
  // else, it just stays exactly where it landed, same free-placement
  // behavior as the kettle/bowl/whisk above.
  const handleBigSpoonPointerUp = (e) => {
    if (!bigSpoonDrag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (isOverBowl(bigSpoonDrag.left, bigSpoonDrag.top, bowlPos, bowlItem)) {
      setBigSpoonDrag(null);
      beginDump();
      return;
    }
    setBigSpoonPos(bigSpoonDrag);
    setBigSpoonDrag(null);
  };

  // D-pad/keyboard equivalent of successfully dragging the spoon onto the
  // bowl -- there's no keyboard equivalent of "drag it partway" (same as
  // the milk bottles/ice cubes elsewhere), so Enter here goes straight to
  // the same beginDump sequence the drop path above uses.
  const handleBigSpoonKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    playButtonClick();
    beginDump();
  };

  const bigSpoonRenderPos = bigSpoonDrag || bigSpoonPos;

  // ---- Kettle steam: appears once the water's hot enough (tempZone hits
  // 'target', i.e. the button just turned green) and keeps going for as
  // long as it stays hot, rather than cutting off the instant tempZone
  // moves on to 'over' -- reads the kettle's live position (drag position
  // while it's being dragged, its settled position otherwise) so the
  // wisps stay anchored to the spout even after the kettle's been moved.
  const kettleItem = MOVABLE_ITEMS.find((item) => item.key === 'kettle');
  const kettleDragging = drag?.key === 'kettle';
  const kettlePos = kettleDragging ? drag : itemPositions.kettle;
  const showSteam = heaterOn && tempZone !== 'below';
  const steamLeft = kettlePos.left + KETTLE_SPOUT_OFFSET.leftFrac * kettleItem.width;
  const steamTop = kettlePos.top + KETTLE_SPOUT_OFFSET.topFrac * kettleItem.height;

  // ---- Bowl's live position -- same "dragging vs. settled" pattern as the
  // kettle above, used both as the big spoon's drop-zone hit test
  // (handleBigSpoonPointerUp) and to keep the dumped powder mound anchored
  // to the bowl wherever it's been moved.
  const bowlItem = MOVABLE_ITEMS.find((item) => item.key === 'bowl');
  const bowlDragging = drag?.key === 'bowl';
  const bowlPos = bowlDragging ? drag : itemPositions.bowl;
  // Keeps bowlPosRef/bowlItemRef (declared up above alongside the spills
  // state) current every render -- no dependency array, so this runs after
  // every single render, same "always-fresh mutable snapshot for a callback
  // that can't otherwise see new render values" idiom as elsewhere in this
  // file. Plain assignment, not wrapped in an effect body that does
  // anything else, so it stays cheap.
  useEffect(() => {
    bowlPosRef.current = bowlPos;
    bowlItemRef.current = bowlItem;
  });
  const bowlPowderLeft = bowlPos.left + BOWL_POWDER_OFFSET.leftFrac * bowlItem.width;
  const bowlPowderTop = bowlPos.top + BOWL_POWDER_OFFSET.topFrac * bowlItem.height;
  // Full-grown target size -- always rendered at this size; the "grows
  // from nothing" effect is done with a CSS transform: scale() animation
  // (see .bowl-powder/@keyframes growFromCenter in MatchaMaking.css) rather
  // than by scaling this width down in JS, so width/height here can just
  // stay fixed at the final size the whole time. Height is derived from
  // this width via BOWL_MOUND_HEIGHT_FRAC (see that constant above), not a
  // flat 0.5, so the mound reads as an ellipse taller than it is wide.
  const bowlPowderWidth = BOWL_POWDER_SIZE_FRAC * bowlItem.width;
  const bowlPowderHeight = bowlPowderWidth * BOWL_MOUND_HEIGHT_FRAC;

  // ---- Kettle water-pour: begins the sequence (see kettleStage above),
  // advances it on timers, and computes the falling-water effect's anchor
  // -- all mirroring the matcha spoon's beginDump/stage-effect/pourLeft-
  // pourTop above, just keyed to the kettle's spout instead of the spoon's
  // mound, and ending by gliding back to the counter instead of
  // disappearing.
  const beginKettleDump = () => {
    if (kettleStage !== 'idle' || !tempConfirmed) return;
    setItemPositions((prev) => ({ ...prev, kettle: getKettleHoverPos(bowlPos, bowlItem, kettleItem) }));
    setKettleStage('moving');
  };

  const bowlWaterLeft = bowlPos.left + BOWL_WATER_OFFSET.leftFrac * bowlItem.width;
  const bowlWaterWidth = BOWL_WATER_SIZE_FRAC * bowlItem.width;
  const bowlWaterHeight = bowlWaterWidth * BOWL_WATER_HEIGHT_FRAC;
  // Starts from the same topFrac as the matcha mound (BOWL_WATER_OFFSET.
  // topFrac === BOWL_POWDER_OFFSET.topFrac), then shifts up by half the
  // difference between the two heights -- since both are centered via
  // transform: translate(-50%, -50%) in CSS, this is exactly the amount
  // that makes their *bottom* edges land in the same place, rather than the
  // taller water pool's bottom sitting further down than the mound's.
  const bowlWaterTop =
    bowlPos.top + BOWL_WATER_OFFSET.topFrac * bowlItem.height - (bowlWaterHeight - bowlPowderHeight) / 2;

  // The bowl's actual inner-rim ellipse (see BOWL_INNER_RIM_CENTER/
  // BOWL_INNER_RIM_WIDTH_FRAC/BOWL_INNER_RIM_HEIGHT_FRAC above) -- only used
  // to size/position the finished whisked-matcha image so it fills the
  // bowl's real visible interior rather than bowl-water's smaller,
  // more-circular box.
  const bowlInnerRimLeft = bowlPos.left + BOWL_INNER_RIM_CENTER.leftFrac * bowlItem.width;
  const bowlInnerRimTop = bowlPos.top + BOWL_INNER_RIM_CENTER.topFrac * bowlItem.height;
  const bowlInnerRimWidth = BOWL_INNER_RIM_WIDTH_FRAC * bowlItem.width;
  const bowlInnerRimHeight = BOWL_INNER_RIM_HEIGHT_FRAC * bowlItem.height;

  // Anchored to the kettle's actual spout opening (KETTLE_POUR_SPOUT_TOP_
  // FRAC), not KETTLE_SPOUT_OFFSET's raised steam-anchor point -- see the
  // comment on KETTLE_POUR_SPOUT_TOP_FRAC above for why those two differ.
  // Falls all the way down to bowlWaterTop, same "reach the actual target,
  // not just the bowl's bounding-box edge" reasoning as the spoon's
  // pourHeight.
  const kettlePourLeft = kettlePos.left + KETTLE_SPOUT_OFFSET.leftFrac * kettleItem.width;
  const kettlePourTop = kettlePos.top + KETTLE_POUR_SPOUT_TOP_FRAC * kettleItem.height;
  const kettlePourHeight = Math.max(bowlWaterTop - kettlePourTop, 1);

  useEffect(() => {
    if (kettleStage === 'moving') {
      const t = setTimeout(() => setKettleStage('pouring'), KETTLE_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (kettleStage === 'pouring') {
      // "liquid pour" SFX -- same clip/timing shape as Milk Selection's
      // base/matcha pours and Toppings Station's syrup pour: fires once
      // right as the water actually lands, cut short (not left to finish
      // on its own) the moment KETTLE_POUR_MS elapses below, and also on
      // cleanup.
      pourAudioRef.current = playLiquidPouring();
      setBowlWater({});
      const t = setTimeout(() => {
        pourAudioRef.current?.pause();
        pourAudioRef.current = null;
        setItemPositions((prev) => ({ ...prev, kettle: MOVABLE_START.kettle }));
        setKettleStage('idle');
        // Sends the halo straight to the whisk once the water's actually
        // landed -- per request, whisking is where play continues next, so
        // this skips the bowl and lands right on the tool that does it
        // (same beat showWhiskHint/showWhiskSpotlight below already flash
        // on), regardless of which item was just used to fill the bowl.
        whiskRef.current?.focus();
      }, KETTLE_POUR_MS);
      return () => {
        clearTimeout(t);
        pourAudioRef.current?.pause();
        pourAudioRef.current = null;
      };
    }
    return undefined;
  }, [kettleStage]);

  // ---- Whisking: begins the sequence (see whiskStage above), advances it
  // on a timer for the glide-in, then hands off to the balance-minigame
  // physics effect below for the 'mixing' stage -- mirrors the kettle's
  // beginKettleDump/stage-effect shape above, just settling *into* the bowl
  // instead of hovering over it, and never gliding back out afterward.
  const whiskItem = MOVABLE_ITEMS.find((item) => item.key === 'whisk');
  // Recomputed off the bowl's *current* position every render (cheap), same
  // as pourLeft/pourTop/kettlePourLeft above -- only actually rendered
  // while whiskStage === 'mixing' (see the JSX below), so the bar always
  // shows up right above wherever the bowl currently is, not wherever it
  // happened to be when mixing started.
  const mixBarPos = getMixBarPos(bowlPos, bowlItem);
  // Growth multiplier applied to every accumulated spill puddle once mess-ups
  // exceed SPILL_IMAGE_COUNT -- see spillGrowth/SPILL_GROWTH_STEP/
  // SPILL_GROWTH_CAP above. Recomputed every render like mixBarPos above.
  const spillGrowthScale = 1 + Math.min(spillGrowth * SPILL_GROWTH_STEP, SPILL_GROWTH_CAP - 1);

  const beginWhiskMix = () => {
    if (whiskStage !== 'idle' || !bowlPowder || !bowlWater) return;
    setItemPositions((prev) => ({ ...prev, whisk: getWhiskMixPos(bowlPos, bowlItem, whiskItem) }));
    setWhiskStage('moving');
  };

  useEffect(() => {
    if (whiskStage !== 'moving') return undefined;
    const t = setTimeout(() => setWhiskStage('mixing'), WHISK_MOVE_MS);
    return () => clearTimeout(t);
  }, [whiskStage]);

  // ---- Balance minigame physics -- runs for the whole 'mixing' stage.
  // Everything here is driven by a single requestAnimationFrame loop
  // rather than React state: the ball's own position is written straight
  // to the DOM via mixBallRef every frame (see mixPositionRef/
  // mixVelocityRef above), since a re-render on every single frame just to
  // move one div would be wasteful, and the motion needs to track the
  // display's actual refresh rate rather than React's render cycle. See
  // the MIX_HOLD_ACCEL/MIX_HOLD_GRACE_MS/MIX_DRIFT_*/
  // MIX_FRICTION_HALF_LIFE_S comment above for the physics model itself and
  // why "held" is tracked via a grace window rather than keyup.
  useEffect(() => {
    if (whiskStage !== 'mixing') return undefined;

    // "matcha whisking" SFX -- loops for this entire stage (see
    // playMatchaWhisking's own comment for why it's a loop rather than a
    // one-shot) and is explicitly stopped in this effect's own cleanup
    // below, which fires the moment whiskStage leaves 'mixing' -- whether
    // that's the minigame finishing normally (elapsedMs >= WHISK_MIX_
    // DURATION_MS further down) or the component unmounting mid-whisk.
    const whiskAudio = playMatchaWhisking();

    const ballWidthPercent = MIX_BALL_WIDTH_FRAC * 100;
    const maxPosition = 100 - ballWidthPercent;
    // Starts centered in the bar (not the zone specifically, though the
    // zone happens to be centered too) so the player gets a beat before
    // the drift meaningfully pushes it off-center.
    mixPositionRef.current = 50 - ballWidthPercent / 2;
    mixVelocityRef.current = 0;
    messUpCountRef.current = 0;
    spillsRef.current = [];
    setSpills([]);
    setSpillGrowth(0);

    const zoneLeftPercent = MIX_ZONE_LEFT_FRAC * 100;
    const zoneRightPercent = zoneLeftPercent + MIX_ZONE_WIDTH_FRAC * 100;

    // Timestamps (performance.now()-space) of the most recent qualifying
    // keydown for each direction -- a direction counts as "held" for
    // MIX_HOLD_GRACE_MS after its last event, which smooths over the gaps
    // between the browser's own auto-repeat firings so holding the key
    // reads as one continuous push instead of a series of separate kicks.
    let leftHeldUntil = 0;
    let rightHeldUntil = 0;

    // Intercepted in the *capture* phase, not the default bubble phase, so
    // this runs before useFlatFocusNav's own window keydown listener
    // (registered in the bubble phase) -- without this, Left/Right would
    // both push the ball AND move the D-pad focus off the whisk entirely,
    // since useFlatFocusNav listens for exactly those same two actions.
    // stopPropagation here is what keeps that listener from ever seeing
    // the event at all while the minigame is running.
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Left' && action !== 'Right') return;
      e.preventDefault();
      e.stopPropagation();
      const until = performance.now() + MIX_HOLD_GRACE_MS;
      if (action === 'Right') {
        rightHeldUntil = until;
      } else {
        leftHeldUntil = until;
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });

    const startTime = performance.now();
    let lastTime = startTime;
    let lastSpillAt = -Infinity;
    let rafId;

    const tick = (now) => {
      // Clamped so a dropped/backgrounded tab resuming later doesn't
      // apply one huge catch-up step to the physics.
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const elapsedMs = now - startTime;

      // Continuous acceleration while a direction is "held" (see
      // leftHeldUntil/rightHeldUntil above) -- both scaled by dt so this is
      // a smooth analog ramp rather than the old instant per-keydown jump.
      if (now < rightHeldUntil) mixVelocityRef.current += MIX_HOLD_ACCEL * dt;
      if (now < leftHeldUntil) mixVelocityRef.current -= MIX_HOLD_ACCEL * dt;

      const drift = MIX_DRIFT_AMPLITUDE * Math.sin((elapsedMs / 1000) * MIX_DRIFT_ANGULAR_FREQ);
      mixVelocityRef.current += drift * dt;
      // Exponential decay toward 0, scaled by dt so it's frame-rate
      // independent -- velocity halves every MIX_FRICTION_HALF_LIFE_S
      // seconds regardless of how often tick() actually runs.
      mixVelocityRef.current *= 0.5 ** (dt / MIX_FRICTION_HALF_LIFE_S);
      mixPositionRef.current += mixVelocityRef.current * dt;

      // Soft bounce off the ends instead of a dead stop -- reversing and
      // damping the velocity (rather than zeroing it outright) reads as the
      // ball glancing off the bar's edge, which is smoother/less jarring
      // than an instant full stop.
      if (mixPositionRef.current <= 0) {
        mixPositionRef.current = 0;
        mixVelocityRef.current = Math.abs(mixVelocityRef.current) * 0.3;
      } else if (mixPositionRef.current >= maxPosition) {
        mixPositionRef.current = maxPosition;
        mixVelocityRef.current = -Math.abs(mixVelocityRef.current) * 0.3;
      }

      const ballEl = mixBallRef.current;
      if (ballEl) {
        ballEl.style.left = `${mixPositionRef.current}%`;
        const ballCenter = mixPositionRef.current + ballWidthPercent / 2;
        const inZone = ballCenter >= zoneLeftPercent && ballCenter <= zoneRightPercent;
        ballEl.classList.toggle('in-zone', inZone);

        // Sloppy stirring (ball outside the green zone) spills matcha out of
        // the bowl on whichever side it drifted toward -- retriggers every
        // MIX_SPILL_INTERVAL_MS for as long as the ball stays out, not just
        // once on the initial exit, so a long stretch of poor balancing
        // keeps looking messy rather than showing a single splash and going
        // quiet. The first SPILL_IMAGE_COUNT mess-ups each add the next
        // puddle PNG in sequence, anchored to wherever the bowl actually is
        // *right now* (bowlPosRef/bowlItemRef, not the stale bowlPos this
        // effect closed over back when mixing started) and then frozen at
        // that exact spot -- see the spills state's own comment above for
        // why it's stored as absolute left/top rather than re-derived from
        // the bowl's position on every render, which used to make the
        // puddles drag along behind the bowl once it was picked up again.
        // Every mess-up after the cap just grows the puddles already on
        // screen instead (see SPILL_GROWTH_STEP above).
        if (!inZone && elapsedMs - lastSpillAt >= MIX_SPILL_INTERVAL_MS) {
          lastSpillAt = elapsedMs;
          const side = ballCenter < zoneLeftPercent ? 'left' : 'right';
          messUpCountRef.current += 1;
          if (messUpCountRef.current <= SPILL_IMAGE_COUNT) {
            const sameSideBefore = spillsRef.current.filter((s) => s.side === side).length;
            const base = side === 'right' ? RIGHT_SPILL_BASE : LEFT_SPILL_BASE;
            const leftFrac =
              side === 'right'
                ? base.leftFrac + sameSideBefore * SPILL_SLOT_STEP.leftFrac
                : base.leftFrac - sameSideBefore * SPILL_SLOT_STEP.leftFrac;
            const topFrac = base.topFrac + sameSideBefore * SPILL_SLOT_STEP.topFrac;
            const currentBowlPos = bowlPosRef.current;
            const currentBowlItem = bowlItemRef.current;
            const entry = {
              side,
              left: currentBowlPos.left + leftFrac * currentBowlItem.width,
              top: currentBowlPos.top + topFrac * currentBowlItem.height,
            };
            spillsRef.current = [...spillsRef.current, entry];
            setSpills(spillsRef.current);
          } else {
            setSpillGrowth((g) => g + 1);
          }
        }
      }

      if (elapsedMs < WHISK_MIX_DURATION_MS) {
        rafId = requestAnimationFrame(tick);
      } else {
        // Glides back to its original counter spot the same way the kettle
        // does once it's done pouring (see MOVABLE_START.kettle above) --
        // .station-item.movable's own left/top transition is what animates
        // this into a smooth glide rather than an instant jump. whiskStage
        // stays 'done' (not reset to 'idle') so it stays non-draggable/
        // non-focusable there -- a used-up tool, same as the big spoon,
        // just now visually put away instead of left sitting in the bowl.
        setItemPositions((prev) => ({ ...prev, whisk: MOVABLE_START.whisk }));
        setWhiskStage('done');
        // Same as the kettle above -- once whisking's done, the halo goes
        // back to the bowl (not the now-put-away whisk), since that's
        // where the next action (carrying it to the Make Drink zone)
        // happens.
        bowlRef.current?.focus();
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      whiskAudio.pause();
    };
  }, [whiskStage]);

  // ---- Falling-powder pour effect: anchored to the mound's actual position
  // within the spoon art (MOUND_CENTER_FRAC above), not the spoon's box
  // center -- the art is drawn on a diagonal with the handle trailing off
  // to the upper right, so the mound itself sits well left of the box's
  // horizontal middle. Using the box center here used to send the pour
  // effect noticeably right of the actual mound once the spoon itself got
  // shifted right (SPOON_HOVER_RIGHT_SHIFT) to look correctly placed over
  // the bowl. Falls all the way down to bowlPowderTop (where the growing
  // matcha mound actually is), not just the bowl's own bounding-box top
  // edge -- stopping at the bare top edge cut the fall short of the bowl's
  // rim/interior and made it read as vanishing behind the bowl instead of
  // landing in it. Only actually rendered while bigSpoonStage === 'pouring'
  // (see the JSX below), computed unconditionally here since it's cheap and
  // keeps that render check simple.
  const pourLeft = bigSpoonPos.left + MOUND_CENTER_FRAC.leftFrac * BIG_SPOON_SIZE.width;
  const pourTop = bigSpoonPos.top + MOUND_CENTER_FRAC.topFrac * BIG_SPOON_SIZE.height;
  const pourHeight = Math.max(bowlPowderTop - pourTop, 1);

  return (
    <div className="matcha-making-container" ref={containerRef}>
      <h1 className="sr-only">Matcha Base Station</h1>

      <div className="matcha-making-content">
        <img
          src="./MatchaBaseStation.jpg"
          alt="Matcha base station counter"
          className="matcha-making-art"
        />
        <img
          src="./Heater.png"
          alt="Heater plate"
          className="station-item"
          style={{
            left: `${HEATER_BOX.left}%`,
            top: `${HEATER_BOX.top}%`,
            width: `${HEATER_BOX.width}%`,
            height: `${HEATER_BOX.height}%`,
          }}
        />
        <button
          ref={heaterButtonRef}
          type="button"
          className={`heater-button${heaterOn ? ' on' : ''}${
            tempZone === 'target' ? ' zone-green' : tempZone === 'over' ? ' zone-red' : ''
          }${showHeaterHint ? ' heater-button-highlight' : ''}${
            // Stays exempt through BOTH the pre-heater-on beat and the
            // temp-gauge beat right after it -- the button itself is still
            // valid to look at throughout, only the gauge gets added
            // alongside it once heaterOn flips true.
            showHeaterSpotlight || showTempBarSpotlight ? ' matcha-spotlight-exempt' : ''
          }`}
          data-focusable
          aria-pressed={heaterOn}
          aria-label={heaterOn ? 'Turn heater off' : 'Turn heater on'}
          onClick={() => {
            playButtonClick();
            setHeaterOn((prev) => !prev);
          }}
          style={{
            left: `${HEATER_BUTTON_BOX.left}%`,
            top: `${HEATER_BUTTON_BOX.top}%`,
            width: `${HEATER_BUTTON_BOX.width}%`,
            height: `${HEATER_BUTTON_BOX.height}%`,
          }}
        />
        {/* Suppressed for the first order specifically -- the new callout
            below takes over this job while showHeaterSpotlight is up.
            Orders 2/3 never set it, so they keep this exactly as before. */}
        {showHeaterHint && !showHeaterSpotlight && (
          <p
            className="heater-button-hint"
            style={{ left: `${HEATER_HINT_LEFT}%`, top: `${HEATER_HINT_TOP}%` }}
          >
            use enter to heat up water.
          </p>
        )}
        {/* Fourth and final walkthrough callout on this screen -- arrow
            FIRST this time, pointing left at the heater button, with the
            label following to its right (opposite order from
            .matcha-order-callout/.matcha-scoop-callout above, whose targets
            both sit to their own right instead). Gone the instant
            showHeaterSpotlight ends (heater switched on). */}
        {showHeaterSpotlight && (
          <div className="matcha-heater-callout">
            <svg
              className="matcha-heater-callout-arrow"
              viewBox="0 0 40 24"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="2,12 38,2 38,22" />
            </svg>
            <p className="matcha-heater-callout-text">heat up the water</p>
          </div>
        )}
        {heaterOn && tempBarVisible && (
          <>
            {/* Ninth highlight beat: picks up the instant the temp gauge
                itself appears (barRunning flips true the same render the
                heater's switched on -- see the reset effect above) and
                retires the instant the player actually stops it (stopBar
                sets barRunning false right away -- see stopBar above),
                same "flash until acted on" shape as the scoop bar's own
                beat. */}
            <div
              ref={barRef}
              className={`heater-temp-bar${fillActive ? ' on' : ''}${
                barRunning ? ' heater-temp-bar-highlight' : ''
              }${showTempBarSpotlight ? ' matcha-spotlight-exempt' : ''}`}
              data-focusable
              tabIndex={0}
              role="button"
              aria-label="Temperature gauge. Press Enter to lock in the current temperature."
              onKeyDown={handleBarKeyDown}
              onClick={stopBar}
              style={{
                left: `${TEMP_BAR_BOX.left}%`,
                top: `${TEMP_BAR_BOX.top}%`,
                width: `${TEMP_BAR_BOX.width}%`,
                height: `${TEMP_BAR_BOX.height}%`,
              }}
            >
              <div
                ref={fillRef}
                className="heater-temp-bar-fill"
                style={{ transitionDuration: `${FILL_DURATION_MS}ms` }}
              />
              {TEMP_BAR_TICKS.map((tick) => (
                <span
                  key={tick.key}
                  className="heater-temp-bar-tick"
                  style={{ left: `${tick.left}%`, width: `${tick.width}%` }}
                />
              ))}
              {/* Exact-temperature marker -- see TEMP_BAR_EXACT_LINE's own
                  comment above. */}
              <span className="heater-temp-bar-exact-line" style={{ left: `${TEMP_BAR_EXACT_LINE}%` }} />
            </div>
            {/* Suppressed for the first order specifically -- the new
                callout below takes over this job while barRunning AND
                showTempBarSpotlight are both up. Orders 2/3 never set the
                latter, so they keep this exactly as before. */}
            {barRunning && !showTempBarSpotlight && (
              <p
                className="heater-temp-bar-hint"
                style={{ left: `${TEMP_BAR_BOX.left}%`, top: `${TEMP_BAR_BOX.top + TEMP_BAR_BOX.height + 2}%` }}
              >
                use your backspace key to get the right temperature.
              </p>
            )}
            {/* Fifth walkthrough callout -- arrow above, pointing up at the
                gauge, text below (same shape as .ordering-button-callout in
                CustomerOrdering.css, whose target also sits above it).
                Tied to barRunning specifically (not the whole
                showTempBarSpotlight span) so it disappears the instant the
                player actually stops the gauge, per request, even though
                the spotlight/exemption itself stays up a little longer
                through the post-catch linger (see showTempBarSpotlight's
                own comment). */}
            {showTempBarSpotlight && barRunning && (
              <div
                className="matcha-temp-callout"
                style={{ left: `${TEMP_BAR_BOX.left}%`, top: `${TEMP_BAR_BOX.top + TEMP_BAR_BOX.height + 2}%` }}
              >
                <svg
                  className="matcha-temp-callout-arrow"
                  viewBox="0 0 24 40"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polygon points="12,2 22,36 2,36" />
                </svg>
                <p className="matcha-temp-callout-text">press enter to stop it at the right temperature</p>
              </div>
            )}
          </>
        )}
        {tinItems.map((item) => (
          <img
            key={item.key}
            src={item.src}
            alt={`${item.alt}. Select it and press Enter to measure a scoop.`}
            className={`station-item selectable${showTinHint ? ' tin-highlight' : ''}${
              showTinSpotlight ? ' matcha-spotlight-exempt' : ''
            }`}
            data-focusable
            tabIndex={0}
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              width: `${item.width}%`,
              height: `${item.height}%`,
            }}
            onKeyDown={handleTinKeyDown(item)}
            onFocus={() => setFocusedTin(item.key)}
            onBlur={() => setFocusedTin((prev) => (prev === item.key ? null : prev))}
          />
        ))}
        {/* Name label under whichever tin currently has the white focus
            halo (see focusedTin above) -- e.g. "Cafe", "Classic",
            "Ceremonial". Centered under that tin specifically (left +
            half its own width), just below its bottom edge. */}
        {tinItems.filter((item) => item.key === focusedTin).map((item) => (
          <p
            key={item.key}
            className="matcha-tin-label"
            aria-hidden="true"
            style={{
              left: `${item.left + item.width / 2}%`,
              top: `${item.top + item.height + TIN_LABEL_GAP}%`,
            }}
          >
            {TIN_LABELS[item.key]}
          </p>
        ))}
        {/* Suppressed for the first order specifically -- showTinSpotlight
            below puts its own pink-backed, arrow-pointing callout above the
            tins instead, and showing both at once would just be the same
            "pick a grade" message said twice. Orders 2/3 never set
            showTinSpotlight (customerNumber !== 1), so they keep getting
            this plain text hint exactly as before. */}
        {showTinHint && !showTinSpotlight && (
          <p
            className="matcha-tin-hint"
            style={{ left: `${TIN_HINT_LEFT}%`, top: `${TIN_HINT_TOP}%` }}
          >
            use your arrow keys and enter to pick the matcha grade your customer requested.
          </p>
        )}
        {/* First-order-only walkthrough callout -- arrow + short label
            above the tins, arrow pointing down at them (same "text above,
            arrow below, pointing down at the thing below it" shape as
            .ordering-progress-callout in CustomerOrdering.css). Gone the
            instant showTinSpotlight ends (a grade's actually been picked).
            Reuses TIN_HINT_LEFT/TOP's own general neighborhood -- above the
            tins, roughly centered on the cluster -- rather than a
            freestanding new position. */}
        {showTinSpotlight && (
          <div className="matcha-tin-callout" style={{ left: `${TIN_HINT_LEFT}%`, top: `${TIN_HINT_TOP}%` }}>
            <p className="matcha-tin-callout-text">use the arrows and pick the correct grade</p>
            <svg
              className="matcha-tin-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {selectedTin && (
          <>
            {/* The whole measuring assembly (bar + fill/markers/slider,
                small reference spoons, "x N" labels) stays up while the
                player's still choosing/reading their catch -- including
                for the beat right after Enter/Space, while scoopFillPercent
                is still animating up to the caught line, and for a couple
                of seconds after that (see stopScoop/SCOOP_FILL_DURATION_MS/
                SCOOP_CONFIRM_LINGER_MS above). Only once both of those have
                passed -- scoopConfirmed is deliberately delayed, not
                flipped the instant Enter's pressed, see stopScoop -- does
                all of it disappear together and the big carryable spoon
                (below) take over. */}
            {!scoopConfirmed && (
              <>
                {/* Sixth highlight beat: picks up the instant the measuring
                    game itself opens (scoopRunning flips true the moment
                    selectedTin is set -- see the effect above), same
                    flashing-halo + hint-label pattern as every earlier beat.
                    Retires the instant the player actually stops the slider
                    (stopScoop sets scoopRunning false right away, well
                    before scoopConfirmed's own delayed flip -- see stopScoop
                    above) -- there's no need to keep flashing once they've
                    already acted. */}
                <div
                  ref={scoopBarRef}
                  className={`scoop-bar${scoopRunning ? ' scoop-bar-highlight' : ''}${
                    showScoopSpotlight ? ' matcha-spotlight-exempt' : ''
                  }`}
                  data-focusable
                  tabIndex={0}
                  role="button"
                  aria-label="Scoop gauge. Press Enter to stop the slider at the current line."
                  onKeyDown={handleScoopKeyDown}
                  onClick={stopScoop}
                  style={{
                    left: `${SCOOP_BAR_BOX.left}%`,
                    top: `${SCOOP_BAR_BOX.top}%`,
                    width: `${SCOOP_BAR_BOX.width}%`,
                    height: `${SCOOP_BAR_BOX.height}%`,
                  }}
                >
                  {/* Fill + marker ticks sit in their own clipped wrapper so
                      the fill's square top corners get cropped to the
                      bar's own rounded shape as it grows (same reason
                      .heater-temp-bar sets overflow: hidden directly on
                      itself) -- but the slider stays a *direct* child of
                      .scoop-bar, outside this wrapper, since it's
                      deliberately positioned to poke out past the bar's
                      left edge (translateX(-100%) -- see
                      .scoop-bar-slider) and would get clipped off if it
                      were inside here too. */}
                  <div className="scoop-bar-clip">
                    <div
                      className="scoop-bar-fill"
                      aria-hidden="true"
                      style={{
                        height: `${scoopFillPercent}%`,
                        background: SCOOP_FILL_COLORS[selectedTin] ?? SCOOP_FILL_COLORS['classic-grade'],
                        transitionDuration: `${SCOOP_FILL_DURATION_MS}ms`,
                      }}
                    />
                    {SCOOP_BAR_MARKERS.map((markerTop) => (
                      <span key={markerTop} className="scoop-bar-marker" style={{ top: `${markerTop}%` }} />
                    ))}
                  </div>
                  <div ref={scoopSliderRef} className="scoop-bar-slider" aria-hidden="true" />
                </div>
                {/* Suppressed for the first order specifically -- the new
                    green callout below takes over this job while
                    showScoopSpotlight is up. Orders 2/3 never set it, so
                    they keep this exactly as before. */}
                {scoopRunning && !showScoopSpotlight && (
                  <p className="scoop-bar-hint">
                    use your backspace key to choose the right measurement, be as accurate as possible!
                  </p>
                )}
                {/* First-order-only walkthrough callout -- label + arrow
                    sitting to the LEFT of the scoop gauge, arrow pointing
                    right at it, same row-layout shape as .matcha-order-
                    callout above (that one also sits beside its target with
                    a sideways arrow). Green, not pink -- the one phase in
                    this walkthrough that isn't -- per request. Gone the
                    instant showScoopSpotlight ends (a reading's been
                    confirmed). */}
                {showScoopSpotlight && (
                  <div className="matcha-scoop-callout">
                    <p className="matcha-scoop-callout-text">
                      press enter to stop the lever at the right amount
                    </p>
                    <svg
                      className="matcha-scoop-callout-arrow"
                      viewBox="0 0 40 24"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polygon points="38,12 2,2 2,22" />
                    </svg>
                  </div>
                )}
                {SCOOP_SPOON_ITEMS.map((item) => (
                  <img
                    key={item.key}
                    src="./Spoon.png"
                    alt=""
                    aria-hidden="true"
                    className="station-item"
                    style={{
                      left: `${item.left}%`,
                      top: `${item.top}%`,
                      width: `${item.width}%`,
                      height: `${item.height}%`,
                    }}
                  />
                ))}
                {SCOOP_SPOON_LABELS.map((label) => (
                  <span
                    key={label.key}
                    className="scoop-spoon-label"
                    aria-hidden="true"
                    style={{
                      left: `${label.left}%`,
                      top: `${label.top}%`,
                      width: `${label.width}%`,
                    }}
                  >
                    {label.text}
                  </span>
                ))}
              </>
            )}
            {scoopConfirmed && bigSpoonStage !== 'done' && (
              <img
                ref={bigSpoonRef}
                src={SCOOP_SPOON_IMAGES[selectedTin] ?? SCOOP_SPOON_IMAGES['classic-grade']}
                alt="Measured scoop of matcha. Drag it onto the bowl to tip the powder in, or select it and press Enter."
                className={`big-spoon${bigSpoonDrag ? ' dragging' : ''}${
                  bigSpoonStage !== 'idle' ? ' settling' : ''
                }${showSpoonHint ? ' big-spoon-highlight' : ''}${
                  showSpoonSpotlight ? ' matcha-spotlight-exempt' : ''
                }`}
                data-focusable
                tabIndex={0}
                draggable={false}
                style={{
                  left: `${bigSpoonRenderPos.left}%`,
                  top: `${bigSpoonRenderPos.top}%`,
                  width: `${BIG_SPOON_SIZE.width}%`,
                  height: `${BIG_SPOON_SIZE.height}%`,
                }}
                onPointerDown={handleBigSpoonPointerDown}
                onPointerMove={handleBigSpoonPointerMove}
                onPointerUp={handleBigSpoonPointerUp}
                onKeyDown={handleBigSpoonKeyDown}
              />
            )}
            {/* Suppressed for the first order specifically -- the new pink
                callout below takes over this job while showSpoonSpotlight
                is up. Orders 2/3 never set it, so they keep this exactly as
                before. */}
            {showSpoonHint && !showSpoonSpotlight && (
              <p
                className="big-spoon-hint"
                style={{ left: `${SPOON_HINT_LEFT}%`, top: `${SPOON_HINT_TOP}%` }}
              >
                use enter to pour the matcha powder on your bowl.
              </p>
            )}
            {/* First-order-only walkthrough callout -- text above, arrow
                below pointing down at the spoon/bowl, same shape as
                .matcha-tin-callout above. Sits at the same general spot the
                old big-spoon-hint used (SPOON_HINT_LEFT/TOP), just styled
                like the rest of this walkthrough instead. Gone the instant
                showSpoonSpotlight ends (the pour's actually finished,
                bigSpoonStage reaches 'done'). */}
            {showSpoonSpotlight && (
              <div
                className="matcha-spoon-callout"
                // Shifted further left than SPOON_HINT_LEFT itself (the old
                // hint's own anchor, still used as-is for orders 2/3) per
                // feedback that this callout needed to sit more to the left
                // once the spoon's actually shown.
                style={{ left: `${SPOON_HINT_LEFT - 10}%`, top: `${SPOON_HINT_TOP}%` }}
              >
                <p className="matcha-spoon-callout-text">pour the scoop</p>
                <svg
                  className="matcha-spoon-callout-arrow"
                  viewBox="0 0 24 40"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polygon points="12,38 22,4 2,4" />
                </svg>
              </div>
            )}
          </>
        )}
        {MOVABLE_ITEMS.map((item) => {
          const dragging = drag?.key === item.key;
          const pos = dragging ? drag : itemPositions[item.key];
          // The kettle has a pour sequence and the whisk has a mixing
          // sequence -- the bowl stays exactly as free-floating as ever
          // (both stages are always 'idle' for it, so these are no-ops in
          // practice, but written generically rather than special-cased
          // per item for the parts that don't actually need
          // special-casing).
          const isKettle = item.key === 'kettle';
          const isWhisk = item.key === 'whisk';
          const isBowl = item.key === 'bowl';
          // Once the bowl's fully faded away (bowlStage 'sent' -- see
          // beginBowlCarry above), only the bowl itself stops rendering --
          // the whisk stays behind on the counter rather than being carried
          // off with it (it was only ever resting in the bowl visually
          // while whisking; its own itemPositions entry never actually
          // tracks the bowl's position, so there's nothing to "carry" for
          // it in the first place).
          if (isBowl && bowlStage === 'sent') return null;
          const settling =
            (isKettle && kettleStage !== 'idle') ||
            (isWhisk && whiskStage !== 'idle') ||
            (isBowl && bowlStage !== 'idle');
          // The bowl shrinks/fades away on its own once it's arrived at the
          // Make Drink zone (bowlStage 'vanishing') -- not yet during
          // 'carrying', which should still read as a plain glide, same
          // "settle first, then react" shape as .pouring/.mixing below
          // only applying once their own glide-in is over. The whisk isn't
          // included here -- see the comment above.
          const leaving = isBowl && bowlStage === 'vanishing';
          const pouring = isKettle && (kettleStage === 'moving' || kettleStage === 'pouring');
          // Stirring wobble (see .mixing/@keyframes whiskStir in
          // MatchaMaking.css) only plays once the whisk's actually settled
          // into the bowl -- not during the 'moving' glide-in, which should
          // read as a plain, un-wobbled approach same as the spoon/kettle's
          // own glides.
          const mixing = isWhisk && whiskStage === 'mixing';
          // Turns the whisk upside down (bristles pointing down into the
          // bowl instead of up, as it sits decoratively on the counter) the
          // instant it's picked up, and keeps it that way through settling
          // and resting -- same 'moving'/'mixing'/'done' span as `settling`
          // above. Applied inline (see the style spread below) *only* while
          // `mixing` is false -- WHISK_FLIP_DEG is baked directly into
          // @keyframes whiskStir instead for the 'mixing' stage itself,
          // since an inline style.transform and a running CSS animation on
          // the same `transform` property would conflict, and the
          // animation always wins outright while it's playing, silently
          // dropping the inline flip the moment mixing starts.
          const whiskFlipped = isWhisk && whiskStage !== 'idle';
          return (
            <img
              key={item.key}
              ref={isKettle ? kettleRef : isWhisk ? whiskRef : isBowl ? bowlRef : undefined}
              src={item.src}
              alt={
                isWhisk
                  ? `${item.alt}. Drag onto the bowl to mix once the matcha and water are both in, or select it and press Enter.`
                  : isBowl && whiskStage === 'done'
                  ? `${item.alt}. Drag to the Make Drink zone to send it off, or select it and press Enter.`
                  : `${item.alt}. Drag to move.`
              }
              className={`station-item movable${dragging ? ' dragging' : ''}${settling ? ' settling' : ''}${
                pouring ? ' pouring' : ''
                // kettle-highlight/whisk-highlight (the flashing green
                // halo, driven by showKettleHint/showWhiskHint) removed per
                // request -- their own pink-callout replacements
                // (.matcha-kettle-callout/.matcha-whisk-callout) do that
                // job for the first order now; orders 2/3 just render
                // these two plain with no highlight at all, same "only
                // needs pointing out once" reasoning the Order/heater
                // buttons already use.
              }${mixing ? ' mixing' : ''}${isBowl && showBowlHint ? ' bowl-highlight' : ''}${
                leaving ? ' bowl-vanishing' : ''
              }${
                (isBowl &&
                  (showSpoonSpotlight ||
                    showKettlePourSpotlight ||
                    showWhiskSpotlight ||
                    showMixSpotlight ||
                    showBowlCarrySpotlight)) ||
                (isKettle && (showKettleSpotlight || showKettlePourSpotlight)) ||
                (isWhisk && (showWhiskSpotlight || showMixSpotlight))
                  ? ' matcha-spotlight-exempt'
                  : ''
              }`}
              data-focusable
              tabIndex={0}
              draggable={false}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${item.width}%`,
                height: `${item.height}%`,
                // Rotation lives here (inline), not in a CSS class, so
                // KETTLE_POUR_ROTATE_DEG stays the single source of truth
                // for the angle. transformOrigin (pinned to the spout
                // opening -- KETTLE_SPOUT_OFFSET.leftFrac/KETTLE_POUR_SPOUT_
                // TOP_FRAC) is set here *unconditionally* for the kettle,
                // not just while pouring -- .station-item.movable's own
                // transition only covers `transform`, not `transform-
                // origin`, so if the origin were only applied while
                // `pouring` was true, the instant pouring ends it would
                // snap back to the default center origin *before* the
                // untilt (rotate(deg) -> none) transition finished easing
                // back to 0 -- pivoting that last bit of the transition
                // around the wrong point, which visibly swung the kettle
                // over the bowl and made the water/matcha circles flash
                // as if they'd disappeared and reappeared. Keeping the
                // origin pinned at all times means only the rotation angle
                // itself ever changes, so the untilt always eases smoothly
                // around the same spout point, matching where the falling-
                // water effect (kettlePourLeft/kettlePourTop) anchors too.
                ...(isKettle
                  ? {
                      transformOrigin: `${KETTLE_SPOUT_OFFSET.leftFrac * 100}% ${
                        KETTLE_POUR_SPOUT_TOP_FRAC * 100
                      }%`,
                    }
                  : {}),
                // Set unconditionally whenever this is the whisk (not just
                // while flipped/mixing) -- see WHISK_STIR_ORIGIN_FRAC above
                // for why the pivot needs to stay fixed across every stage
                // rather than only applying alongside the rotation itself.
                ...(isWhisk
                  ? {
                      transformOrigin: `${WHISK_STIR_ORIGIN_FRAC.leftFrac * 100}% ${
                        WHISK_STIR_ORIGIN_FRAC.topFrac * 100
                      }%`,
                    }
                  : {}),
                ...(pouring ? { transform: `rotate(${KETTLE_POUR_ROTATE_DEG}deg)` } : {}),
                ...(whiskFlipped && !mixing ? { transform: `rotate(${WHISK_FLIP_DEG}deg)` } : {}),
                // bowl-powder/bowl-water render later in the JSX than this
                // map, so without an explicit z-index the whisk (painted
                // here, earlier) would sit underneath both once dropped into
                // the bowl. z-index: 2 lifts it above them regardless of DOM
                // order; bowl-mix-swirl's own z-index (3, see
                // MatchaMaking.css) stays above this so the swirl effect is
                // still visible over the whisk while mixing, per request.
                // Bumped to 26 during showWhiskSpotlight specifically --
                // this is an INLINE style, which always beats the
                // .matcha-spotlight-exempt CSS class (className is also
                // applied below, but inline styles win over any stylesheet
                // rule regardless of specificity), so the plain class alone
                // was silently not exempting the whisk at all during that
                // phase -- it stayed at 2, well under the overlay's 25, and
                // read as covered even though the className said otherwise.
                // 27, not the shared exempt class's 26 -- bowl-powder/
                // bowl-water also become exempt (26) during these same two
                // phases, and since the whisk is earlier in DOM than both
                // (rendered here, in the MOVABLE_ITEMS map, well before
                // bowl-powder/bowl-water further down in the JSX), an equal
                // z-index would let DOM order win and sink the whisk BELOW
                // them -- exactly the "whisk hidden between the layers of
                // mixing" bug this fixes. One point higher preserves the
                // same bowl-water(26) < whisk(27) < bowl-mix-swirl(28) <
                // bowl-spill-puddle(29) stack this element normally keeps
                // via its own resting z-index: 2 below.
                ...(isWhisk ? { zIndex: showWhiskSpotlight || showMixSpotlight ? 27 : 2 } : {}),
              }}
              onPointerDown={handlePointerDown(item)}
              onPointerMove={handlePointerMove(item)}
              onPointerUp={handlePointerUp(item)}
              onKeyDown={
                isKettle ? handleKettleKeyDown : isWhisk ? handleWhiskKeyDown : isBowl ? handleBowlKeyDown : undefined
              }
            />
          );
        })}
        {/* Suppressed for the first order specifically -- the new callout
            below takes over this job while showKettleSpotlight is up.
            Orders 2/3 never set it, so they keep this exactly as before. */}
        {showKettleHint && !showKettleSpotlight && (
          <p
            className="kettle-hint"
            style={{ left: `${KETTLE_HINT_LEFT}%`, top: `${KETTLE_HINT_TOP}%` }}
          >
            use enter to pour water in the bowl.
          </p>
        )}
        {/* First-order-only walkthrough callout -- text above, arrow below
            pointing down at the kettle, same shape as .matcha-tin-callout.
            Gone the instant showKettleSpotlight ends (the water's actually
            landed -- see showKettlePourSpotlight above, which takes over
            from here). */}
        {showKettleSpotlight && (
          <div className="matcha-kettle-callout" style={{ left: `${KETTLE_HINT_LEFT}%`, top: `${KETTLE_HINT_TOP}%` }}>
            <p className="matcha-kettle-callout-text">pour the water</p>
            <svg
              className="matcha-kettle-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {/* Suppressed for the first order specifically -- the new callout
            below takes over this job while showWhiskSpotlight is up.
            Orders 2/3 never set it, so they keep this exactly as before. */}
        {showWhiskHint && !showWhiskSpotlight && (
          <p
            className="whisk-hint"
            style={{ left: `${WHISK_HINT_LEFT}%`, top: `${WHISK_HINT_TOP}%` }}
          >
            use enter to start whisking.
          </p>
        )}
        {/* First-order-only, final walkthrough callout -- text above, arrow
            below pointing down at the whisk, same shape as
            .matcha-tin-callout. No further beat after this one -- it just
            clears once whisking actually starts. */}
        {showWhiskSpotlight && (
          <div
            className="matcha-whisk-callout"
            // Shifted further left than WHISK_HINT_LEFT itself (the old
            // hint's own anchor, still used as-is for orders 2/3) per
            // feedback that this callout needed to sit more to the left.
            style={{ left: `${WHISK_HINT_LEFT - 10}%`, top: `${WHISK_HINT_TOP}%` }}
          >
            <p className="matcha-whisk-callout-text">use the chasen to froth your matcha</p>
            <svg
              className="matcha-whisk-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {/* Suppressed for the first order specifically -- the new callout
            below takes over this job while showBowlCarrySpotlight is up.
            Orders 2/3 never set it, so they keep this exactly as before. */}
        {showBowlHint && !showBowlCarrySpotlight && (
          <p
            className="bowl-hint"
            style={{ left: `${bowlPos.left + bowlItem.width / 2}%`, top: `${bowlPos.top - 6}%` }}
          >
            use enter to carry your matcha bowl to the next station.
          </p>
        )}
        {/* Ninth walkthrough callout -- text above, arrow below pointing
            down at the bowl, same shape as .matcha-tin-callout. Sits at the
            same general spot the old plain-text .bowl-hint used. Gone the
            instant showBowlCarrySpotlight ends (the bowl's actually on its
            way -- see showStationAdvanceSpotlight above, which takes over
            from here once it lands). */}
        {showBowlCarrySpotlight && (
          <div
            className="matcha-bowl-callout"
            style={{ left: `${bowlPos.left + bowlItem.width / 2}%`, top: `${bowlPos.top - 6}%` }}
          >
            <p className="matcha-bowl-callout-text">select the bowl to carry it over to the next station</p>
            <svg
              className="matcha-bowl-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {/* Falling-powder pour effect -- see pourLeft/pourTop/pourHeight
            above -- only while the spoon's actually holding at its
            hover-above-the-bowl spot (the 'moving' stage is still just the
            glide there). Rendered here (after MOVABLE_ITEMS, i.e. after the
            bowl) rather than back up alongside the spoon itself, so it's
            unambiguously later in paint order than the bowl and can't end
            up rendered underneath it. Four grains on staggered delays/
            offsets so it reads as a fuller stream rather than one dot.
            .spoon-pour's own z-index (20) sits below the walkthrough
            overlay's (25), so without the exempt class here this whole
            effect would render invisibly UNDER the pink tint during
            showSpoonSpotlight -- same bug bowl-powder had before it got its
            own exempt class. */}
        {bigSpoonStage === 'pouring' && (
          <div
            className={`spoon-pour${showSpoonSpotlight ? ' matcha-spotlight-exempt' : ''}`}
            aria-hidden="true"
            style={{
              left: `${pourLeft}%`,
              top: `${pourTop}%`,
              height: `${pourHeight}%`,
            }}
          >
            <span className="spoon-pour-grain spoon-pour-grain-1" style={{ background: scoopColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-2" style={{ background: scoopColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-3" style={{ background: scoopColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-4" style={{ background: scoopColor }} />
          </div>
        )}
        {/* Falling-water pour effect -- reuses the exact same .spoon-pour/
            .spoon-pour-grain-N visual machinery as the matcha spoon's
            falling powder above (it's purely generic -- positioned via
            inline left/top/height, colored via inline background), just
            anchored to the kettle's spout (kettlePourLeft/kettlePourTop)
            and colored WATER_COLOR instead. Same "only while actually
            holding at the hover spot, rendered after MOVABLE_ITEMS so it
            can't paint underneath the bowl" reasoning as that one -- and
            same exempt-class-needed-or-it's-invisible-under-the-tint
            reasoning too, this time for showKettlePourSpotlight. */}
        {kettleStage === 'pouring' && (
          <div
            className={`spoon-pour${showKettlePourSpotlight ? ' matcha-spotlight-exempt' : ''}`}
            aria-hidden="true"
            style={{
              left: `${kettlePourLeft}%`,
              top: `${kettlePourTop}%`,
              height: `${kettlePourHeight}%`,
            }}
          >
            <span className="spoon-pour-grain spoon-pour-grain-1" style={{ background: WATER_COLOR }} />
            <span className="spoon-pour-grain spoon-pour-grain-2" style={{ background: WATER_COLOR }} />
            <span className="spoon-pour-grain spoon-pour-grain-3" style={{ background: WATER_COLOR }} />
            <span className="spoon-pour-grain spoon-pour-grain-4" style={{ background: WATER_COLOR }} />
          </div>
        )}
        {showSteam && (
          <div
            className="kettle-steam"
            aria-hidden="true"
            style={{ left: `${steamLeft}%`, top: `${steamTop}%` }}
          >
            <span className="kettle-steam-wisp kettle-steam-wisp-1" />
            <span className="kettle-steam-wisp kettle-steam-wisp-2" />
            <span className="kettle-steam-wisp kettle-steam-wisp-3" />
          </div>
        )}
        {/* This used to also unmount once whiskStage reached 'done' (the
            idea being .bowl-whisked-liquid, further down, replaces it
            entirely), matching bowl-water's own whiskStage !== 'done' gate
            right below. In practice that unmount wasn't reliably happening
            for this mound specifically (confirmed still visible after
            whisking) -- rather than keep chasing why, per feedback this now
            just stays mounted (no whiskStage condition at all) for as long
            as the bowl itself is still around to carry it -- see the
            bowlStage !== 'sent' check below. Since left/top are already
            recomputed from the bowl's own *current* bowlPos on every render
            (same as bowlWater/bowl-whisked-liquid), it simply rides along
            with the bowl for as long as it's visible, including through the
            Make Drink carry -- it doesn't need its own tracking logic.

            bowlStage !== 'sent' -- added after a follow-up report that the
            mound was still sitting in the Make Drink corner on its own even
            after the bowl (and .bowl-whisked-liquid, which already has this
            same check) had fully faded away and stopped rendering -- with
            nothing left to be "attached to" at that point, a lone mound
            floating there read as its own orphaned leftover, not a bowl
            still having matcha in it. Matches .bowl-whisked-liquid's own
            gate exactly so the two always disappear together.

            z-index: auto (unset) keeps it *behind* .bowl-whisked-liquid
            (z-index: 1), same stacking as before, so the finished-drink
            image still paints on top of it while both are visible.

            No key here (there used to be one, key={pourCount}, to force a
            fresh mount so the grow-in animation replayed on every pour) --
            confirmed via a live DOM count while troubleshooting that
            repeating the tin -> scoop -> dump flow more than once in a
            single visit to this station left the OLD key={pourCount}
            instances still mounted instead of being cleaned up, silently
            piling up extra copies of this mound on the counter (only
            visible here, not for bowl-water below, since water's own
            whiskStage !== 'done' gate happened to hide all of its own
            accumulated copies at once regardless of count). This is now a
            single stable element -- it can only ever exist once, by
            construction, at the cost of not replaying the grow-in animation
            if the player redoes the dump within that same visit. This only
            matters within one customer's own visit to this station, though
            -- each new customer gets a fully fresh mount of this whole
            component (see App.js's currentPage-based conditional rendering,
            which unmounts/remounts the station between customers), so a
            multi-order session (5-7 customers) never carries any of this
            state, keyed or not, from one customer's drink into the next. */}
        {bowlPowder && bowlStage !== 'sent' && (
          <div
            className={`bowl-powder${
              showSpoonSpotlight ||
              showKettlePourSpotlight ||
              showWhiskSpotlight ||
              showMixSpotlight ||
              showBowlCarrySpotlight
                ? ' matcha-spotlight-exempt'
                : ''
            }`}
            aria-hidden="true"
            style={{
              left: `${bowlPowderLeft}%`,
              top: `${bowlPowderTop}%`,
              width: `${bowlPowderWidth}%`,
              height: `${bowlPowderHeight}%`,
              background: bowlPowder.color,
              animationDuration: `${BIG_SPOON_POUR_MS}ms`,
            }}
          />
        )}
        {/* Rendered *after* bowl-powder above (i.e. on top of it in paint
            order), using the more-transparent BOWL_WATER_FILL_COLOR rather
            than WATER_COLOR, so the matcha mound shows through underneath --
            reads as water sitting over the powder rather than a solid pool
            covering or hiding it. Same grow-from-nothing mechanic as
            bowl-powder used to share (see that div's own comment above for
            why this is no longer keyed either). whiskStage !== 'done' hides
            this once whisking finishes, same as bowl-powder used to. */}
        {bowlWater && whiskStage !== 'done' && (
          <div
            className={`bowl-water${
              showKettlePourSpotlight || showWhiskSpotlight || showMixSpotlight
                ? ' matcha-spotlight-exempt'
                : ''
            }`}
            aria-hidden="true"
            style={{
              left: `${bowlWaterLeft}%`,
              top: `${bowlWaterTop}%`,
              width: `${bowlWaterWidth}%`,
              height: `${bowlWaterHeight}%`,
              background: BOWL_WATER_FILL_COLOR,
              animationDuration: `${KETTLE_POUR_MS}ms`,
            }}
          />
        )}
        {/* Stirring effect -- a translucent swirl pattern rotating over the
            mixture, only up while whiskStage === 'mixing'. Rendered after
            bowl-water (i.e. on top of it in paint order) so it reads as
            motion happening at the surface of the mixture rather than a
            separate layer. Reuses bowlWater's own left/top/width/height so
            it exactly overlays the pool underneath, following the bowl the
            same way bowl-water/bowl-powder do if the bowl was dragged. Pure
            CSS rotation (see @keyframes bowlMixSwirl in MatchaMaking.css) --
            no state/refs needed since it only needs to exist, not respond to
            the actual ball-balancing physics. */}
        {whiskStage === 'mixing' && (
          <div
            className={`bowl-mix-swirl${showMixSpotlight ? ' matcha-spotlight-exempt' : ''}`}
            aria-hidden="true"
            style={{
              left: `${bowlWaterLeft}%`,
              top: `${bowlWaterTop}%`,
              width: `${bowlWaterWidth * BOWL_MIX_SWIRL_SIZE_FRAC}%`,
              height: `${bowlWaterHeight * BOWL_MIX_SWIRL_SIZE_FRAC}%`,
            }}
          />
        )}
        {/* The finished whisked matcha, swapped in once whiskStage reaches
            'done' -- one pre-made image per grade (WHISKED_LIQUID_IMAGES,
            keyed off bowlPowder.grade, which was captured from selectedTin
            back when the powder was first dumped -- see that setBowlPowder
            call above). Rendered on top of the plain-color bowl-powder/
            bowl-water circles (doesn't replace them -- just paints over,
            same "later in the JSX = higher paint order" convention as
            everything else on the bowl). Sized/positioned to the bowl's
            actual inner-rim ellipse (bowlInnerRimLeft/Top/Width/Height, see
            BOWL_INNER_RIM_CENTER above) rather than bowl-water's own box, so
            it fills the real visible interior instead of a smaller,
            more-circular guess -- left/top are still the ellipse's *center*
            point, same centering trick as .bowl-water/.bowl-powder
            (translate(-50%, -50%) -- see .bowl-whisked-liquid in
            MatchaMaking.css). Reuses growFromCenter for a quick fade/
            grow-in so it doesn't just harshly pop in the instant mixing
            ends. */}
        {whiskStage === 'done' && bowlPowder && bowlStage !== 'sent' && (
          <img
            className={`bowl-whisked-liquid${bowlStage === 'vanishing' ? ' bowl-vanishing' : ''}`}
            aria-hidden="true"
            draggable={false}
            src={WHISKED_LIQUID_IMAGES[bowlPowder.grade] ?? WHISKED_LIQUID_IMAGES['classic-grade']}
            alt=""
            style={{
              left: `${bowlInnerRimLeft}%`,
              top: `${bowlInnerRimTop}%`,
              width: `${bowlInnerRimWidth}%`,
              height: `${bowlInnerRimHeight}%`,
            }}
          />
        )}
        {/* Balance minigame -- only up while whiskStage === 'mixing' (see
            that stage's physics effect above). The ball's left position and
            in-zone glow are both written directly to mixBallRef's DOM node
            every animation frame rather than through React props here --
            this element only ever needs to *exist*, not re-render, for the
            whole minigame. aria-hidden throughout since a raw ball-position
            div has nothing meaningful to announce; the whisk's own
            focusable element is what a screen reader user would be
            interacting with instead. */}
        {whiskStage === 'mixing' && (
          <>
            {/* Twelfth highlight beat: flashes for the bar's whole time on
                screen (whiskStage === 'mixing' is exactly when it's mounted
                -- there's no single "confirm" press to retire this one on,
                unlike every earlier beat -- the arrow keys are the ongoing
                gameplay itself for the whole minigame, not a one-shot
                action). Naturally goes away the instant mixing ends and the
                bar unmounts. */}
            <div
              className={`mix-bar mix-bar-highlight${showMixSpotlight ? ' matcha-spotlight-exempt' : ''}`}
              aria-hidden="true"
              style={{
                left: `${mixBarPos.left}%`,
                top: `${mixBarPos.top}%`,
                width: `${MIX_BAR_WIDTH}%`,
                height: `${MIX_BAR_HEIGHT}%`,
              }}
            >
              <span
                className="mix-bar-zone"
                style={{
                  left: `${MIX_ZONE_LEFT_FRAC * 100}%`,
                  width: `${MIX_ZONE_WIDTH_FRAC * 100}%`,
                }}
              />
              <span
                ref={mixBallRef}
                className="mix-ball"
                // Initial left matches exactly where the physics effect
                // itself resets mixPositionRef to (50 - half the ball's own
                // width) -- just so the ball doesn't flash at the left edge
                // for the single frame before that effect's first tick runs
                // and takes over via direct DOM writes from here on.
                style={{
                  left: `${50 - (MIX_BALL_WIDTH_FRAC * 100) / 2}%`,
                  width: `${MIX_BALL_WIDTH_FRAC * 100}%`,
                }}
              />
            </div>
            {/* Suppressed for the first order specifically -- the new
                callout below takes over this job while showMixSpotlight is
                up. Orders 2/3 never set it, so they keep this exactly as
                before. */}
            {!showMixSpotlight && (
              <p
                className="mix-bar-hint"
                style={{ left: `${mixBarPos.left + MIX_BAR_WIDTH / 2}%`, top: `${mixBarPos.top - 11}%` }}
              >
                use your arrow keys to balance the ball inside the green area and whisk without spilling.
              </p>
            )}
            {/* Eighth and final walkthrough callout -- text above, arrow
                below pointing down at the bar, same shape as
                .matcha-tin-callout. Sits at the same general spot the old
                plain-text mix-bar-hint used. No further beat after this one
                -- it just clears once mixing ends (whiskStage moves on to
                'done'). */}
            {showMixSpotlight && (
              <div
                className="matcha-mix-callout"
                // Shifted further up/left than the mixBarPos-derived anchor
                // itself (the old hint's own position, still used as-is for
                // orders 2/3) per feedback.
                style={{ left: `${mixBarPos.left + MIX_BAR_WIDTH / 2 - 8}%`, top: `${mixBarPos.top - 16}%` }}
              >
                <p className="matcha-mix-callout-text">
                  use your left and right arrows to keep the ball in the green area without spilling
                </p>
                <svg
                  className="matcha-mix-callout-arrow"
                  viewBox="0 0 24 40"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polygon points="12,38 22,4 2,4" />
                </svg>
              </div>
            )}
          </>
        )}
        {/* Spill puddles -- one per mess-up during whisking (see
            spills/spillGrowth in the mixing physics effect above), shown in
            the order they happened (stage-1 PNG first, up through stage-4)
            on whichever side of the bowl the ball actually drifted toward,
            colored to match whichever tin was actually scooped
            (bowlPowder.grade -- same classic-grade fallback convention as
            WHISKED_LIQUID_IMAGES right below). Each stays on screen once it
            appears (they don't fade like the old droplet effect) so the
            mess visibly builds up -- and, per feedback, keeps sitting there
            even once the whisking challenge itself is over (whiskStage
            moving on to 'done'), so there's no whiskStage gate here at all:
            spills only ever gets populated during 'mixing' and only ever
            reset at the start of a fresh mixing attempt (see that effect
            above), so rendering whenever it's non-empty is sufficient on
            its own. */}
        {spills.length > 0 &&
          (() => {
            const spillImages =
              SPILL_IMAGES_BY_GRADE[bowlPowder?.grade] ?? SPILL_IMAGES_BY_GRADE['classic-grade'];
            return spills.map((spill, i) => {
              // spill.left/spill.top are already the absolute, frozen
              // container-percentage spot this puddle landed at (computed
              // once, at creation time, in the physics effect's tick()
              // above) -- deliberately NOT recomputed from the bowl's
              // current position here, so dragging or carrying the bowl
              // away later doesn't drag these along with it. They stay on
              // the table.
              const dims = SPILL_DIMS[i];
              return (
                <img
                  key={i}
                  src={spillImages[i]}
                  alt=""
                  aria-hidden="true"
                  className={`bowl-spill-puddle${
                    showMixSpotlight || showBowlCarrySpotlight ? ' matcha-spotlight-exempt' : ''
                  }`}
                  style={{
                    left: `${spill.left}%`,
                    top: `${spill.top}%`,
                    width: `${dims.width}%`,
                    height: `${dims.height}%`,
                    transform: `translate(-50%, -50%) rotate(${SPILL_STAGE_ROTATIONS[i]}deg) scale(${spillGrowthScale})`,
                  }}
                />
              );
            });
          })()}
        {/* "Make Drink" drop-zone -- appears once whisking is done and
            disappears the instant the bowl actually heads there (bowlStage
            leaving 'idle' -- see beginBowlCarry above), same beat as the
            bowl's own highlight/hint retiring, since the bowl's already
            gliding to this exact spot by then and the marker's served its
            purpose. Not itself focusable/clickable -- it's a drop target
            the *bowl* gets dragged onto (handlePointerUp's bowl branch) or
            sent to via the bowl's own Enter press (handleBowlKeyDown), same
            "the label just marks a zone, the movable item is what's
            actually selected" pattern the ice box/cup drop zones use on the
            Milk Selection screen. aria-hidden since the bowl's own alt text
            (see the isBowl branch above) already describes this action to
            screen readers. */}
        {whiskStage === 'done' && bowlStage === 'idle' && (
          <div
            className="make-drink-zone"
            aria-hidden="true"
            style={{
              left: `${MAKE_DRINK_ZONE.left}%`,
              top: `${MAKE_DRINK_ZONE.top}%`,
              width: `${MAKE_DRINK_ZONE.width}%`,
              height: `${MAKE_DRINK_ZONE.height}%`,
            }}
          >
            make drink
          </div>
        )}
        {/* Order receipt button -- the flashing green halo + dashed-border
            hint label it used to carry (highlight/hintText/hintTextOpen,
            still supported by OrderReceiptButton itself) are no longer
            passed here: for the first order, the pink spotlight below plus
            its own arrow + label callout do that job now, in the same
            pink-panel-with-arrow style used throughout Customer Ordering's
            walkthrough; for the 2nd/3rd orders, this button just renders
            plain with no highlight at all, same "only needs pointing out
            once" reasoning Customer Ordering's own play button uses. */}
        <OrderReceiptButton
          order={order}
          spotlightExempt={showStationSpotlight}
          onToggle={(nowOpen) => {
            // Only the *closing* toggle (nowOpen === false) retires
            // showOrderHint/showStationSpotlight -- the opening one fires
            // first and shouldn't, since the player hasn't closed it back
            // up yet.
            if (!nowOpen) setShowOrderHint(false);
            // The *opening* toggle, on the other hand, is exactly what
            // retires showOrderButtonLock -- see that flag's own comment
            // above for why it's a separate, shorter-lived flag from
            // showOrderHint. Only ever needs to flip true once (never reset
            // back), same one-way shape as Customer Ordering's own
            // hasOpenedOrderForm.
            if (nowOpen) setHasOpenedOrderReceipt(true);
          }}
        />
        {/* First-order-only walkthrough callout -- label + arrow sitting to
            the LEFT of the Order button, arrow pointing right at it, same
            "arrow at the edge closest to the target, text beside it" shape
            as .ordering-form-callout in CustomerOrdering.css (that one also
            sits beside its target with a sideways-pointing arrow rather
            than above/below it). Gone the instant showStationSpotlight ends
            (button opened and closed once). */}
        {showStationSpotlight && (
          <div className="matcha-order-callout">
            <p className="matcha-order-callout-text">use the order button to check back at any time</p>
            <svg
              className="matcha-order-callout-arrow"
              viewBox="0 0 40 24"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="38,12 2,2 2,22" />
            </svg>
          </div>
        )}
        <ProgressBar
          activeStep={activeStep}
          customerNumber={customerNumber}
          onNavigate={onNavigate}
          onAdvance={onAdvance}
          // Final highlight beat for this station: once the bowl's fully
          // sent off (bowlStage 'sent' -- see beginBowlCarry above), there's
          // nothing left to do here, so the current-step dot itself picks
          // up the flashing baton, same opt-in highlightCurrentStep/
          // currentStepHint props CustomerOrdering already uses for its own
          // matching beat (see ProgressBar.js/.css).
          highlightCurrentStep={bowlStage === 'sent'}
          // Suppressed for the first order specifically -- the new callout
          // below takes over this job while showStationAdvanceSpotlight is
          // up. Orders 2/3 never set it, so they keep this exactly as
          // before.
          currentStepHint={
            showStationAdvanceSpotlight ? null : 'use your right arrow key to move on to the base adding station.'
          }
          // Exempts the whole bar from the walkthrough spotlight across
          // BOTH of this screen's last two beats (showBowlCarrySpotlight,
          // while the bowl still needs picking up, and
          // showStationAdvanceSpotlight right after) -- OR'd together so
          // the bar reads through continuously across that handoff instead
          // of flickering tinted for a frame in between.
          spotlightExempt={showBowlCarrySpotlight || showStationAdvanceSpotlight}
          // Suppressed while showOrderButtonLock is up so the current-step
          // dot's own autoFocus doesn't grab the walkthrough's very first
          // selection out from under the Order button's own focus effect --
          // same pairing as Customer Ordering's own suppressInitialFocus/
          // showReadPhase-showButtonPhase.
          suppressInitialFocus={showOrderButtonLock}
        />
        {/* Tenth and final walkthrough callout -- text above, arrow below
            pointing down at the bar, same shape as .ordering-progress-
            callout in CustomerOrdering.css (that one also points down at
            the bar from directly above it). Gone once the player actually
            leaves for the milk station (this whole component unmounts
            then). */}
        {showStationAdvanceSpotlight && (
          <div className="matcha-progress-callout">
            <p className="matcha-progress-callout-text">use your right arrow to move to the next station</p>
            <svg
              className="matcha-progress-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {/* First-order-only walkthrough spotlight -- covers every beat on
            this screen (all mutually exclusive -- see each flag's own
            comment above), one shared overlay rather than a separate div
            per beat since only one is ever up at a time. Same plain
            flat-color-div-plus-z-index-exemption approach as Customer
            Ordering's own overlay (see the big comment there for why: no
            SVG mask, no holes, just a div with a higher-z-index element
            punched through it). Pink throughout, same as every other beat
            in this whole walkthrough (an earlier pass tried green for
            showScoopSpotlight specifically, per an since-reversed request).
            Rendered LAST (after ProgressBar, not before) so it actually
            paints over the bar whenever the bar ISN'T the exempt target
            (showTinSpotlight/showScoopSpotlight/etc, everything before the
            last two beats) -- .progress-bar-wrap and this overlay share the
            same z-index (25), and elements at equal z-index stack in DOM
            order, so this needs to come after it in the tree to end up on
            top and tint it by default. showBowlCarrySpotlight/
            showStationAdvanceSpotlight instead bump the bar's OWN z-index
            above this overlay's (see spotlightExempt on <ProgressBar>), the
            same higher-z-index-punch-through approach every other exempt
            element on this screen uses. pointer-events: none so it never
            blocks input while it's up. */}
        {(showStationSpotlight ||
          showTinSpotlight ||
          showScoopSpotlight ||
          showSpoonSpotlight ||
          showHeaterSpotlight ||
          showTempBarSpotlight ||
          showKettleSpotlight ||
          showKettlePourSpotlight ||
          showWhiskSpotlight ||
          showMixSpotlight ||
          showBowlCarrySpotlight ||
          showStationAdvanceSpotlight) && <div className="matcha-spotlight-overlay" aria-hidden="true" />}
      </div>
    </div>
  );
};

export default MatchaMaking;
