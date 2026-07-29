import React, { useEffect, useRef, useState } from 'react';
import './MilkSelection.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { getActionFromKeyEvent, shouldDebounceEnter } from '../gameloop/pal';
import ProgressBar from './ProgressBar';
import OrderReceiptButton from './OrderReceiptButton';
import {
  MOVABLE_ITEMS,
  BOWL_INNER_RIM_CENTER,
  BOWL_INNER_RIM_WIDTH_FRAC,
  BOWL_INNER_RIM_HEIGHT_FRAC,
  WHISKED_LIQUID_IMAGES,
  SCOOP_FILL_COLORS,
} from './MatchaMaking';

// Where the bowl (whisked matcha, no whisk -- see incomingBowl below) sent
// over from MatchaMaking's "Make Drink" drop-zone comes to rest on this
// screen. Open patch of counter to the left of the cup's table spot
// (CUP_SPOTS.table, left 40.30) and clear above the ice box (ICE_BOX_SPOTS,
// top 73.30+) so it doesn't overlap either. Purely decorative here (not
// draggable/focusable) -- there's no "pour the matcha into the cup"
// mechanic yet, this is just carrying the previous station's result over
// so it doesn't just vanish.
const INCOMING_BOWL_SPOT = { left: 8, top: 22 };

// Container-relative percentage boxes for the two places the glass cup can
// sit (see the pixel math in MilkSelection.css above .glass-cup). The cup
// is bigger once it's on the table (as if set down closer to camera) and
// its bottom edge lands at the same level the milk bottles stand at,
// centered horizontally on the table.
// top values are offset by -0.96 vs. the raw image math (see
// object-position: top on .milk-selection-art in MilkSelection.css) so the
// cup/ice tracks the art now that it's anchored to the top of the frame.
const CUP_SPOTS = {
  shelf: { left: 71.12, top: 25.79 },
  table: { left: 40.30, top: 40.10 },
};
const SHELF_SIZE = { width: 6.47, height: 12.39 };
// Exported (alongside getMilkBoxFor/getMatchaBoxFor below) so
// ToppingsStation.js can render its own carried-over cup at this exact same
// size rather than guessing a scaled-down one.
export const TABLE_SIZE = { width: 19.40, height: 37.16 }; // same aspect ratio, 3x

// The four milk/water bottles, standing in a tight row on the counter to
// the right of the sink, roughly where they used to be baked directly into
// MilkMixingStation.png before that art was swapped for a bottle-free
// version. All four source PNGs share (near enough) the same 169x325
// canvas aspect ratio, so rather than track four slightly different boxes
// they're uniform: one BOTTLE_WIDTH/BOTTLE_HEIGHT pair (converted from that
// canvas aspect into container-relative % -- see the width formula below,
// which accounts for the container itself being 1920x1080 rather than
// square) and one shared BOTTLE_BOTTOM so every bottle's base sits on the
// same counter line regardless of height. These positions are each
// bottle's "home" spot -- see BOTTLE_HOME below, and the drag/snap-back
// handlers in the component, for the pick-up-and-put-back interaction.
// top/BOTTLE_BOTTOM carry the same -0.96 letterbox offset as CUP_SPOTS/
// ICE_BOX_SPOTS above.
const BOTTLE_CANVAS_ASPECT = 169 / 325; // width/height, shared by all four PNGs
const BOTTLE_HEIGHT = 38;
const BOTTLE_WIDTH = BOTTLE_HEIGHT * BOTTLE_CANVAS_ASPECT * (9 / 16); // container is 1920x1080
// A bit lower than the counter line the bottles used to stand on in the
// baked-in art (78.47), but still well clear of the counter's front-edge
// seam (~90.7% in container space, measured off MilkMixingStation.png) so
// the bigger bottles below don't hang off the counter.
const BOTTLE_BOTTOM = 83;
const BOTTLE_VISUAL_GAP = 0.3; // sliver of space between each bottle's actual silhouette
const BOTTLE_CLUSTER_CENTER = 83; // roughly centered under the cabinet in the art

// Each PNG's canvas has a different amount of transparent padding around
// its actual bottle/carton silhouette (measured from each file's own alpha
// bounding box, as a fraction of its 169-or-170-wide canvas) -- packing by
// box edges alone left wildly uneven, much-bigger-than-intended-looking
// gaps since e.g. coconut's canvas has ~40% empty space on its left side
// alone. leftPad/rightPad below are what let the loop underneath space
// bottles by where their actual art starts/ends instead of by their boxes.
const BOTTLE_KEYS = [
  { key: 'oat', src: './OatMilk.png', alt: 'Oat milk', leftPad: 24 / 169, rightPad: (169 - 108) / 169 },
  { key: 'dairy', src: './DairyMilk.png', alt: 'Dairy milk', leftPad: 34 / 170, rightPad: (170 - 136) / 170 },
  { key: 'almond', src: './AlmondMilk.png', alt: 'Almond milk', leftPad: 34 / 169, rightPad: (169 - 119) / 169 },
  { key: 'coconut', src: './CoconutWater.png', alt: 'Coconut water', leftPad: 67 / 169, rightPad: (169 - 144) / 169 },
];

// Walk left-to-right so each bottle's visible content (box left + leftPad,
// through box left + (1 - rightPad) * BOTTLE_WIDTH) sits exactly
// BOTTLE_VISUAL_GAP past the previous bottle's, then shift the whole row
// so it's centered on BOTTLE_CLUSTER_CENTER.
const bottleBoxLefts = [0];
for (let i = 1; i < BOTTLE_KEYS.length; i += 1) {
  const prev = BOTTLE_KEYS[i - 1];
  const gapNeeded = (1 - prev.rightPad - BOTTLE_KEYS[i].leftPad) * BOTTLE_WIDTH + BOTTLE_VISUAL_GAP;
  bottleBoxLefts.push(bottleBoxLefts[i - 1] + gapNeeded);
}
const clusterBoxWidth = bottleBoxLefts[bottleBoxLefts.length - 1] + BOTTLE_WIDTH - bottleBoxLefts[0];
const clusterStartLeft = BOTTLE_CLUSTER_CENTER - clusterBoxWidth / 2;

const BOTTLE_ITEMS = BOTTLE_KEYS.map((item, index) => ({
  key: item.key,
  src: item.src,
  alt: item.alt,
  left: clusterStartLeft + bottleBoxLefts[index],
  top: BOTTLE_BOTTOM - BOTTLE_HEIGHT,
  width: BOTTLE_WIDTH,
  height: BOTTLE_HEIGHT,
}));

// Each bottle's counter spot, keyed for lookup -- both the starting
// position on mount and the "home" a bottle snaps back to once it's been
// picked up and set back down (see BOTTLE_SNAP_FRACTION/BOTTLE_CLICK_MAX_
// MOVE_PCT below).
const BOTTLE_HOME = BOTTLE_ITEMS.reduce((acc, item) => {
  acc[item.key] = { left: item.left, top: item.top };
  return acc;
}, {});

