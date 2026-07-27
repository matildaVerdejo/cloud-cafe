import React, { useEffect, useRef, useState } from 'react';
import './MatchaMaking.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { getActionFromKeyEvent, shouldDebounceEnter } from '../gameloop/pal';
import ProgressBar from './ProgressBar';
import OrderReceiptButton from './OrderReceiptButton';

// Static (not yet interactive) countertop items, layered on top of the now-
// empty background art. Positions were worked out by compositing each item
// onto the background at a few candidate boxes and eyeballing the result
// (see the process notes -- each box is left/top/width/height as a % of the
// 1394x768 art, matching the milk station's percentage-box convention).
// Each item PNG has already been cropped to its own visible content (no
// leftover transparent padding), so width/height here can use the image's
// own aspect ratio without distortion.
const STATIC_ITEMS = [
  { key: 'cafe-grade', src: './CafeGrade.png', alt: 'Cafe grade matcha tin', left: 63.65, top: 25.66, width: 6.9, height: 19.34 },
  { key: 'classic-grade', src: './ClassicGrade.png', alt: 'Classic grade matcha tin', left: 71.55, top: 25.47, width: 6.9, height: 19.53 },
  { key: 'ceremonial-grade', src: './CeremonialGrade.png', alt: 'Ceremonial grade matcha tin', left: 79.45, top: 25.50, width: 6.9, height: 19.50 },
];

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
// these three keys or null in practice).
const SCOOP_FILL_COLORS = {
  'cafe-grade': '#CADBAF',
  'classic-grade': '#A3B979',
  'ceremonial-grade': '#809B7A',
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

// One pre-made "spoon with matcha mound" image per tin/grade -- keyed the
// same way as SCOOP_FILL_COLORS above (and with the same classic-grade
// fallback), swapped in wholesale as the big spoon's image source rather
// than layered as a separate overlay.
const SCOOP_SPOON_IMAGES = {
  'cafe-grade': './CafeGradeScoop.png',
  'classic-grade': './ClassicGradeScoop.png',
  'ceremonial-grade': './CeremonialGradeScoop.png',
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
  // down the container). Bottom edge is now 28.05 + 47.29 = 75.34%, clear
  // of the bar by ~9 points.
  { key: 'whisk', src: './whisk.png', alt: 'Bamboo whisk', left: 62.37, top: 28.05, width: 13.26, height: 47.29 },
];

const MOVABLE_START = MOVABLE_ITEMS.reduce((acc, item) => {
  acc[item.key] = { left: item.left, top: item.top };
  return acc;
}, {});

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

// How often (at minimum) a fresh spill-droplet burst can trigger while the
// ball is sitting outside the green zone during mixing -- see the
// spillBurstCount state and the tick() logic below. Not gated to "only
// once per exit" since a player who's sloppy for a long stretch should keep
// looking sloppy (matcha keeps flicking out), not just once per excursion.
const MIX_SPILL_INTERVAL_MS = 550;
// Anchor point for the spill-droplet burst, as a fraction of the bowl's own
// box -- just outside the bowl's right edge, roughly where a real whisk
// held at an angle would fling stray liquid out and over the rim.
const BOWL_SPILL_OFFSET = { leftFrac: 1.05, topFrac: 0.45 };

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

// Reads the fill's current live scaleX mid-transition (e.g. computed
// style's transform matrix reports whatever the browser has interpolated
// to at this exact frame) -- this is what lets stopping the gauge freeze
// it exactly where it visually is, rather than snapping to 0 or 1.
function getCurrentScaleX(el) {
  const transform = window.getComputedStyle(el).transform;
  if (!transform || transform === 'none') return 0;
  return new DOMMatrixReadOnly(transform).a;
}

const MatchaMaking = ({ activeStep, customerNumber, onNavigate, onAdvance, order, onSendToMilk }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  // Sends focus to the first matcha tin the moment this station mounts --
  // otherwise, ProgressBar's own autoFocus={isCurrent} (see ProgressBar.js)
  // would land focus on the bottom nav's "Matcha" step button instead, which
  // works fine as a generic default across every station but isn't the most
  // helpful *first* stop on a station a player hasn't used yet. Runs in a
  // plain useEffect (fires after mount, once painted) so it reliably
  // overrides that native autofocus rather than racing it -- .selectable is
  // unique to the tins in this component (see STATIC_ITEMS' JSX below), so
  // the query always grabs the first (cafe-grade) tin specifically.
  useEffect(() => {
    containerRef.current?.querySelector('.selectable')?.focus();
  }, []);

  // ---- Heater power button: on/off toggle, plus a green/red "temp zone"
  // light keyed to how far the temp bar fill has progressed (see
  // GREEN_AT_MS/RED_AT_MS above) -- scheduled with plain timers against
  // the same duration the fill itself animates over. Pressing the button
  // sends focus straight to the gauge (barRef) so the player can stop it
  // with Enter/Space right away -- that's the actual minigame: catch the
  // fill while it's between the two ticks by stopping it there.
  const [heaterOn, setHeaterOn] = useState(false);
  const [tempZone, setTempZone] = useState('below'); // 'below' | 'target' | 'over'
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
  // Focus target for the "matcha's poured, heat the water next" handoff --
  // see the bigSpoonStage effect further down that focuses this the moment
  // the big spoon's dump sequence finishes.
  const heaterButtonRef = useRef(null);

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
    setTempConfirmed(false);
    setTempBarVisible(true);
    clearTimeout(tempBarHideTimerRef.current);
    if (heaterOn) {
      setBarRunning(true);
      setFillActive(false);
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
    }
    setBarRunning(false);
    setTempConfirmed(true);
    clearTimeout(tempBarHideTimerRef.current);
    tempBarHideTimerRef.current = setTimeout(() => setTempBarVisible(false), TEMP_BAR_LINGER_MS);
  };

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
  // Focus target for the "temp bar's gone, carry the kettle over next"
  // handoff -- see the effect right below that focuses this once the gauge
  // finishes lingering and disappears.
  const kettleRef = useRef(null);
  // Focus target for the "kettle's done pouring, whisk it next" handoff --
  // see the kettleStage effect further down (where kettleStage returns to
  // 'idle' after actually pouring) that focuses this.
  const whiskRef = useRef(null);

  // Sends focus to the kettle the instant the temp bar disappears
  // (tempBarVisible flips false only once, via the hide timer stopBar
  // schedules -- see TEMP_BAR_LINGER_MS above -- so this can't misfire on,
  // say, the heater being switched off instead). Continues the same guided
  // "next thing to do" focus chain used everywhere else in this file (tin
  // -> scoop gauge -> big spoon -> heater button -> now the kettle), so the
  // player's steered straight into picking it up and carrying it to the
  // bowl next.
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
  // The bowl's own persistent "has water been poured in" state -- same
  // "doesn't reset on tin/selection changes" persistence as bowlPowder,
  // and the same caveat that a second pour just restarts this rather than
  // accumulating a bigger fill. { } | null (no color needed -- always
  // BOWL_WATER_FILL_COLOR -- so just a presence flag in object form for
  // consistency with bowlPowder's shape).
  const [bowlWater, setBowlWater] = useState(null);
  // Bumped once per pour and used as bowlWater's React `key` -- same
  // force-a-fresh-mount reasoning as pourCount for the matcha mound, so
  // .bowl-water's grow animation reliably replays every time.
  const [waterPourCount, setWaterPourCount] = useState(0);

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
  // Bumped each time the ball is caught drifting out of the green zone
  // during mixing, and used as the spill-droplets element's React `key` --
  // same "force a fresh mount so the CSS animation always replays" trick as
  // pourCount/waterPourCount elsewhere in this file. Real React state (not
  // a ref) since it needs to actually trigger the spill element to mount.
  const [spillBurstCount, setSpillBurstCount] = useState(0);

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
    // above) sends it (and the whisk resting in it) on to the Milk
    // Selection station instead of the ordinary placement below. Before
    // whiskStage is 'done', or dropped anywhere else, this falls through
    // same as always.
    if (item.key === 'bowl' && whiskStage === 'done' && isOverMakeDrinkZone(drag.left, drag.top)) {
      setDrag(null);
      sendBowlToMilk();
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
    beginWhiskMix();
  };

  // ---- "Make Drink": once whisking is done, sends the bowl (and the
  // whisk resting in it) on to the next station -- see onSendToMilk (a
  // prop from App.js, which stores it in state and passes it down to
  // MilkSelection as incomingBowl) and MAKE_DRINK_ZONE/isOverMakeDrinkZone
  // above for the drop-zone hit-test. Snapshotting bowlPowder here (rather
  // than letting MilkSelection read this screen's own state, which won't
  // exist anymore once onAdvance below swaps the active page away) is what
  // lets the next screen know which grade's whisked-liquid image to show.
  // onAdvance immediately follows, same "current step's done, move on"
  // action the ProgressBar's current-step dot already triggers -- this is
  // just a second, thematically-appropriate way to trigger the exact same
  // transition, not a replacement for it.
  const sendBowlToMilk = () => {
    if (!bowlPowder) return;
    onSendToMilk?.({ ...bowlPowder });
    onAdvance();
  };

  // D-pad/keyboard equivalent of dropping the bowl on the Make Drink label
  // -- same "no keyboard equivalent of 'drag it partway'" reasoning as
  // handleKettleKeyDown/handleWhiskKeyDown above.
  const handleBowlKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (whiskStage !== 'done') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    sendBowlToMilk();
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

  const handleTinKeyDown = (item) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
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
  // The bowl's own persistent "what's in it" state -- deliberately *not*
  // reset when selectedTin changes (unlike the state above), so closing the
  // tin selector or picking a different tin doesn't erase matcha that's
  // already been tipped into the bowl. { color } | null. Mounted the moment
  // 'pouring' starts (see the stage-transition effect below).
  const [bowlPowder, setBowlPowder] = useState(null);
  // Bumped once per dump (see beginDump below) and used as the mound's
  // React `key` in the JSX -- forces a fresh mount of the mound element on
  // every pour, rather than reusing/restyling whatever div was already
  // there from a previous pour. That's what makes .bowl-powder's grow
  // animation (see MatchaMaking.css) reliably restart from empty each time:
  // a *newly mounted* element always plays its CSS animation from the
  // first keyframe, whereas trying to replay/re-trigger an animation (or a
  // width/height transition) on an *already-mounted* element is finicky --
  // it can silently no-op if the element's already sitting at the
  // "finished" state from last time, which is exactly the failure mode a
  // second scoop hit before this.
  const [pourCount, setPourCount] = useState(0);
  const bigSpoonDragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });
  // Sends focus to the big spoon itself (see the effect below) the moment
  // it appears -- same "make the newly-revealed thing the next stop" idea
  // as the mount effect above that lands focus on the first tin, and the
  // scoopBarRef.current?.focus() call further down that lands focus on the
  // scoop gauge as soon as a tin's selected.
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
      scoopBarRef.current?.focus();
    } else {
      setScoopRunning(false);
    }
    return () => clearTimeout(scoopConfirmTimerRef.current);
  }, [selectedTin]);

  // Sends focus straight to the big spoon the instant it's revealed
  // (scoopConfirmed flipping true is exactly what mounts it -- see the JSX
  // below), so the very next Enter/Space press (or D-pad nudge) is already
  // aimed at the thing that just appeared, same "focus follows the newly-
  // revealed control" idea used everywhere else in this file. Guarded to
  // only fire while scoopConfirmed is actually true, not on the reverse
  // transition (e.g. a fresh tin selection resetting it back to false).
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
    // Bumped here (once per dump attempt, not once per pour-stage-enter) so
    // it's already a fresh value by the time 'pouring' mounts the mound
    // below -- see the pourCount comment above for why this key-based
    // remount is what makes the grow animation replay reliably.
    setPourCount((c) => c + 1);
  };

  // Advances the dump sequence's later stages on a timer -- 'moving' holds
  // just long enough for the glide-to-hover-spot CSS transition to finish
  // (see BIG_SPOON_MOVE_MS), then 'pouring' mounts the bowl's mound (keyed
  // by pourCount, so it's always a fresh element -- see the JSX below,
  // which is what lets .bowl-powder's CSS grow animation play reliably
  // every time instead of only the first), timed to finish exactly when
  // BIG_SPOON_POUR_MS's falling-powder effect does, then finally puts the
  // spoon away. Re-running this effect (e.g. selectedTin resetting
  // bigSpoonStage back to 'idle' mid-sequence) cleans up whichever timer
  // was pending via the return below, so an abandoned sequence can't fire
  // late.
  useEffect(() => {
    if (bigSpoonStage === 'moving') {
      const t = setTimeout(() => setBigSpoonStage('pouring'), BIG_SPOON_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (bigSpoonStage === 'pouring') {
      // grade (selectedTin at the moment of the dump) is what
      // WHISKED_LIQUID_IMAGES gets keyed off of once whiskStage reaches
      // 'done' -- captured here rather than read live off selectedTin later,
      // since selectedTin could in principle change/reset well before the
      // whisking minigame actually finishes.
      setBowlPowder({ color: scoopColor, grade: selectedTin });
      const t = setTimeout(() => setBigSpoonStage('done'), BIG_SPOON_POUR_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [bigSpoonStage, scoopColor, selectedTin]);

  // Sends focus to the heater's power button once the matcha's fully
  // poured -- bigSpoonStage flipping to 'done' is exactly the moment the
  // big spoon itself unmounts (see the JSX below), so this continues the
  // guided "next thing to do" focus chain (tin -> scoop gauge -> big spoon
  // -> now the heater), steering the player straight into starting the
  // water-heating step next rather than leaving focus on a now-vanished
  // element.
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
    setWaterPourCount((c) => c + 1);
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
      setBowlWater({});
      const t = setTimeout(() => {
        setItemPositions((prev) => ({ ...prev, kettle: MOVABLE_START.kettle }));
        setKettleStage('idle');
        // Continues the guided "next thing to do" focus chain (tin -> scoop
        // gauge -> big spoon -> heater button -> kettle -> now the whisk)
        // right as the kettle finishes pouring and glides back to the
        // counter -- this only ever runs from inside the 'pouring' branch,
        // so it can't misfire at initial mount, when kettleStage also
        // starts out 'idle' but nothing's actually been poured yet.
        whiskRef.current?.focus();
      }, KETTLE_POUR_MS);
      return () => clearTimeout(t);
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
  // Anchor point for the spill-droplet burst -- same "recompute off the
  // bowl's current position every render" reasoning as mixBarPos above, so
  // it stays put next to the bowl even if the bowl was dragged before
  // mixing started.
  const bowlSpillLeft = bowlPos.left + BOWL_SPILL_OFFSET.leftFrac * bowlItem.width;
  const bowlSpillTop = bowlPos.top + BOWL_SPILL_OFFSET.topFrac * bowlItem.height;

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

    const ballWidthPercent = MIX_BALL_WIDTH_FRAC * 100;
    const maxPosition = 100 - ballWidthPercent;
    // Starts centered in the bar (not the zone specifically, though the
    // zone happens to be centered too) so the player gets a beat before
    // the drift meaningfully pushes it off-center.
    mixPositionRef.current = 50 - ballWidthPercent / 2;
    mixVelocityRef.current = 0;
    setSpillBurstCount(0);

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

        // Sloppy stirring (ball outside the green zone) throws a burst of
        // matcha out of the bowl -- retriggers every MIX_SPILL_INTERVAL_MS
        // for as long as the ball stays out, not just once on the initial
        // exit, so a long stretch of poor balancing keeps looking messy
        // rather than showing a single splash and going quiet.
        if (!inZone && elapsedMs - lastSpillAt >= MIX_SPILL_INTERVAL_MS) {
          lastSpillAt = elapsedMs;
          setSpillBurstCount((count) => count + 1);
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
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
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
          src="./MatchaBaseStation.png"
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
          }`}
          data-focusable
          aria-pressed={heaterOn}
          aria-label={heaterOn ? 'Turn heater off' : 'Turn heater on'}
          onClick={() => setHeaterOn((prev) => !prev)}
          style={{
            left: `${HEATER_BUTTON_BOX.left}%`,
            top: `${HEATER_BUTTON_BOX.top}%`,
            width: `${HEATER_BUTTON_BOX.width}%`,
            height: `${HEATER_BUTTON_BOX.height}%`,
          }}
        />
        {heaterOn && tempBarVisible && (
          <div
            ref={barRef}
            className={`heater-temp-bar${fillActive ? ' on' : ''}`}
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
          </div>
        )}
        {STATIC_ITEMS.map((item) => (
          <img
            key={item.key}
            src={item.src}
            alt={`${item.alt}. Select it and press Enter to measure a scoop.`}
            className="station-item selectable"
            data-focusable
            tabIndex={0}
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              width: `${item.width}%`,
              height: `${item.height}%`,
            }}
            onKeyDown={handleTinKeyDown(item)}
          />
        ))}
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
                <div
                  ref={scoopBarRef}
                  className="scoop-bar"
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
          const settling = (isKettle && kettleStage !== 'idle') || (isWhisk && whiskStage !== 'idle');
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
              ref={isKettle ? kettleRef : isWhisk ? whiskRef : undefined}
              src={item.src}
              alt={
                isWhisk
                  ? `${item.alt}. Drag onto the bowl to mix once the matcha and water are both in, or select it and press Enter.`
                  : isBowl && whiskStage === 'done'
                  ? `${item.alt}. Drag to the Make Drink label to send it to the next station, or select it and press Enter.`
                  : `${item.alt}. Drag to move.`
              }
              className={`station-item movable${dragging ? ' dragging' : ''}${settling ? ' settling' : ''}${
                pouring ? ' pouring' : ''
              }${mixing ? ' mixing' : ''}`}
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
                ...(isWhisk ? { zIndex: 2 } : {}),
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
        {/* Falling-powder pour effect -- see pourLeft/pourTop/pourHeight
            above -- only while the spoon's actually holding at its
            hover-above-the-bowl spot (the 'moving' stage is still just the
            glide there). Rendered here (after MOVABLE_ITEMS, i.e. after the
            bowl) rather than back up alongside the spoon itself, so it's
            unambiguously later in paint order than the bowl and can't end
            up rendered underneath it. Four grains on staggered delays/
            offsets so it reads as a fuller stream rather than one dot. */}
        {bigSpoonStage === 'pouring' && (
          <div
            className="spoon-pour"
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
            can't paint underneath the bowl" reasoning as that one. */}
        {kettleStage === 'pouring' && (
          <div
            className="spoon-pour"
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
        {/* whiskStage !== 'done' -- once whisking finishes, .bowl-whisked-
            liquid (further down) replaces this plain-color mound entirely
            rather than painting over it, so it doesn't peek out from
            behind/around the whisked-liquid image (which, since being
            sized down to BOWL_INNER_RIM_WIDTH_FRAC/HEIGHT_FRAC, is smaller
            than this mound's own box and no longer fully covers it). */}
        {bowlPowder && whiskStage !== 'done' && (
          <div
            key={pourCount}
            className="bowl-powder"
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
            bowl-powder (key={waterPourCount} forces a fresh mount each pour
            so the animation always replays -- see the pourCount comment on
            bowlPowder's state in this file for why). */}
        {/* whiskStage !== 'done' -- same reasoning as bowl-powder above, so
            this translucent pool doesn't linger visible around the edges
            of the smaller whisked-liquid image once mixing's finished. */}
        {bowlWater && whiskStage !== 'done' && (
          <div
            key={waterPourCount}
            className="bowl-water"
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
            className="bowl-mix-swirl"
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
        {whiskStage === 'done' && bowlPowder && (
          <img
            className="bowl-whisked-liquid"
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
          <div
            className="mix-bar"
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
        )}
        {/* Spill-droplet burst -- shown whenever the ball drifts out of the
            green zone during mixing (see spillBurstCount/lastSpillAt in the
            mixing physics effect above), simulating stray matcha flicking
            out of the bowl from sloppy whisking. key={spillBurstCount}
            forces a fresh mount each time so the CSS fly-out animation
            always replays, same "fresh mount, not restyle" trick as
            pourCount/waterPourCount elsewhere in this file. Gated on
            whiskStage === 'mixing' too so it can't linger rendered once
            mixing ends. */}
        {whiskStage === 'mixing' && spillBurstCount > 0 && (
          <div
            key={spillBurstCount}
            className="bowl-spill"
            aria-hidden="true"
            style={{
              left: `${bowlSpillLeft}%`,
              top: `${bowlSpillTop}%`,
            }}
          >
            <span className="bowl-spill-drop bowl-spill-drop-1" />
            <span className="bowl-spill-drop bowl-spill-drop-2" />
            <span className="bowl-spill-drop bowl-spill-drop-3" />
          </div>
        )}
        {/* "Make Drink" drop-zone -- only appears once whisking is done
            (see whiskStage/MAKE_DRINK_ZONE/isOverMakeDrinkZone above). Not
            itself focusable/clickable -- it's a drop target the *bowl*
            gets dragged onto (handlePointerUp's bowl branch) or sent to via
            the bowl's own Enter press (handleBowlKeyDown), same "the label
            just marks a zone, the movable item is what's actually
            selected" pattern the ice box/cup drop zones use on the Milk
            Selection screen. aria-hidden since the bowl's own alt text
            (see the isBowl branch above) already describes this action to
            screen readers. */}
        {whiskStage === 'done' && (
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
            Make Drink
          </div>
        )}
        <OrderReceiptButton order={order} />
        <ProgressBar
          activeStep={activeStep}
          customerNumber={customerNumber}
          onNavigate={onNavigate}
          onAdvance={onAdvance}
        />
      </div>
    </div>
  );
};

export default MatchaMaking;