// ---- Pouring a bottle into the cup ---------------------------------------
// Same shape as MatchaMaking's kettle-pouring-into-the-bowl sequence:
// glide to a hover spot above the cup, tilt, "pour" (the cup's own milk
// fill appears), then glide back home -- reusable, not a one-time-use item,
// same as the kettle. All four bottles share this same sequence (see
// pouringKey/pourStage in the component below) -- started out oat-only as
// a first pass, generalized once that proved out.
//
// Milk isn't actually transparent in GlassCup.png (checked the source PNG
// directly -- the interior is a flat opaque pale fill, alpha 255
// throughout, not a cutout), so this uses the exact same trick as the
// matcha bowl's own bowl-water/bowl-powder: a plain colored shape
// (.cup-milk-fill) positioned over the glass's interior and painted on top
// of it in DOM order, with enough transparency in its own fill color that
// the glass's outline/highlight linework still reads through on top of it.
//
// Hover spot is centered horizontally on the cup and just above its rim --
// there's no measured spout position for the bottle art (unlike the
// kettle, which has KETTLE_SPOUT_OFFSET pinned to its actual spout pixel),
// so this is a simpler approximation: center the whole bottle over the cup
// rather than aligning a specific spout point.
const BOTTLE_HOVER_GAP = 2; // % gap between the bottle's bottom edge and the cup's rim
function getBottleHoverPos(cupPos, cupSize, bottleItem) {
  return {
    left: cupPos.left + cupSize.width / 2 - bottleItem.width / 2,
    top: cupPos.top - bottleItem.height - BOTTLE_HOVER_GAP,
  };
}
const BOTTLE_POUR_ROTATE_DEG = -35; // simple tilt for the pour -- no pinned transform-origin/spout math yet, unlike the kettle's own KETTLE_POUR_ROTATE_DEG
const BOTTLE_MOVE_MS = 350; // time to glide to the hover spot -- same reasoning as MatchaMaking's KETTLE_MOVE_MS
const BOTTLE_POUR_MS = 900; // how long the tilt/pour holds before gliding back home

// How long the finished cup takes to glide into the Send Drink zone, and
// how long its shrink/fade takes once it's arrived -- same values as
// MatchaMaking's own BOWL_CARRY_MOVE_MS/BOWL_VANISH_MS, whose
// .bowl-vanishing CSS animation (0.35s) this reuses directly.
const CUP_SEND_MOVE_MS = 350;
const CUP_SEND_VANISH_MS = 350;

// Where the milk fill sits inside the cup once poured (see cupMilk/
// beginPour below) -- fixed to the cup's table position rather than
// tracking a later re-drag, same simplification getIceCupSlotPos already
// relies on (CUP_SPOTS.table, not the cup's live position). Inset from
// TABLE_SIZE's own box as a rough approximation of the glass's tapered
// interior -- not a pixel-perfect trace of the silhouette, same
// simplification as the matcha bowl's own circular bowl-water/bowl-powder
// fills.
const CUP_MILK_BOX_FRAC = { leftFrac: 0.08, rightFrac: 0.92, topFrac: 0.36, bottomFrac: 0.94 };

// Colors for the falling-liquid pour effect's grains, one per bottle (see
// pourLeft/pourTop/pourHeight below) -- each a touch more opaque than its
// resting .cup-milk-fill.<key> color (CSS) since a thin falling stream
// needs more solidity to read clearly, same reasoning as MatchaMaking's
// WATER_COLOR vs. its own bowl-water fill.
const MILK_STREAM_COLORS = {
  oat: 'rgba(230, 217, 181, 0.92)',
  dairy: 'rgba(255, 253, 246, 0.95)',
  almond: 'rgba(238, 231, 219, 0.92)',
  coconut: 'rgba(240, 247, 247, 0.85)',
};

// Generic version of the milk-box math, parameterized on a cup position/
// size rather than hardcoded to CUP_SPOTS.table/TABLE_SIZE -- exported so
// ToppingsStation.js can compute the same box against its own carried-over
// cup's position/size (INCOMING_DRINK_SPOT/INCOMING_DRINK_SIZE there)
// without duplicating CUP_MILK_BOX_FRAC's actual fraction values. getCupMilkBox
// below is just this called with this screen's own cup spot/size.
export function getMilkBoxFor(cupPos, cupSize) {
  return {
    left: cupPos.left + CUP_MILK_BOX_FRAC.leftFrac * cupSize.width,
    top: cupPos.top + CUP_MILK_BOX_FRAC.topFrac * cupSize.height,
    width: (CUP_MILK_BOX_FRAC.rightFrac - CUP_MILK_BOX_FRAC.leftFrac) * cupSize.width,
    height: (CUP_MILK_BOX_FRAC.bottomFrac - CUP_MILK_BOX_FRAC.topFrac) * cupSize.height,
  };
}

function getCupMilkBox() {
  return getMilkBoxFor(CUP_SPOTS.table, TABLE_SIZE);
}

// Matcha poured on top of the milk/water base -- a second fill the same
// width as the milk box (getCupMilkBox), split into two zones so it reads
// as actually blending with the base rather than either stacking as a flat
// second color or floating separately above it:
//   - CUP_MATCHA_RAISE_FRAC -- the portion that sits ABOVE the milk's own
//     top edge, raising the drink's overall fill line (pure matcha here,
//     nothing to blend with since there's no base at this height).
//   - CUP_MATCHA_OVERLAP_FRAC -- the portion that dips back down INTO the
//     milk fill, where .cup-matcha-fill's own background (CSS) is a
//     top-to-bottom gradient fading from solid matcha color down to fully
//     transparent, so the milk underneath increasingly shows through and
//     the two colors read as gradually mixing instead of meeting at a hard
//     line. Both fractions are expressed against the milk box's own
//     height, same unit CUP_MILK_BOX_FRAC-derived boxes always use here.
const CUP_MATCHA_RAISE_FRAC = 0.18;
const CUP_MATCHA_OVERLAP_FRAC = 0.5;

// Same "generic, parameterized on a milk box" split as getMilkBoxFor above
// -- exported for ToppingsStation.js's own carried-over cup.
export function getMatchaBoxFor(milkBox) {
  const raise = milkBox.height * CUP_MATCHA_RAISE_FRAC;
  const overlap = milkBox.height * CUP_MATCHA_OVERLAP_FRAC;
  return {
    left: milkBox.left,
    top: milkBox.top - raise,
    width: milkBox.width,
    height: raise + overlap,
  };
}

function getCupMatchaBox() {
  return getMatchaBoxFor(getCupMilkBox());
}

// Same idea as MatchaMaking's kettle/bowl/whisk: drop a bottle back close
// to its home spot and it snaps the rest of the way in, scaled to the
// bottle's own footprint. A drop anywhere else just leaves it there.
const BOTTLE_SNAP_FRACTION = 0.5;
// Below this much total pointer movement (in container %), a pointer-down
// -> pointer-up is treated as a plain click/tap rather than a drag -- lets
// players snap a displaced bottle straight home with a single click/Select
// press instead of having to drag it all the way back themselves.
const BOTTLE_CLICK_MAX_MOVE_PCT = 1;

function clampPct(value, size) {
  return Math.min(Math.max(value, 0), 100 - size);
}

// Seven ice cubes start piled inside the ice box in two vertical columns
// (4 left, 3 right), each cube overlapping the one above it so the stack
// stays within the box's shallow depth without spilling past its bottom
// edge into the progress bar below (see the pixel math in
// MilkSelection.css above .ice-cube). Each cube has its own fixed "in cup"
// slot (near the rim) so placement order doesn't matter -- cube 0 always
// ends up in slot 0, etc.
const ICE_BOX_SPOTS = [
  { left: 7.18, top: 73.30 },
  { left: 7.18, top: 75.21 },
  { left: 7.18, top: 77.13 },
  { left: 7.18, top: 79.04 },
  { left: 12.93, top: 73.30 },
  { left: 12.93, top: 75.21 },
  { left: 12.93, top: 77.13 },
];
const ICE_BOX_SIZE = { width: 5.03, height: 9.196 };
const ICE_CUP_SIZE = { width: 4, height: 4.11 };
// Cluster near the bottom of the glass instead of floating at the rim --
// y values follow the taper of GlassCup.png (verified against a stretched
// preview of the art). Five cubes form a front row along the glass floor;
// the other two sit as a back layer tucked above/behind the outer front
// cubes (rather than spread out to the sides, which is what used to poke
// them slightly outside the glass's tapered walls).
const ICE_CUP_SLOT_FRACTIONS = [
  { x: 0.28, y: 0.68 },
  { x: 0.72, y: 0.68 },
  { x: 0.30, y: 0.756 },
  { x: 0.40, y: 0.789 },
  { x: 0.50, y: 0.80 },
  { x: 0.60, y: 0.789 },
  { x: 0.70, y: 0.756 },
];

function getIceCupSlotPos(index) {
  const cup = CUP_SPOTS.table;
  const frac = ICE_CUP_SLOT_FRACTIONS[index % ICE_CUP_SLOT_FRACTIONS.length];
  const centerX = cup.left + frac.x * TABLE_SIZE.width;
  const centerY = cup.top + frac.y * TABLE_SIZE.height;
  return {
    left: centerX - ICE_CUP_SIZE.width / 2,
    top: centerY - ICE_CUP_SIZE.height / 2,
  };
}

// Generous hit-test box for "is this drop point inside the cup" -- the cup
// itself only counts as a valid target while it's on the table (there's
// nothing to drop ice into while it's still up on the shelf).
function isOverCup(leftPct, topPct, cupSpot) {
  if (cupSpot !== 'table') return false;
  const cup = CUP_SPOTS.table;
  const margin = 3; // percentage points of extra forgiveness on each side
  return (
    leftPct >= cup.left - margin &&
    leftPct <= cup.left + TABLE_SIZE.width + margin &&
    topPct >= cup.top - margin &&
    topPct <= cup.top + TABLE_SIZE.height + margin
  );
}

// Bounding box around every ICE_BOX_SPOTS position, derived automatically
// so it stays correct if the pile's layout changes again later. Used as the
// symmetric "is this drop point back over the ice box" hit-test for
// dragging a placed cube back out of the cup.
const ICE_BOX_BOUNDS = {
  left: Math.min(...ICE_BOX_SPOTS.map((s) => s.left)),
  top: Math.min(...ICE_BOX_SPOTS.map((s) => s.top)),
  right: Math.max(...ICE_BOX_SPOTS.map((s) => s.left)) + ICE_BOX_SIZE.width,
  bottom: Math.max(...ICE_BOX_SPOTS.map((s) => s.top)) + ICE_BOX_SIZE.height,
};

function isOverIceBox(leftPct, topPct) {
  const margin = 3;
  return (
    leftPct >= ICE_BOX_BOUNDS.left - margin &&
    leftPct <= ICE_BOX_BOUNDS.right + margin &&
    topPct >= ICE_BOX_BOUNDS.top - margin &&
    topPct <= ICE_BOX_BOUNDS.bottom + margin
  );
}

// "Send to Toppings" drop-zone -- same idea as MatchaMaking's own "Make
// Drink" zone (MAKE_DRINK_ZONE/isOverMakeDrinkZone there), just carrying
// the finished cup forward to the Toppings station instead of the bowl to
// this one. Bottom-right corner, clear of the milk bottle cluster above it
// (BOTTLE_ITEMS work out to roughly left 69.5-96.5, top 45-83 -- see
// BOTTLE_CLUSTER_CENTER/BOTTLE_BOTTOM above) and clear of the ProgressBar
// (bottom-center, same ~77.3%-from-center-at-most reasoning as
// MAKE_DRINK_ZONE's own comment in MatchaMaking.js, since it's the same
// component/width here too).
const SEND_DRINK_ZONE = { left: 78, top: 85, width: 19, height: 13 };

function isOverSendDrinkZone(leftPct, topPct) {
  const margin = 3;
  return (
    leftPct >= SEND_DRINK_ZONE.left - margin &&
    leftPct <= SEND_DRINK_ZONE.left + SEND_DRINK_ZONE.width + margin &&
    topPct >= SEND_DRINK_ZONE.top - margin &&
    topPct <= SEND_DRINK_ZONE.top + SEND_DRINK_ZONE.height + margin
  );
}

const MilkSelection = ({ activeStep, customerNumber, onNavigate, onAdvance, order, incomingBowl, onSendToToppings }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  // ---- Carried-over bowl from Matcha Making (see incomingBowl above) -----
  // Just the bowl + whisked-matcha image, no whisk -- reuses the same
  // BOWL_INNER_RIM_* fractions MatchaMaking.js uses for its own
  // whisked-liquid image, just anchored to this screen's own
  // INCOMING_BOWL_SPOT instead of wherever the bowl happened to be dragged
  // on that screen, so the whisked matcha lines up with the bowl's rim
  // here the same way it does there. incomingBowlItem.width/height are
  // MOVABLE_ITEMS' sizing for MatchaMaking's own counter, which read too
  // big once the bowl "arrives" here on a screen with a different sense of
  // scale -- INCOMING_BOWL_SCALE shrinks just this carried-over copy
  // (MatchaMaking's own bowl is untouched). The BOWL_INNER_RIM_* fractions
  // are applied against the scaled width/height below rather than the
  // original, so the whisked-liquid overlay still lines up with the
  // shrunk bowl's own rim.
  const INCOMING_BOWL_SCALE = 0.6;
  const incomingBowlItem = MOVABLE_ITEMS.find((item) => item.key === 'bowl');
  const incomingBowlWidth = incomingBowlItem.width * INCOMING_BOWL_SCALE;
  const incomingBowlHeight = incomingBowlItem.height * INCOMING_BOWL_SCALE;

  // The bowl's own live position -- starts (and always snaps back to)
  // INCOMING_BOWL_SPOT, but shifts to the hover-over-cup spot while it's
  // being poured (see beginPour('bowl') below), same live-position pattern
  // as bottlePositions for the milk bottles. Unlike the bottles it isn't
  // left wherever it's dropped -- there's nowhere else meaningful for it to
  // sit, so any drop that doesn't land a pour just snaps it home.
  const [bowlPos, setBowlPos] = useState(INCOMING_BOWL_SPOT);
  const [bowlDrag, setBowlDrag] = useState(null); // { left, top } | null
  const bowlDragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });

  // Rim math now follows the bowl's own live position -- bowlDrag while
  // it's actively being pointer-dragged, otherwise bowlPos (its resting or
  // gliding-to-pour spot) -- instead of the fixed spot, so the
  // whisked-matcha overlay travels and tilts together with the bowl
  // through both a manual drag and the automated pour glide.
  const incomingBowlRenderPos = bowlDrag || bowlPos;
  const incomingRimLeft = incomingBowlRenderPos.left + BOWL_INNER_RIM_CENTER.leftFrac * incomingBowlWidth;
  const incomingRimTop = incomingBowlRenderPos.top + BOWL_INNER_RIM_CENTER.topFrac * incomingBowlHeight;
  const incomingRimWidth = BOWL_INNER_RIM_WIDTH_FRAC * incomingBowlWidth;
  const incomingRimHeight = BOWL_INNER_RIM_HEIGHT_FRAC * incomingBowlHeight;

  // ---- Glass cup: shelf <-> table --------------------------------------
  const [cupSpot, setCupSpot] = useState('shelf');
  const [cupDragPos, setCupDragPos] = useState(null);
  const cupDragStartRef = useRef({ pointerX: 0, pointerY: 0, cupLeft: 0, cupTop: 0 });

  // ---- Sending the finished cup on to Toppings (see SEND_DRINK_ZONE
  // above) -- same "carry to a corner zone, then shrink/fade away" shape as
  // MatchaMaking's own bowlStage/beginBowlCarry, just for the cup here.
  //   'idle'      -- normal, cup behaves exactly as it always has (shelf <->
  //                  table drag/Enter-toggle).
  //   'carrying'  -- confirmed (dropped on the zone, or Enter/Space once
  //                  canSendDrink) -- gliding to the zone's own center.
  //   'vanishing' -- arrived; shrinking/fading away (reuses MatchaMaking.
  //                  css's .bowl-vanishing, already loaded globally, on the
  //                  cup image, its fills, and any placed ice cubes).
  //   'sent'      -- fade's finished; the cup (and everything in it) stops
  //                  rendering entirely, same as the bowl once bowlStage
  //                  reaches 'sent' over on MatchaMaking.
  // Declared up here (rather than down near cupMilk/cupMatcha, where the
  // rest of the sending logic lives) because cupRenderPos just below
  // already needs to read cupSendPos -- a plain render-time reference, not
  // a closure, so it has to come after this declaration textually, not just
  // logically.
  const [cupSendStage, setCupSendStage] = useState('idle');
  // Live position while gliding to/sitting in the Send Drink zone -- same
  // role as bowlPos, kept separate from cupDragPos (which specifically
  // means "actively being pointer-dragged right now", and whose truthiness
  // also toggles .glass-cup.dragging elsewhere) so this doesn't fight with
  // that class's own meaning.
  const [cupSendPos, setCupSendPos] = useState(null);

  const handleCupPointerDown = (e) => {
    // Can't pick the cup back up once it's mid-carry/vanishing/gone -- same
    // "settling" reasoning as .milk-bottle.settling/.station-item.movable.
    // settling elsewhere (pointer-events: none on the cup while sending, see
    // the JSX below, is the other half of this -- this guard is a backstop
    // in case something still calls the handler directly).
    if (cupSendStage !== 'idle') return;
    const base = CUP_SPOTS[cupSpot];
    e.currentTarget.setPointerCapture(e.pointerId);
    cupDragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      cupLeft: base.left,
      cupTop: base.top,
    };
    setCupDragPos({ left: base.left, top: base.top });
  };

  const handleCupPointerMove = (e) => {
    if (!cupDragPos) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - cupDragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - cupDragStartRef.current.pointerY) / rect.height) * 100;
    setCupDragPos({
      left: cupDragStartRef.current.cupLeft + dxPct,
      top: cupDragStartRef.current.cupTop + dyPct,
    });
  };

  const handleCupPointerUp = (e) => {
    if (!cupDragPos) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // Dropping the finished cup on the Send Drink zone (once there's a
    // base poured -- see canSendDrink above) carries it off instead of the
    // ordinary shelf/table placement below -- same "special-cased drop
    // target" pattern as the bottles' own drop-on-cup branch.
    if (canSendDrink && isOverSendDrinkZone(cupDragPos.left, cupDragPos.top)) {
      setCupDragPos(null);
      beginSendDrink();
      return;
    }
    const midpoint = (CUP_SPOTS.shelf.top + CUP_SPOTS.table.top) / 2;
    setCupSpot(cupDragPos.top > midpoint ? 'table' : 'shelf');
    setCupDragPos(null);
  };

  const handleCupKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    // Once the cup qualifies to be sent on (canSendDrink), Enter sends it
    // instead of toggling shelf <-> table -- same "the meaningful action
    // takes over from the mundane default" reasoning as the milk bottles'
    // own handleBottleKeyDown. There's no real reason to send a poured cup
    // back to the shelf anyway, so this doesn't give up anything.
    if (canSendDrink) {
      beginSendDrink();
      return;
    }
    setCupSpot((prev) => (prev === 'shelf' ? 'table' : 'shelf'));
  };

  const cupRenderPos = cupDragPos || cupSendPos || CUP_SPOTS[cupSpot];
  // Sized by the cup's current spot the whole time -- cupSpot only flips on
  // drop (see handleCupPointerUp/handleCupKeyDown), so grabbing it off the
  // table keeps it at TABLE_SIZE for the full drag instead of snapping down
  // to SHELF_SIZE the instant you pick it up (which used to yank it out
  // from under the cursor and made it impossible to drag back to the
  // shelf). It shrinks/grows only at the moment cupSpot actually changes.
  const cupRenderSize = cupSpot === 'table' ? TABLE_SIZE : SHELF_SIZE;
  // Box the milk fill renders into once poured -- see getCupMilkBox/
  // CUP_MILK_BOX_FRAC above. Cheap to recompute every render (it's fixed
  // math off constants, not live drag state), same as bowlInnerRimLeft/Top
  // in MatchaMaking.js. cupMatchaBox is the shallower box the matcha layer
  // renders into on top of it -- see getCupMatchaBox/CUP_MATCHA_HEIGHT_FRAC
  // above.
  const cupMilkBox = getCupMilkBox();
  const cupMatchaBox = getCupMatchaBox();

  // ---- Ice cubes: ice box -> cup ----------------------------------------
  // Whether each of the 7 cubes has been placed in the cup yet.
  const [icePlaced, setIcePlaced] = useState(new Array(ICE_BOX_SPOTS.length).fill(false));
  // Which cube (if any) is being dragged right now, and its live position.
  const [iceDrag, setIceDrag] = useState(null); // { index, left, top } | null
  const iceDragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });

  const handleIcePointerDown = (index) => (e) => {
    // Base position is wherever the cube currently is -- its ice box spot
    // if it hasn't been placed yet, or its cup slot if it has, so grabbing
    // a placed cube picks it up from the cup instead of jumping back to
    // the box.
    const base = icePlaced[index] ? getIceCupSlotPos(index) : ICE_BOX_SPOTS[index];
    e.currentTarget.setPointerCapture(e.pointerId);
    iceDragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      left: base.left,
      top: base.top,
    };
    setIceDrag({ index, left: base.left, top: base.top });
  };

  const handleIcePointerMove = (e) => {
    if (!iceDrag) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - iceDragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - iceDragStartRef.current.pointerY) / rect.height) * 100;
    setIceDrag((prev) => ({
      ...prev,
      left: iceDragStartRef.current.left + dxPct,
      top: iceDragStartRef.current.top + dyPct,
    }));
  };

  const handleIcePointerUp = (e) => {
    if (!iceDrag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (isOverIceBox(iceDrag.left, iceDrag.top)) {
      // Dropped back over the ice box -- unplace it, whether it was placed
      // before or not.
      setIcePlaced((prev) => {
        const next = [...prev];
        next[iceDrag.index] = false;
        return next;
      });
    } else if (isOverCup(iceDrag.left, iceDrag.top, cupSpot)) {
      setIcePlaced((prev) => {
        const next = [...prev];
        next[iceDrag.index] = true;
        return next;
      });
    }
    // Otherwise (dropped somewhere ambiguous) leave placement as it was --
    // the cube just snaps back to wherever it already was once the drag
    // position below is cleared.
    setIceDrag(null);
  };

  // D-pad / keyboard equivalent of dragging a cube: select it, press Enter
  // to toggle it between the ice box and the cup. Placing (box -> cup) only
  // works once the cup is actually on the table, same precondition as the
  // drag-and-drop path; taking it back out (cup -> box) has no
  // precondition.
  const handleIceKeyDown = (index) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    if (icePlaced[index]) {
      e.preventDefault();
      setIcePlaced((prev) => {
        const next = [...prev];
        next[index] = false;
        return next;
      });
      return;
    }
    if (cupSpot !== 'table') return;
    e.preventDefault();
    setIcePlaced((prev) => {
      const next = [...prev];
      next[index] = true;
      return next;
    });
  };

  // ---- Milk/water bottles: pick up, move anywhere, snap back home -------
  const [bottlePositions, setBottlePositions] = useState(BOTTLE_HOME);
  // Which bottle (if any) is being dragged right now, and its live position.
  const [bottleDrag, setBottleDrag] = useState(null); // { key, left, top } | null
  const bottleDragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });

  // ---- Pouring a bottle (or the matcha bowl) into the cup (see the big
  // comment on BOTTLE_HOVER_GAP/getBottleHoverPos above) -------------------
  //   'idle'     -- normal, everything sits wherever it was left, freely
  //                 draggable.
  //   'moving'   -- confirmed (dropped on the cup, or Enter/Space) --
  //                 gliding to the hover-over-cup spot and tilting. No
  //                 longer draggable.
  //   'pouring'  -- arrived; cupMilk/cupMatcha is set (the fill appears) and
  //                 it holds the tilt for BOTTLE_POUR_MS before gliding back
  //                 home and returning to 'idle' on its own -- reusable,
  //                 same as the kettle, not a one-time-use item like the
  //                 matcha spoon.
  // Only one item can be mid-pour at a time (there's only one cup) --
  // pouringKey tracks which one (a milk bottle's key, or 'bowl' for the
  // carried-over matcha), alongside the shared pourStage above.
  const [pourStage, setPourStage] = useState('idle');
  const [pouringKey, setPouringKey] = useState(null); // 'oat' | 'dairy' | 'almond' | 'coconut' | 'bowl' | null
  // The cup's own persistent "has milk been poured in" state -- doesn't
  // reset on its own (only a fresh pour re-sets it), same "second pour just
  // restarts this rather than accumulating a bigger fill" caveat as the
  // matcha bowl's own bowlWater back on MatchaMaking. { type: 'oat' |
  // 'dairy' | 'almond' | 'coconut' } | null -- type picks both the fill
  // color (.cup-milk-fill.<type> in CSS) and which liquid was poured in
  // last (a fresh pour of a different bottle just replaces it, same
  // "doesn't accumulate" simplification).
  const [cupMilk, setCupMilk] = useState(null);
  // Matcha poured on top of the milk -- same shape as cupMilk, just its own
  // state so a fresh milk pour doesn't wipe out matcha already poured (or
  // vice versa). { grade: 'cafe-grade' | 'classic-grade' | 'ceremonial-grade' }
  // | null -- grade picks the fill color (.cup-matcha-fill.<grade> in CSS),
  // carried over from incomingBowl.grade at the moment of the pour.
  const [cupMatcha, setCupMatcha] = useState(null);

  // Preconditions for starting a milk/water pour: cup has to actually be on
  // the table (nothing to pour into otherwise), at least one ice cube
  // already has to be in it, nothing else can already be mid-pour, and the
  // drink can't already be on its way out.
  const canPourMilk =
    cupSpot === 'table' && icePlaced.some(Boolean) && pourStage === 'idle' && cupSendStage === 'idle';
  // Matcha only pours once there's actually a base to pour it onto -- same
  // "pour the topping after the base" ordering the user asked for -- plus
  // the usual cup-on-table/nothing-else-mid-pour preconditions, an actual
  // bowl to pour from, and (same as canPourMilk) the drink not already
  // being sent off.
  const canPourMatcha =
    cupSpot === 'table' && !!cupMilk && pourStage === 'idle' && !!incomingBowl && cupSendStage === 'idle';
  // The cup counts as "finished enough to send" once there's at least a
  // milk/water base in it -- matcha's an optional finishing touch on top,
  // not a requirement, same reasoning canPourMatcha itself already leans
  // on (it only checks cupMilk, not cupMatcha, either).
  const canSendDrink = cupSpot === 'table' && !!cupMilk && pourStage === 'idle' && cupSendStage === 'idle';

  // ---- Falling-liquid pour effect -----------------------------------------
  // Reuses the exact same .spoon-pour/.spoon-pour-grain-N visual machinery
  // MatchaMaking.js built for the falling matcha powder and falling kettle
  // water (that stylesheet is already loaded globally -- see the comment on
  // the carried-over bowl/whisked-liquid images above for why). Anchored to
  // whichever item is currently pouring (pouringKey) at its own current
  // position -- bottlePositions[pouringKey] for a milk bottle, bowlPos for
  // the matcha bowl (during 'moving'/'pouring' that's the hover-over-cup
  // spot getBottleHoverPos put it at, same live-position reasoning as the
  // kettle's own kettlePourLeft/kettlePourTop) rather than a measured spout
  // offset, since there's no pinned spout pixel for either kind of art (see
  // the getBottleHoverPos comment above) -- horizontally centered on the
  // item, vertically from its bottom edge. Falls down to the milk fill's
  // own top edge (cupMilkBox.top) so the stream reads as landing right
  // where the liquid appears, the same "falls to the target fill's top"
  // shape as bowlWaterTop/bowlPowderTop in MatchaMaking.js -- true for the
  // matcha pour too, since it lands on top of the milk fill's own surface
  // regardless of the (shorter) cupMatcha box underneath it. pourSource
  // falls back to null when nothing's pouring -- guarded by pourStage/
  // pouringKey in the JSX below so pourLeft/pourTop/pourHeight are never
  // actually rendered in that state.
  const pourSource =
    pouringKey === 'bowl'
      ? { left: bowlPos.left, top: bowlPos.top, width: incomingBowlWidth, height: incomingBowlHeight }
      : pouringKey
      ? (() => {
          const item = BOTTLE_ITEMS.find((b) => b.key === pouringKey);
          const pos = bottlePositions[pouringKey];
          return { left: pos.left, top: pos.top, width: item.width, height: item.height };
        })()
      : null;
  const pourLeft = pourSource ? pourSource.left + pourSource.width / 2 : 0;
  const pourTop = pourSource ? pourSource.top + pourSource.height : 0;
  const pourHeight = pourSource ? Math.max(cupMilkBox.top - pourTop, 1) : 0;
  const pourColor =
    pouringKey === 'bowl'
      ? SCOOP_FILL_COLORS[incomingBowl?.grade] ?? SCOOP_FILL_COLORS['classic-grade']
      : MILK_STREAM_COLORS[pouringKey] ?? MILK_STREAM_COLORS.oat;

  const beginPour = (key) => {
    if (key === 'bowl') {
      if (!canPourMatcha) return;
      setBowlPos(getBottleHoverPos(CUP_SPOTS.table, TABLE_SIZE, { width: incomingBowlWidth, height: incomingBowlHeight }));
    } else {
      if (!canPourMilk) return;
      const item = BOTTLE_ITEMS.find((b) => b.key === key);
      setBottlePositions((prev) => ({
        ...prev,
        [key]: getBottleHoverPos(CUP_SPOTS.table, TABLE_SIZE, item),
      }));
    }
    setPouringKey(key);
    setPourStage('moving');
  };

  useEffect(() => {
    if (pourStage === 'moving') {
      const t = setTimeout(() => setPourStage('pouring'), BOTTLE_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (pourStage === 'pouring') {
      if (pouringKey === 'bowl') {
        setCupMatcha({ grade: incomingBowl?.grade ?? 'classic-grade' });
      } else {
        setCupMilk({ type: pouringKey });
      }
      const t = setTimeout(() => {
        if (pouringKey === 'bowl') {
          setBowlPos(INCOMING_BOWL_SPOT);
        } else {
          setBottlePositions((prev) => ({ ...prev, [pouringKey]: BOTTLE_HOME[pouringKey] }));
        }
        setPourStage('idle');
        setPouringKey(null);
      }, BOTTLE_POUR_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [pourStage, pouringKey, incomingBowl]);

  // Snapshotting cupMilk/cupMatcha here (rather than letting ToppingsStation
  // read this screen's own state, which won't exist anymore once the player
  // eventually advances away) is what lets that next screen know what the
  // finished drink looked like -- see onSendToToppings (a prop from App.js,
  // which stores it in state and passes it down to ToppingsStation as
  // incomingDrink). Same "fired right away at the moment the item starts
  // its carry, not deferred until the fade finishes" reasoning as
  // MatchaMaking's own beginBowlCarry.
  const beginSendDrink = () => {
    if (!canSendDrink) return;
    onSendToToppings?.({ milk: cupMilk, matcha: cupMatcha });
    setCupSendPos({
      left: SEND_DRINK_ZONE.left + SEND_DRINK_ZONE.width / 2 - TABLE_SIZE.width / 2,
      top: SEND_DRINK_ZONE.top + SEND_DRINK_ZONE.height / 2 - TABLE_SIZE.height / 2,
    });
    setCupSendStage('carrying');
  };

  useEffect(() => {
    if (cupSendStage === 'carrying') {
      const t = setTimeout(() => setCupSendStage('vanishing'), CUP_SEND_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (cupSendStage === 'vanishing') {
      const t = setTimeout(() => setCupSendStage('sent'), CUP_SEND_VANISH_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [cupSendStage]);

  const handleBottlePointerDown = (item) => (e) => {
    const base = bottlePositions[item.key];
    e.currentTarget.setPointerCapture(e.pointerId);
    bottleDragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      left: base.left,
      top: base.top,
    };
    setBottleDrag({ key: item.key, left: base.left, top: base.top });
  };

  const handleBottlePointerMove = (item) => (e) => {
    if (!bottleDrag || bottleDrag.key !== item.key) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - bottleDragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - bottleDragStartRef.current.pointerY) / rect.height) * 100;
    setBottleDrag({
      key: item.key,
      left: clampPct(bottleDragStartRef.current.left + dxPct, item.width),
      top: clampPct(bottleDragStartRef.current.top + dyPct, item.height),
    });
  };

  const handleBottlePointerUp = (item) => (e) => {
    if (!bottleDrag || bottleDrag.key !== item.key) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // Dropping any bottle on the cup (once it's on the table, has ice in
    // it, and nothing else is already mid-pour) starts the pour sequence
    // instead of the ordinary placement below -- same "special-cased drop
    // target" pattern as MatchaMaking's kettle-onto-bowl/whisk-onto-bowl
    // branches.
    if (canPourMilk && isOverCup(bottleDrag.left, bottleDrag.top, cupSpot)) {
      setBottleDrag(null);
      beginPour(item.key);
      return;
    }
    const home = BOTTLE_HOME[item.key];
    const totalMove = Math.max(
      Math.abs(e.clientX - bottleDragStartRef.current.pointerX),
      Math.abs(e.clientY - bottleDragStartRef.current.pointerY)
    );
    const rect = containerRef.current?.getBoundingClientRect();
    const totalMovePct = rect ? (totalMove / Math.max(rect.width, rect.height)) * 100 : 0;
    const snapBack =
      totalMovePct < BOTTLE_CLICK_MAX_MOVE_PCT || // barely moved -- treat as a click, snap home
      (Math.abs(bottleDrag.left - home.left) < item.width * BOTTLE_SNAP_FRACTION &&
        Math.abs(bottleDrag.top - home.top) < item.height * BOTTLE_SNAP_FRACTION);
    setBottlePositions((prev) => ({
      ...prev,
      [item.key]: snapBack ? { left: home.left, top: home.top } : { left: bottleDrag.left, top: bottleDrag.top },
    }));
    setBottleDrag(null);
  };

  // D-pad / keyboard equivalent of a click -- once the pour preconditions
  // are met (see canPourMilk above), Enter pours whichever bottle is
  // focused -- same "no keyboard equivalent of a partial drag, so Enter
  // goes straight to the one meaningful outcome" reasoning as
  // MatchaMaking's handleKettleKeyDown. Otherwise it just snaps the
  // selected bottle straight back to its home spot (there's no keyboard
  // equivalent of "drag it partway").
  const handleBottleKeyDown = (item) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    if (canPourMilk) {
      beginPour(item.key);
      return;
    }
    const home = BOTTLE_HOME[item.key];
    setBottlePositions((prev) => ({ ...prev, [item.key]: { left: home.left, top: home.top } }));
  };

  // ---- Matcha bowl: pick up, pour onto the cup (once there's already a
  // milk/water base), or snap back home -- same shape as the milk bottles'
  // own handlers, just simpler since there's only one bowl and it always
  // returns to the same spot rather than staying wherever it's dropped
  // (see the bowlPos comment above). ------------------------------------
  const handleBowlPointerDown = (e) => {
    const base = bowlPos;
    e.currentTarget.setPointerCapture(e.pointerId);
    bowlDragStartRef.current = { pointerX: e.clientX, pointerY: e.clientY, left: base.left, top: base.top };
    setBowlDrag({ left: base.left, top: base.top });
  };

  const handleBowlPointerMove = (e) => {
    if (!bowlDrag) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - bowlDragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - bowlDragStartRef.current.pointerY) / rect.height) * 100;
    setBowlDrag({
      left: bowlDragStartRef.current.left + dxPct,
      top: bowlDragStartRef.current.top + dyPct,
    });
  };

  const handleBowlPointerUp = (e) => {
    if (!bowlDrag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (canPourMatcha && isOverCup(bowlDrag.left, bowlDrag.top, cupSpot)) {
      setBowlDrag(null);
      beginPour('bowl');
      return;
    }
    // Any other drop (missed the cup, or the pour preconditions aren't met
    // yet) just snaps it back home -- unlike the bottles, there's nowhere
    // else on this counter that makes sense for the bowl to sit.
    setBowlPos(INCOMING_BOWL_SPOT);
    setBowlDrag(null);
  };

  const handleBowlKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    if (!canPourMatcha) return;
    e.preventDefault();
    beginPour('bowl');
  };

  return (
    <div className="milk-selection-container" ref={containerRef}>
      <h1 className="sr-only">Milk Mixing Station</h1>

      <div className="milk-selection-content">
        <img
          src="./MilkMixingStation.png"
          alt="Milk mixing station with sink and cabinet"
          className="milk-selection-art"
        />
        {/* Carried over from Matcha Making's "Make Drink" drop-zone (see
            incomingBowl/INCOMING_BOWL_SPOT above) -- just the bowl and the
            whisked matcha (no whisk, per feedback that carrying the whisk
            over too didn't make sense once it's done its job), reusing
            this screen's own imported copies of MatchaMaking's
            BOWL_INNER_RIM_* positioning math so the whisked-liquid image
            still lines up with the bowl's rim the same way it does there.
            Now interactive -- draggable onto the cup (once it's on the
            table with milk/water already in it) or Enter-to-pour, same
            glide/tilt/pour/glide-home sequence as the milk bottles (see
            beginPour/bowlPos above), just reusing MatchaMaking.css's own
            .station-item.movable classes (drag cursor, focus glow,
            .settling) instead of .milk-bottle's, since this art was sized
            for that screen's own movable-item treatment. .station-item and
            .bowl-whisked-liquid are both defined in MatchaMaking.css, which
            is already loaded globally since MatchaMaking.js is always
            imported by App.js -- reused here rather than duplicated so the
            look can't drift out of sync between the two screens. */}
        {incomingBowl && (
          <>
            <img
              src={incomingBowlItem.src}
              alt="Bowl of whisked matcha. Drag onto the cup to pour it in once there's milk or water in it, or select it and press Enter."
              draggable={false}
              data-focusable
              tabIndex={0}
              className={`station-item movable${bowlDrag ? ' dragging' : ''}${pouringKey === 'bowl' ? ' settling' : ''}`}
              style={{
                left: `${(bowlDrag || bowlPos).left}%`,
                top: `${(bowlDrag || bowlPos).top}%`,
                width: `${incomingBowlWidth}%`,
                height: `${incomingBowlHeight}%`,
                ...(pouringKey === 'bowl' ? { transform: `rotate(${BOTTLE_POUR_ROTATE_DEG}deg)` } : {}),
              }}
              onPointerDown={handleBowlPointerDown}
              onPointerMove={handleBowlPointerMove}
              onPointerUp={handleBowlPointerUp}
              onKeyDown={handleBowlKeyDown}
            />
            <img
              src={WHISKED_LIQUID_IMAGES[incomingBowl.grade] ?? WHISKED_LIQUID_IMAGES['classic-grade']}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="bowl-whisked-liquid"
              style={{
                left: `${incomingRimLeft}%`,
                top: `${incomingRimTop}%`,
                width: `${incomingRimWidth}%`,
                height: `${incomingRimHeight}%`,
                ...(pouringKey === 'bowl' ? { transform: `rotate(${BOTTLE_POUR_ROTATE_DEG}deg)` } : {}),
              }}
            />
          </>
        )}
        {/* Single flat GlassCup.png in both spots -- the back/front
            transparent-sandwich experiment (GlassCupBack.png/
            GlassCupFront.png) is parked for now in favor of a cheaper trick:
            the milk fill (right below) paints UNDERNEATH this image in DOM
            order and is kept fairly translucent, so the glass's own
            outline/highlight linework still reads on top and the liquid
            looks like it's sitting behind/inside the glass rather than
            painted over it, without needing real alpha-channel art.
            Stops rendering entirely once cupSendStage reaches 'sent' (see
            the big comment on that state above) -- same "gone once sent"
            treatment MatchaMaking's own bowl gets. While 'carrying'/
            'vanishing' it's still rendered but pointer-events: none (inline
            -- there's no .glass-cup.settling variant, so this is simpler
            than adding one) so it can't be grabbed mid-transit, and picks
            up .bowl-vanishing (reused from MatchaMaking.css, already
            loaded globally) for the actual shrink/fade once 'vanishing'
            starts. */}
        {cupSendStage !== 'sent' && (
          <img
            src="./GlassCup.png"
            alt={
              cupSpot === 'shelf'
                ? 'Glass cup. Drag from the shelf to the table, or select it and press Enter.'
                : canSendDrink
                ? 'Glass cup with the finished drink. Drag onto the Send Drink zone to send it to Toppings, or select it and press Enter.'
                : 'Glass cup. Drag it back up to the shelf, or select it and press Enter.'
            }
            className={`glass-cup${cupDragPos ? ' dragging' : ''}${
              cupSendStage === 'vanishing' ? ' bowl-vanishing' : ''
            }`}
            data-focusable
            tabIndex={0}
            draggable={false}
            style={{
              left: `${cupRenderPos.left}%`,
              top: `${cupRenderPos.top}%`,
              width: `${cupRenderSize.width}%`,
              height: `${cupRenderSize.height}%`,
              ...(cupSendStage !== 'idle' ? { pointerEvents: 'none' } : {}),
            }}
            onPointerDown={handleCupPointerDown}
            onPointerMove={handleCupPointerMove}
            onPointerUp={handleCupPointerUp}
            onKeyDown={handleCupKeyDown}
          />
        )}
        {ICE_BOX_SPOTS.map((boxSpot, index) => {
          const placed = icePlaced[index];
          // Once the finished drink's fully sent (cupSendStage 'sent'),
          // any cube that was actually placed in the cup goes with it --
          // an unplaced cube still sitting in the box is unaffected.
          if (placed && cupSendStage === 'sent') return null;
          const dragging = iceDrag?.index === index;
          const pos = dragging ? iceDrag : placed ? getIceCupSlotPos(index) : boxSpot;
          const size = placed ? ICE_CUP_SIZE : ICE_BOX_SIZE;
          const leaving = placed && cupSendStage === 'vanishing';
          return (
            <img
              key={index}
              src="./IceCube.png"
              alt={placed ? 'Ice cube in the cup. Drag it back to the ice box, or select it and press Enter.' : 'Ice cube. Drag it into the cup, or select it and press Enter.'}
              className={`ice-cube${dragging ? ' dragging' : ''}${placed ? ' placed' : ''}${
                leaving ? ' bowl-vanishing' : ''
              }`}
              data-focusable
              tabIndex={0}
              draggable={false}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${size.width}%`,
                height: `${size.height}%`,
              }}
              onPointerDown={handleIcePointerDown(index)}
              onPointerMove={handleIcePointerMove}
              onPointerUp={handleIcePointerUp}
              onKeyDown={handleIceKeyDown(index)}
            />
          );
        })}
        {/* The milk fill itself -- see the big comment on CUP_MILK_BOX_FRAC/
            cupMilk above for why this is a plain colored shape rather than
            a swapped-in image. Rendered here, after the ice cubes above, so
            DOM/paint order puts it on top of them -- once there's enough
            milk in the cup the ice should read as submerged/half-hidden in
            the liquid rather than floating on top of it. pointer-events:
            none on .cup-milk-fill (see the CSS) means this doesn't block
            dragging a cube back out even while it's stacked on top
            visually. Only shown while the cup's actually on the table and
            hasn't fully vanished yet -- cupMilk itself doesn't get cleared
            when the cup goes back to the shelf, but there'd be nothing
            sensible to anchor the fill to up there (CUP_MILK_BOX_FRAC is
            only ever computed off CUP_SPOTS.table). Picks up
            .bowl-vanishing the same as the cup image itself while
            cupSendStage is 'vanishing', so the whole drink shrinks/fades as
            one unit rather than the cup disappearing out from under a
            still-solid fill for a frame. */}
        {cupMilk && cupSpot === 'table' && cupSendStage !== 'sent' && (
          <div
            className={`cup-milk-fill ${cupMilk.type}${cupSendStage === 'vanishing' ? ' bowl-vanishing' : ''}`}
            aria-hidden="true"
            style={{
              left: `${cupMilkBox.left}%`,
              top: `${cupMilkBox.top}%`,
              width: `${cupMilkBox.width}%`,
              height: `${cupMilkBox.height}%`,
            }}
          />
        )}
        {/* Matcha poured on top of the milk -- see the big comment on
            CUP_MATCHA_HEIGHT_FRAC/getCupMatchaBox above for the box, and
            cupMatcha above for the state. Rendered right after the milk
            fill so it paints on top of it (same "on top of everything
            underneath" DOM-order reasoning as the milk fill itself), using
            the milk fill's own left/top/width so its taper lines up, just a
            shorter height. Same cupSendStage 'sent'/'vanishing' handling as
            the milk fill above. */}
        {cupMatcha && cupSpot === 'table' && cupSendStage !== 'sent' && (
          <div
            className={`cup-matcha-fill ${cupMatcha.grade}${cupSendStage === 'vanishing' ? ' bowl-vanishing' : ''}`}
            aria-hidden="true"
            style={{
              left: `${cupMatchaBox.left}%`,
              top: `${cupMatchaBox.top}%`,
              width: `${cupMatchaBox.width}%`,
              height: `${cupMatchaBox.height}%`,
            }}
          />
        )}
        {BOTTLE_ITEMS.map((item) => {
          const dragging = bottleDrag?.key === item.key;
          const pos = dragging ? bottleDrag : bottlePositions[item.key];
          // All four bottles share the same pour sequence now -- settling/
          // pouring are both just "is this the one bottle currently mid-
          // pour" (pouringKey), since pourStage only ever tracks one bottle
          // at a time.
          const isPouring = pouringKey === item.key;
          const settling = isPouring;
          const pouring = isPouring;
          return (
            <img
              key={item.key}
              src={item.src}
              alt={`${item.alt}. Drag onto the cup to pour some in once it has ice in it, or select it and press Enter.`}
              className={`milk-bottle${dragging ? ' dragging' : ''}${settling ? ' settling' : ''}`}
              data-focusable
              tabIndex={0}
              draggable={false}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${item.width}%`,
                height: `${item.height}%`,
                ...(pouring ? { transform: `rotate(${BOTTLE_POUR_ROTATE_DEG}deg)` } : {}),
              }}
              onPointerDown={handleBottlePointerDown(item)}
              onPointerMove={handleBottlePointerMove(item)}
              onPointerUp={handleBottlePointerUp(item)}
              onKeyDown={handleBottleKeyDown(item)}
            />
          );
        })}
        {/* Falling-liquid pour effect -- see the big comment on
            pourLeft/pourTop/pourHeight/pourColor above. Reuses
            MatchaMaking.css's .spoon-pour/.spoon-pour-grain-N (its
            z-index: 20 is what keeps it visibly on top of the cup image's
            own drop-shadow stacking context, same reasoning as there).
            Only shown during the actual 'pouring' stage, not 'moving' --
            same as the kettle's falling water only appearing once it's
            arrived and tilted, not while it's still gliding into place. */}
        {pourStage === 'pouring' && pouringKey && (
          <div
            className="spoon-pour"
            style={{
              left: `${pourLeft}%`,
              top: `${pourTop}%`,
              height: `${pourHeight}%`,
            }}
          >
            <span className="spoon-pour-grain spoon-pour-grain-1" style={{ background: pourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-2" style={{ background: pourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-3" style={{ background: pourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-4" style={{ background: pourColor }} />
          </div>
        )}
        {/* "Send to Toppings" drop-zone -- see SEND_DRINK_ZONE/canSendDrink/
            beginSendDrink above, same pattern as MatchaMaking's own "Make
            Drink" zone (reusing its .make-drink-zone class directly, since
            MatchaMaking.css is already loaded globally -- see the comment
            on the carried-over bowl/whisked-liquid images earlier in this
            file for that same reasoning). Appears once there's a base
            poured and disappears the instant the cup actually heads there
            (cupSendStage leaving 'idle'), same beat as the bowl's own zone
            retiring in MatchaMaking.js. Not itself focusable -- it's a drop
            target the *cup* gets dragged onto or sent to via its own Enter
            press (see handleCupPointerUp/handleCupKeyDown above), same
            "the label just marks a zone" pattern as the ice box/cup zones
            elsewhere on this screen. */}
        {canSendDrink && (
          <div
            className="make-drink-zone"
            aria-hidden="true"
            style={{
              left: `${SEND_DRINK_ZONE.left}%`,
              top: `${SEND_DRINK_ZONE.top}%`,
              width: `${SEND_DRINK_ZONE.width}%`,
              height: `${SEND_DRINK_ZONE.height}%`,
            }}
          >
            Send to Toppings
          </div>
        )}

        <OrderReceiptButton order={order} />
        <ProgressBar
          activeStep={activeStep}
          customerNumber={customerNumber}
          onNavigate={onNavigate}
          onAdvance={onAdvance}
          // Final highlight beat for this station: once the drink's fully
          // sent off (cupSendStage 'sent'), there's nothing left to do here,
          // so the current-step dot flashes as the "ok to move on" signal --
          // same opt-in highlightCurrentStep/currentStepHint props
          // MatchaMaking uses for its own matching beat.
          highlightCurrentStep={cupSendStage === 'sent'}
          currentStepHint="Use your right arrow key to move on to the toppings station."
        />
      </div>
    </div>
  );
};

export default MilkSelection;
