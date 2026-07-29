import React, { useEffect, useRef, useState } from 'react';
import './ToppingsStation.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { getActionFromKeyEvent, shouldDebounceEnter } from '../gameloop/pal';
import ProgressBar from './ProgressBar';
import OrderReceiptButton from './OrderReceiptButton';
import { getMilkBoxFor, getMatchaBoxFor, TABLE_SIZE } from './MilkSelection';
import { WHISK_FLIP_DEG } from './MatchaMaking';

// Where the finished cup (see incomingDrink below) sent over from Milk
// Selection's own "Send to Toppings" drop-zone comes to rest on this
// screen -- purely decorative (not draggable/focusable, same treatment
// the carried-over bowl first got on Milk Selection before that became
// interactive). Same size it displayed at over there (TABLE_SIZE,
// imported directly rather than guessing a scaled-down copy), centered in
// the middle of the frame -- left/top are just 50% minus half the box's
// own width/height, which works out independently on each axis even
// though the container itself isn't square (percentages here are already
// relative to the container's own width/height respectively, same as
// every other box in this file).
const INCOMING_DRINK_SIZE = TABLE_SIZE;
const INCOMING_DRINK_SPOT = {
  left: 50 - INCOMING_DRINK_SIZE.width / 2,
  top: 50 - INCOMING_DRINK_SIZE.height / 2,
};

// Background swapped from the old baked-in-items ToppingsStation.png to
// MatchaBaseStation.png (the same empty-counter art the Matcha Making
// station uses) -- per request, now that the six topping items below have
// been separated out into their own PNGs and are placed on top instead of
// being baked into the background art itself.
const TOPPINGS_BACKGROUND_SRC = './MatchaBaseStation.png';

// The six topping items, one pre-made PNG each -- canvasAspect is each
// source image's own width/height (measured directly off the file), used
// below to derive each item's on-screen width from a shared height while
// keeping its own true aspect ratio, same approach as
// BOTTLE_CANVAS_ASPECT/BOTTLE_WIDTH in MilkSelection.js.
//
// The two powders are paired together (matcha-powder, then guava-powder to
// its right, per request), sitting at the right edge down on the
// counter-line baseline ("on the table") -- see TOPPING_ROW_BOTTOM/
// POWDER_HEIGHT below. canvasAspect values below were
// re-measured after the source PNGs were re-exported with the excess
// transparent padding on one side trimmed off (281x425 and 279x420 now,
// were 469x532/466x536) -- likely why the pair wasn't reading as tight as
// the other two even at the same gap value: a wide transparent margin
// baked into the old canvas meant the visible artwork sat well short of
// the box's actual edge, so PAIR_GAP/TIGHT_PAIR_GAP were measuring gaps
// between boxes, not between the actual visible powder art.
const GUAVA_POWDER_ITEM = { key: 'guava-powder', src: './GuavaPowder.png', alt: 'Guava powder', canvasAspect: 281 / 425 };
const MATCHA_POWDER_ITEM = {
  key: 'matcha-powder',
  src: './MatchaPowder.png',
  alt: 'Matcha powder',
  canvasAspect: 279 / 420,
};
// canvasAspect values re-measured after these four were also re-exported
// with their own excess transparent padding trimmed (139x264, 140x269,
// 155x297, 151x290 now -- all were 193-wide before).
const SYRUP_PAIR = [
  { key: 'guava-syrup', src: './GuavaSyrup.png', alt: 'Guava syrup', canvasAspect: 139 / 264 },
  { key: 'mint-syrup', src: './MintSyrup.png', alt: 'Mint syrup', canvasAspect: 140 / 269 },
];
const FOAM_PAIR = [
  { key: 'matcha-cold-foam', src: './MatchaColdFoam.png', alt: 'Matcha cold foam', canvasAspect: 155 / 297 },
  { key: 'reg-cold-foam', src: './RegColdFoam.png', alt: 'Regular cold foam', canvasAspect: 151 / 290 },
];
// The same two item objects laid out at the top of the file (matcha-powder/
// guava-powder), just grouped the same "pair" way as SYRUP_PAIR/FOAM_PAIR
// above so the pour-mechanic code below can filter/iterate them the same
// way (layoutPair itself is still called with [MATCHA_POWDER_ITEM,
// GUAVA_POWDER_ITEM] directly below, in TOPPING_ITEMS -- this is just an
// alias for the interactive-rendering code further down).
const POWDER_PAIR = [MATCHA_POWDER_ITEM, GUAVA_POWDER_ITEM];

// Eyeballed starting guess (no reference for where these six should sit on
// the reused matcha-counter background) -- the powder pair (matcha-powder,
// then guava-powder to its right) sits at the right edge down on the
// counter-line baseline (TOPPING_ROW_BOTTOM, "on the table" per request),
// and the syrup pair (guava-syrup, then mint-syrup) and foam pair
// (matcha-cold-foam, then reg-cold-foam) are stacked vertically at the
// left edge -- syrups on top, foams directly below them, both sharing the
// same left-edge anchor so the column lines up. The powder pair is
// noticeably smaller than the syrup/foam pairs (POWDER_HEIGHT vs
// TOPPING_HEIGHT). Every width is derived from height * canvasAspect *
// (9/16) -- the (9/16) corrects for the container being a fixed 1920x1080
// (16:9, not square), so a % height and a % width of the same pixel size
// aren't numerically equal -- see BOTTLE_WIDTH's own comment in
// MilkSelection.js for the identical reasoning. Very likely needs real
// tuning once actually seen against the live render.
const TOPPING_HEIGHT = 30; // syrup/foam pair height
const POWDER_HEIGHT = TOPPING_HEIGHT * 0.7; // smaller than the syrup/foam pairs
const TOPPING_ROW_BOTTOM = 45; // the powder pair's bottom edge lands here -- raised up from the table line (was 64, then 58, 50, 47), per request
const EDGE_MARGIN = 5; // gap from the left/right edges of the frame
// The powder pair sits VERY close together internally -- much tighter than
// PAIR_GAP. FOAM_PAIR's spacing was already confirmed good, so it keeps
// the wider PAIR_GAP.
const TIGHT_PAIR_GAP = 0.15;
// The syrup pair needs to be even closer together than TIGHT_PAIR_GAP, per
// request -- tightened further still (was 0.05) per a later request to
// move guava-syrup and mint-syrup closer to each other.
const SYRUP_PAIR_GAP = 0.02;
const PAIR_GAP = 0.6;
// Syrup pair's top -- shifted down slightly from the very top edge (was
// CORNER_PAIR_TOP-style 6), per request.
const SYRUP_TOP = 12;
// Foam pair sits directly below the syrup pair -- its own height plus a
// small vertical gap below SYRUP_TOP.
const STACK_GAP = 3;
const FOAM_TOP = SYRUP_TOP + TOPPING_HEIGHT + STACK_GAP;

// Lays out one pair as two boxes `gap` apart at a shared height/top,
// anchored either to a left edge, a right edge, or horizontally centered
// on a point -- anchor is { type: 'left' | 'right' | 'center', x }.
function layoutPair(pair, height, top, gap, anchor) {
  const widths = pair.map((item) => height * item.canvasAspect * (9 / 16));
  const totalWidth = widths[0] + gap + widths[1];
  let startLeft;
  if (anchor.type === 'left') {
    startLeft = anchor.x;
  } else if (anchor.type === 'right') {
    startLeft = anchor.x - totalWidth;
  } else {
    startLeft = anchor.x - totalWidth / 2;
  }
  const lefts = [startLeft, startLeft + widths[0] + gap];
  return pair.map((item, index) => ({
    key: item.key,
    src: item.src,
    alt: item.alt,
    left: lefts[index],
    top,
    width: widths[index],
    height,
  }));
}

const TOPPING_ITEMS = [
  // matcha-powder first, guava-powder to its right -- smaller (POWDER_
  // HEIGHT), tight (TIGHT_PAIR_GAP), now down on the table baseline at the
  // right edge instead of up in the corner.
  ...layoutPair([MATCHA_POWDER_ITEM, GUAVA_POWDER_ITEM], POWDER_HEIGHT, TOPPING_ROW_BOTTOM - POWDER_HEIGHT, TIGHT_PAIR_GAP, {
    type: 'right',
    x: 100 - EDGE_MARGIN,
  }),
  // guava-syrup first, mint-syrup to its right -- upper-left corner,
  // shifted down slightly (SYRUP_TOP) and even tighter (SYRUP_PAIR_GAP).
  ...layoutPair(SYRUP_PAIR, TOPPING_HEIGHT, SYRUP_TOP, SYRUP_PAIR_GAP, {
    type: 'left',
    x: EDGE_MARGIN,
  }),
  // matcha-cold-foam first, reg-cold-foam to its right -- directly below
  // the syrup pair (same left-edge anchor), stacked at FOAM_TOP.
  ...layoutPair(FOAM_PAIR, TOPPING_HEIGHT, FOAM_TOP, PAIR_GAP, {
    type: 'left',
    x: EDGE_MARGIN,
  }),
];

// ---- Pouring a syrup onto the carried-over drink -------------------------
// Same overall shape as Milk Selection's bottle-pour sequence (glide to a
// hover spot above the cup, "pour", glide back home), with two differences
// specific to syrup: the bottle does a full 180deg flip (reusing
// MatchaMaking's own WHISK_FLIP_DEG -- a syrup bottle tips all the way
// upside-down to pour, not a partial tilt like the milk bottles) rather
// than staying upright, and while it's flipped the player can nudge it
// left/right (see the pourOffset state and its own capture-phase keydown
// effect in the component below) to aim the stream, purely for feel -- it
// doesn't change where the syrup ends up (see .cup-syrup-fill below,
// always anchored to the same spot regardless of aim).
//
// The two syrups sink to the BOTTOM of the drink rather than sitting on
// top (matcha's own spot) -- .cup-syrup-fill (ToppingsStation.css) is a
// gradient solid at the very bottom, fading to transparent as it rises,
// same "blend into what's already there" idea as .cup-matcha-fill but
// upside-down and anchored to the milk box's own bottom edge instead of
// its top.
const SYRUP_HOVER_GAP = 2; // % gap between the bottle's bottom edge and the cup's rim while hovering
function getSyrupHoverPos(item) {
  return {
    left: INCOMING_DRINK_SPOT.left + INCOMING_DRINK_SIZE.width / 2 - item.width / 2,
    top: INCOMING_DRINK_SPOT.top - item.height - SYRUP_HOVER_GAP,
  };
}

// Generous hit-test box for "was the bottle dropped on the cup", same
// margin-based approach as Milk Selection's own isOverCup.
function isOverIncomingCup(leftPct, topPct) {
  const margin = 3;
  return (
    leftPct >= INCOMING_DRINK_SPOT.left - margin &&
    leftPct <= INCOMING_DRINK_SPOT.left + INCOMING_DRINK_SIZE.width + margin &&
    topPct >= INCOMING_DRINK_SPOT.top - margin &&
    topPct <= INCOMING_DRINK_SPOT.top + INCOMING_DRINK_SIZE.height + margin
  );
}

const SYRUP_MOVE_MS = 350; // time to glide to the hover spot
const SYRUP_POUR_MS = 2200; // how long 'pouring' holds (long enough to actually use the left/right aim) before gliding back home
const SYRUP_MOVE_STEP = 2; // % nudge per Left/Right press while pouring
const SYRUP_MOVE_RANGE = 8; // max % the bottle (and stream) can be nudged off-center in either direction
const SYRUP_SNAP_FRACTION = 0.5; // same "drop close to home, it snaps the rest of the way" idea as Milk Selection's BOTTLE_SNAP_FRACTION
const SYRUP_CLICK_MAX_MOVE_PCT = 1; // below this much movement, a pointer-down -> up is a click, not a drag

// Colors for the falling syrup stream -- reused directly (no extra alpha
// adjustment) for .cup-syrup-fill's own gradient solid-color stop too,
// same "one palette, one source of truth" idea as MatchaMaking's
// SCOOP_FILL_COLORS/scoopColor.
const SYRUP_STREAM_COLORS = {
  'guava-syrup': 'rgba(224, 90, 111, 0.92)',
  'mint-syrup': 'rgba(101, 196, 155, 0.9)',
};

// The bottom portion of the milk box's own shape (see getMilkBoxFor in
// MilkSelection.js) -- covers the bottom SYRUP_HEIGHT_FRAC of it, anchored
// to the milk box's actual bottom edge (there's no "raise" zone the way
// matcha has one, since syrup doesn't need to raise the drink's overall
// fill line, just tint the bottom of what's already there).
const SYRUP_HEIGHT_FRAC = 0.4;
function getSyrupBoxFor(milkBox) {
  const height = milkBox.height * SYRUP_HEIGHT_FRAC;
  return {
    left: milkBox.left,
    top: milkBox.top + milkBox.height - height,
    width: milkBox.width,
    height,
  };
}

// ---- Pouring a cold foam onto the carried-over drink ---------------------
// Same select/drag-onto-cup-or-Enter, 180deg-flip (WHISK_FLIP_DEG), and
// Left/Right-aim-while-pouring mechanic as the syrup pair above (see the
// big comment on SYRUP_HOVER_GAP/getSyrupHoverPos for the reasoning behind
// each piece) -- the one real difference is where the poured layer ends up:
// foam floats on TOP of whatever's already in the cup (the matcha layer if
// one was poured, otherwise straight onto the milk) rather than sinking to
// the bottom the way syrup does. That "on top" box is getFoamBoxFor (below)
// applied to whichever box is currently the drink's own top layer -- its
// own box math, not MilkSelection.js's getMatchaBoxFor, and its own CSS
// shape too (.cup-foam-fill in ToppingsStation.css) rather than reusing
// .cup-matcha-fill, since per request foam's top corners are rounded
// (border-radius) instead of the pointed glass-taper meniscus matcha uses.
// A second element, the "cap" (getFoamCapBoxFor/.cup-foam-cap below),
// straddles the very top edge of that body as a flattened ellipse in the
// same color -- meant to read as the flat top surface of the poured foam,
// like you're looking slightly down into the glass, so the drink reads as
// filled right up rather than the body's own rounded-but-still-a-bit-
// pointy top edge doing all the work on its own.
const FOAM_RAISE_FRAC = 0.42; // portion of the layer-below's own height that foam rises above it -- raised further (was 0.3) to shift the whole layer up, per request
const FOAM_OVERLAP_FRAC = 0.02; // portion that dips into the layer below -- cut down alongside the raise increase above so the total height (and how far it actually reaches back down into the drink) stays about the same as before, i.e. this is a shift, not a stretch
const FOAM_WIDTH_SCALE = 1.08; // a touch wider than the layer below, to line up with the matcha layer's own raised-top width

// Same "generic, parameterized on the box underneath" shape as
// MilkSelection.js's own getMatchaBoxFor, just with foam's own (shallower,
// wider, higher-up) fractions above instead of matcha's.
function getFoamBoxFor(topBox) {
  const raise = topBox.height * FOAM_RAISE_FRAC;
  const overlap = topBox.height * FOAM_OVERLAP_FRAC;
  const width = topBox.width * FOAM_WIDTH_SCALE;
  return {
    left: topBox.left - (width - topBox.width) / 2,
    top: topBox.top - raise,
    width,
    height: raise + overlap,
  };
}

// The flattened top-surface ellipse ("cap") that straddles the foam body's
// own top edge -- a plain circle (border-radius: 50% in CSS) squashed down
// to a shallow oval via its own height, same idea as looking down at a
// disc from a shallow angle. FOAM_CAP_ASPECT is the ellipse's intended
// on-screen height:width ratio; since this container is a fixed 16:9 (not
// square), a % width and a % height of the same on-screen pixel size
// aren't numerically equal -- multiplying by (16/9) is the same correction
// layoutPair's own widths (`height * canvasAspect * (9/16)`) make in the
// opposite direction, see its own comment above TOPPING_HEIGHT.
const FOAM_CAP_ASPECT = 0.3;
function getFoamCapBoxFor(foamBox) {
  const width = foamBox.width;
  const height = width * FOAM_CAP_ASPECT * (16 / 9);
  return {
    left: foamBox.left,
    top: foamBox.top - height / 2,
    width,
    height,
  };
}

const FOAM_HOVER_GAP = 2; // % gap between the bottle's bottom edge and the cup's rim while hovering
function getFoamHoverPos(item) {
  return {
    left: INCOMING_DRINK_SPOT.left + INCOMING_DRINK_SIZE.width / 2 - item.width / 2,
    top: INCOMING_DRINK_SPOT.top - item.height - FOAM_HOVER_GAP,
  };
}

const FOAM_MOVE_MS = 350;
const FOAM_POUR_MS = 2200;
const FOAM_MOVE_STEP = 2;
const FOAM_MOVE_RANGE = 8;
const FOAM_SNAP_FRACTION = 0.5;
const FOAM_CLICK_MAX_MOVE_PCT = 1;

// Colors for the falling foam stream -- reused directly for the
// .cup-foam-fill/.cup-foam-cap color modifier classes too (see
// ToppingsStation.css), same "one palette, one source of truth" idea as
// SYRUP_STREAM_COLORS. Sampled from each PNG's own average opaque pixel
// color (MatchaColdFoam.png -> pale sage green, RegColdFoam.png -> creamy
// white) so the poured fill reads as the same substance as its bottle art.
const FOAM_STREAM_COLORS = {
  'matcha-cold-foam': 'rgba(200, 213, 171, 0.95)',
  'reg-cold-foam': 'rgba(234, 232, 227, 0.95)',
};

// ---- Pouring matcha-powder/guava-powder onto the carried-over drink -----
// Same select/drag-onto-cup-or-Enter, 180deg-flip (WHISK_FLIP_DEG), and
// Left/Right-aim-while-pouring mechanic as the syrup/foam pairs above (see
// the big comment on SYRUP_HOVER_GAP/getSyrupHoverPos for the reasoning
// behind each piece). Two things are different about powder specifically:
//   - The falling stream is rendered as small falling particles --
//     MatchaMaking.css's own .spoon-pour-grain circles (reused directly,
//     same markup/classes the syrup/foam streams below already use) ARE
//     already small round dots, which happens to be exactly the "small
//     particles" look powder needs, so no new stream visual is needed,
//     just powder's own colors (POWDER_STREAM_COLORS below).
//   - Where it settles depends on what's already in the cup: cold foam
//     holds a light dusting on ITS OWN surface rather than letting powder
//     sink in, so if cupFoam is set the powder settles as a scatter of
//     small flecks within the foam's own top ellipse (getFoamCapBoxFor's
//     box, from the foam section above). With no foam to catch it, powder
//     has nothing to sit on top of, so it's shown scattered throughout the
//     whole visible liquid column instead (getPowderLiquidBoxFor below).
//     Either way it's rendered as a fixed cluster of small dots
//     (POWDER_FLECK_OFFSETS_ELLIPSE/_LIQUID + getFleckPositions below),
//     not a smooth gradient fill like the other toppings, since a
//     sprinkled powder reads as distinct specks rather than a solid layer.
const POWDER_HOVER_GAP = 2; // % gap between the tin's bottom edge and the cup's rim while hovering
function getPowderHoverPos(item) {
  return {
    left: INCOMING_DRINK_SPOT.left + INCOMING_DRINK_SIZE.width / 2 - item.width / 2,
    top: INCOMING_DRINK_SPOT.top - item.height - POWDER_HOVER_GAP,
  };
}

const POWDER_MOVE_MS = 350;
const POWDER_POUR_MS = 2200;
const POWDER_MOVE_STEP = 2;
const POWDER_MOVE_RANGE = 8;
const POWDER_SNAP_FRACTION = 0.5;
const POWDER_CLICK_MAX_MOVE_PCT = 1;

// Colors for the falling powder stream and the settled flecks alike (see
// .cup-powder-fleck in ToppingsStation.css), same "one palette, one source
// of truth" idea as SYRUP_STREAM_COLORS/FOAM_STREAM_COLORS. matcha-powder
// reuses the same green family as the matcha grades/matcha-cold-foam;
// there's no reference for guava powder's own real color, so this reuses
// guava syrup's own pink-red hue family (same fruit) at a slightly
// lighter/drier-looking shade appropriate for a powder rather than a
// syrup.
const POWDER_STREAM_COLORS = {
  'matcha-powder': 'rgba(139, 165, 94, 0.95)',
  'guava-powder': 'rgba(232, 137, 122, 0.95)',
};

// Fixed (not Math.random()) sets of normalized offsets (dx/dy in
// [-0.5, 0.5], relative to whatever box getFleckPositions maps them onto)
// for the small dots powder settles into -- fixed rather than randomized
// so the layout doesn't reshuffle on every re-render, same "deterministic
// stagger" reasoning as the four .spoon-pour-grain-N falling particles'
// own fixed left/delay values. Two different sets since the two landing
// spots are different shapes: _ELLIPSE's points all sit within the unit
// circle (roughly dx^2+dy^2 < 0.16) so they land inside the foam cap's
// own visual ellipse rather than drifting into its bounding box's square
// corners (which would sit outside the visible ellipse); _LIQUID's points
// spread across the fuller rectangle instead (with a little margin so none
// sit right at the tapered glass walls), since with no foam to catch it
// the powder scatters through the whole liquid rather than pooling into
// one shape.
const POWDER_FLECK_OFFSETS_ELLIPSE = [
  { dx: 0, dy: 0 },
  { dx: -0.28, dy: -0.05 },
  { dx: 0.3, dy: 0.02 },
  { dx: -0.15, dy: 0.22 },
  { dx: 0.17, dy: -0.2 },
  { dx: -0.05, dy: -0.28 },
  { dx: 0.08, dy: 0.28 },
  { dx: -0.32, dy: 0.12 },
];
const POWDER_FLECK_OFFSETS_LIQUID = [
  { dx: -0.3, dy: -0.38 },
  { dx: 0.25, dy: -0.3 },
  { dx: -0.1, dy: -0.15 },
  { dx: 0.32, dy: -0.05 },
  { dx: -0.35, dy: 0.05 },
  { dx: 0.05, dy: 0.1 },
  { dx: -0.2, dy: 0.25 },
  { dx: 0.28, dy: 0.3 },
  { dx: 0.02, dy: 0.38 },
  { dx: -0.3, dy: 0.4 },
];

// Maps a set of normalized offsets onto an actual box, in the same
// percent-of-container units every other box in this file uses.
function getFleckPositions(box, offsets) {
  return offsets.map(({ dx, dy }) => ({
    left: box.left + box.width * (0.5 + dx),
    top: box.top + box.height * (0.5 + dy),
  }));
}

// The full visible liquid column -- from the matcha/milk layer's own
// topmost point (topBox, same "whichever's currently on top" box the foam
// section above uses) down to the milk box's own bottom edge. Used only
// for powder's "no foam to catch it" scatter case: incomingTopBox alone
// isn't tall enough for this, since it only spans the raised/blended zone
// at the very top of the drink, not all the way down to the cup's own
// bottom.
function getPowderLiquidBoxFor(topBox, milkBox) {
  return {
    left: milkBox.left,
    top: topBox.top,
    width: milkBox.width,
    height: milkBox.top + milkBox.height - topBox.top,
  };
}

const ToppingsStation = ({ activeStep, customerNumber, onNavigate, onAdvance, order, incomingDrink }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  // ---- Carried-over cup from Milk Selection (see incomingDrink above) ----
  // The finished cup (glass + milk/water fill + optional matcha fill),
  // sent over from that screen's own "Send to Toppings" drop-zone. Reuses
  // MilkSelection.css's own .cup-milk-fill/.cup-matcha-fill classes and
  // their clip-path/gradient work directly (that stylesheet is already
  // loaded globally since MilkSelection.js is always imported by App.js --
  // same reasoning MilkSelection itself uses for MatchaMaking's classes)
  // rather than re-deriving the glass's own taper shape a third time.
  // getMilkBoxFor/getMatchaBoxFor (imported from MilkSelection.js) are the
  // same box math that screen uses for its own cup, just computed against
  // this screen's own INCOMING_DRINK_SPOT/INCOMING_DRINK_SIZE instead of
  // CUP_SPOTS.table/TABLE_SIZE.
  const incomingMilkBox = incomingDrink?.milk ? getMilkBoxFor(INCOMING_DRINK_SPOT, INCOMING_DRINK_SIZE) : null;
  const incomingMatchaBox = incomingDrink?.matcha && incomingMilkBox ? getMatchaBoxFor(incomingMilkBox) : null;
  const incomingSyrupBox = incomingMilkBox ? getSyrupBoxFor(incomingMilkBox) : null;
  // Foam always lands on whatever the drink's current top layer is -- the
  // matcha layer if one was poured, otherwise straight onto the milk. See
  // getFoamBoxFor (above FOAM_HOVER_GAP) for its own box math -- a
  // shallower, narrower-overlap variant of getMatchaBoxFor's shape, plus a
  // touch of extra width, per request.
  const incomingTopBox = incomingMatchaBox || incomingMilkBox;
  const incomingFoamBox = incomingTopBox ? getFoamBoxFor(incomingTopBox) : null;
  // The flattened top-surface ellipse straddling incomingFoamBox's own top
  // edge -- see getFoamCapBoxFor above.
  const incomingFoamCapBox = incomingFoamBox ? getFoamCapBoxFor(incomingFoamBox) : null;
  // The whole visible liquid column -- only used for powder's own "no foam
  // to catch it" scatter case, see getPowderLiquidBoxFor above.
  const incomingPowderLiquidBox =
    incomingTopBox && incomingMilkBox ? getPowderLiquidBoxFor(incomingTopBox, incomingMilkBox) : null;

  // ---- Guava/mint syrup: pick up, pour onto the drink, or snap back home -
  // Same drag/Enter-to-pour shape as Milk Selection's own milk bottles --
  // see the big comment on SYRUP_HOVER_GAP/getSyrupHoverPos above for what's
  // different about syrup specifically (the flip, the aim, the bottom-of-
  // the-cup landing spot).
  const [syrupPositions, setSyrupPositions] = useState(() => {
    const positions = {};
    for (const item of TOPPING_ITEMS) {
      if (item.key === 'guava-syrup' || item.key === 'mint-syrup') {
        positions[item.key] = { left: item.left, top: item.top };
      }
    }
    return positions;
  });
  const [syrupDrag, setSyrupDrag] = useState(null); // { key, left, top } | null
  const syrupDragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });

  //   'idle'     -- normal, whichever syrup sits wherever it was left, freely
  //                 draggable.
  //   'moving'   -- confirmed (dropped on the cup, or Enter/Space) -- gliding
  //                 to the hover-over-cup spot and flipping upside-down.
  //   'pouring'  -- arrived; cupSyrup is set (the fill appears) and it holds
  //                 the flip for SYRUP_POUR_MS -- during which Left/Right
  //                 nudges pourOffset (see the effect below) -- before
  //                 gliding back home and returning to 'idle' on its own,
  //                 same reusable-not-one-time-use item as the milk bottles.
  const [pourStage, setPourStage] = useState('idle');
  const [pouringKey, setPouringKey] = useState(null); // 'guava-syrup' | 'mint-syrup' | null
  // Horizontal nudge (see SYRUP_MOVE_STEP/SYRUP_MOVE_RANGE above), reset to
  // 0 at the start of every pour. Purely cosmetic -- see the big comment on
  // getSyrupBoxFor above for why it doesn't move where the syrup actually
  // lands.
  const [pourOffset, setPourOffset] = useState(0);
  // The drink's own persistent "has syrup been poured in" state -- doesn't
  // reset on its own (only a fresh pour re-sets it), same "second pour just
  // restarts this rather than accumulating" caveat as Milk Selection's
  // cupMilk/cupMatcha. { key: 'guava-syrup' | 'mint-syrup' } | null.
  const [cupSyrup, setCupSyrup] = useState(null);

  // ---- Matcha-cold-foam/reg-cold-foam: pick up, pour on top of the drink,
  // or snap back home -- identical shape to the syrup state just above, see
  // the big comment above FOAM_HOVER_GAP for what's actually different
  // about foam (lands on TOP of the drink instead of sinking to the
  // bottom).
  const [foamPositions, setFoamPositions] = useState(() => {
    const positions = {};
    for (const item of TOPPING_ITEMS) {
      if (item.key === 'matcha-cold-foam' || item.key === 'reg-cold-foam') {
        positions[item.key] = { left: item.left, top: item.top };
      }
    }
    return positions;
  });
  const [foamDrag, setFoamDrag] = useState(null); // { key, left, top } | null
  const foamDragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });
  const [foamPourStage, setFoamPourStage] = useState('idle'); // 'idle' | 'moving' | 'pouring'
  const [foamPouringKey, setFoamPouringKey] = useState(null); // 'matcha-cold-foam' | 'reg-cold-foam' | null
  const [foamPourOffset, setFoamPourOffset] = useState(0);
  const [cupFoam, setCupFoam] = useState(null); // { key } | null

  // ---- Matcha-powder/guava-powder: pick up, pour on top of the drink, or
  // snap back home -- identical shape to the syrup/foam state above, see
  // the big comment above POWDER_HOVER_GAP for what's different about
  // powder itself (particle stream, and where it settles depending on
  // whether foam's already in the cup).
  const [powderPositions, setPowderPositions] = useState(() => {
    const positions = {};
    for (const item of TOPPING_ITEMS) {
      if (item.key === 'matcha-powder' || item.key === 'guava-powder') {
        positions[item.key] = { left: item.left, top: item.top };
      }
    }
    return positions;
  });
  const [powderDrag, setPowderDrag] = useState(null); // { key, left, top } | null
  const powderDragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });
  const [powderPourStage, setPowderPourStage] = useState('idle'); // 'idle' | 'moving' | 'pouring'
  const [powderPouringKey, setPowderPouringKey] = useState(null); // 'matcha-powder' | 'guava-powder' | null
  const [powderPourOffset, setPowderPourOffset] = useState(0);
  const [cupPowder, setCupPowder] = useState(null); // { key } | null

  // Only needs an actual drink to pour onto and nothing else already
  // mid-pour -- unlike Milk Selection's own bottles/bowl there's no ice/
  // base precondition here, since the drink arriving from that screen is
  // already whatever it's going to be by the time it gets here. Also gated
  // on the OTHER toppings' own stages so only one bottle is ever mid-pour
  // at a time -- otherwise two simultaneous capture-phase Left/Right aim
  // listeners (any two of syrup's/foam's/powder's, see the effects below)
  // would both fire off a single keypress.
  const canPourSyrup =
    !!incomingDrink && pourStage === 'idle' && foamPourStage === 'idle' && powderPourStage === 'idle';
  const canPourFoam =
    !!incomingDrink && foamPourStage === 'idle' && pourStage === 'idle' && powderPourStage === 'idle';
  const canPourPowder =
    !!incomingDrink && powderPourStage === 'idle' && pourStage === 'idle' && foamPourStage === 'idle';

  const beginSyrupPour = (key) => {
    if (!canPourSyrup) return;
    const item = TOPPING_ITEMS.find((i) => i.key === key);
    setSyrupPositions((prev) => ({ ...prev, [key]: getSyrupHoverPos(item) }));
    setPourOffset(0);
    setPouringKey(key);
    setPourStage('moving');
  };

  useEffect(() => {
    if (pourStage === 'moving') {
      const t = setTimeout(() => setPourStage('pouring'), SYRUP_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (pourStage === 'pouring') {
      setCupSyrup({ key: pouringKey });
      const t = setTimeout(() => {
        const home = TOPPING_ITEMS.find((i) => i.key === pouringKey);
        setSyrupPositions((prev) => ({ ...prev, [pouringKey]: { left: home.left, top: home.top } }));
        setPourStage('idle');
        setPouringKey(null);
        setPourOffset(0);
      }, SYRUP_POUR_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [pourStage, pouringKey]);

  // Left/Right aim while pouring -- a capture-phase window listener (rather
  // than a plain onKeyDown on the bottle) so it runs and can
  // stopImmediatePropagation() BEFORE useFlatFocusNav's own bubble-phase
  // window listener gets a chance to treat Left/Right as "move focus to the
  // nearest focusable element" instead -- that hook attaches its listener
  // unconditionally at mount (bubble phase, the default), so without this
  // capture-phase intercept every Left/Right press during a pour would just
  // shift keyboard focus around the screen rather than nudging the stream.
  // Only attached while an actual syrup pour is in progress, and removed
  // the instant it isn't, so ordinary D-pad navigation is completely
  // unaffected the rest of the time.
  useEffect(() => {
    if (pourStage !== 'pouring' || !pouringKey) return undefined;
    const handleAimKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Left' && action !== 'Right') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPourOffset((prev) => {
        const next = prev + (action === 'Right' ? SYRUP_MOVE_STEP : -SYRUP_MOVE_STEP);
        return Math.min(SYRUP_MOVE_RANGE, Math.max(-SYRUP_MOVE_RANGE, next));
      });
    };
    window.addEventListener('keydown', handleAimKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleAimKeyDown, { capture: true });
  }, [pourStage, pouringKey]);

  const handleSyrupPointerDown = (item) => (e) => {
    if (pouringKey === item.key) return; // can't re-grab mid-pour
    const base = syrupPositions[item.key];
    e.currentTarget.setPointerCapture(e.pointerId);
    syrupDragStartRef.current = { pointerX: e.clientX, pointerY: e.clientY, left: base.left, top: base.top };
    setSyrupDrag({ key: item.key, left: base.left, top: base.top });
  };

  const handleSyrupPointerMove = (item) => (e) => {
    if (!syrupDrag || syrupDrag.key !== item.key) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - syrupDragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - syrupDragStartRef.current.pointerY) / rect.height) * 100;
    setSyrupDrag({
      key: item.key,
      left: syrupDragStartRef.current.left + dxPct,
      top: syrupDragStartRef.current.top + dyPct,
    });
  };

  const handleSyrupPointerUp = (item) => (e) => {
    if (!syrupDrag || syrupDrag.key !== item.key) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (canPourSyrup && isOverIncomingCup(syrupDrag.left, syrupDrag.top)) {
      setSyrupDrag(null);
      beginSyrupPour(item.key);
      return;
    }
    const home = { left: item.left, top: item.top };
    const totalMove = Math.max(
      Math.abs(e.clientX - syrupDragStartRef.current.pointerX),
      Math.abs(e.clientY - syrupDragStartRef.current.pointerY)
    );
    const rect = containerRef.current?.getBoundingClientRect();
    const totalMovePct = rect ? (totalMove / Math.max(rect.width, rect.height)) * 100 : 0;
    const snapBack =
      totalMovePct < SYRUP_CLICK_MAX_MOVE_PCT ||
      (Math.abs(syrupDrag.left - home.left) < item.width * SYRUP_SNAP_FRACTION &&
        Math.abs(syrupDrag.top - home.top) < item.height * SYRUP_SNAP_FRACTION);
    setSyrupPositions((prev) => ({
      ...prev,
      [item.key]: snapBack ? home : { left: syrupDrag.left, top: syrupDrag.top },
    }));
    setSyrupDrag(null);
  };

  const handleSyrupKeyDown = (item) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    if (canPourSyrup) {
      beginSyrupPour(item.key);
      return;
    }
    setSyrupPositions((prev) => ({ ...prev, [item.key]: { left: item.left, top: item.top } }));
  };

  // ---- Foam pick-up/pour/drag handlers -- identical shape to the syrup
  // handlers just above, see the big comment above FOAM_HOVER_GAP for what's
  // different about foam itself (lands on top of the drink, not the bottom).
  const beginFoamPour = (key) => {
    if (!canPourFoam) return;
    const item = TOPPING_ITEMS.find((i) => i.key === key);
    setFoamPositions((prev) => ({ ...prev, [key]: getFoamHoverPos(item) }));
    setFoamPourOffset(0);
    setFoamPouringKey(key);
    setFoamPourStage('moving');
  };

  useEffect(() => {
    if (foamPourStage === 'moving') {
      const t = setTimeout(() => setFoamPourStage('pouring'), FOAM_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (foamPourStage === 'pouring') {
      setCupFoam({ key: foamPouringKey });
      const t = setTimeout(() => {
        const home = TOPPING_ITEMS.find((i) => i.key === foamPouringKey);
        setFoamPositions((prev) => ({ ...prev, [foamPouringKey]: { left: home.left, top: home.top } }));
        setFoamPourStage('idle');
        setFoamPouringKey(null);
        setFoamPourOffset(0);
      }, FOAM_POUR_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [foamPourStage, foamPouringKey]);

  // Same capture-phase-before-useFlatFocusNav intercept as the syrup aim
  // effect above -- see its own big comment for why this has to be capture
  // phase + stopImmediatePropagation rather than a plain onKeyDown.
  useEffect(() => {
    if (foamPourStage !== 'pouring' || !foamPouringKey) return undefined;
    const handleFoamAimKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Left' && action !== 'Right') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setFoamPourOffset((prev) => {
        const next = prev + (action === 'Right' ? FOAM_MOVE_STEP : -FOAM_MOVE_STEP);
        return Math.min(FOAM_MOVE_RANGE, Math.max(-FOAM_MOVE_RANGE, next));
      });
    };
    window.addEventListener('keydown', handleFoamAimKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleFoamAimKeyDown, { capture: true });
  }, [foamPourStage, foamPouringKey]);

  const handleFoamPointerDown = (item) => (e) => {
    if (foamPouringKey === item.key) return; // can't re-grab mid-pour
    const base = foamPositions[item.key];
    e.currentTarget.setPointerCapture(e.pointerId);
    foamDragStartRef.current = { pointerX: e.clientX, pointerY: e.clientY, left: base.left, top: base.top };
    setFoamDrag({ key: item.key, left: base.left, top: base.top });
  };

  const handleFoamPointerMove = (item) => (e) => {
    if (!foamDrag || foamDrag.key !== item.key) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - foamDragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - foamDragStartRef.current.pointerY) / rect.height) * 100;
    setFoamDrag({
      key: item.key,
      left: foamDragStartRef.current.left + dxPct,
      top: foamDragStartRef.current.top + dyPct,
    });
  };

  const handleFoamPointerUp = (item) => (e) => {
    if (!foamDrag || foamDrag.key !== item.key) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (canPourFoam && isOverIncomingCup(foamDrag.left, foamDrag.top)) {
      setFoamDrag(null);
      beginFoamPour(item.key);
      return;
    }
    const home = { left: item.left, top: item.top };
    const totalMove = Math.max(
      Math.abs(e.clientX - foamDragStartRef.current.pointerX),
      Math.abs(e.clientY - foamDragStartRef.current.pointerY)
    );
    const rect = containerRef.current?.getBoundingClientRect();
    const totalMovePct = rect ? (totalMove / Math.max(rect.width, rect.height)) * 100 : 0;
    const snapBack =
      totalMovePct < FOAM_CLICK_MAX_MOVE_PCT ||
      (Math.abs(foamDrag.left - home.left) < item.width * FOAM_SNAP_FRACTION &&
        Math.abs(foamDrag.top - home.top) < item.height * FOAM_SNAP_FRACTION);
    setFoamPositions((prev) => ({
      ...prev,
      [item.key]: snapBack ? home : { left: foamDrag.left, top: foamDrag.top },
    }));
    setFoamDrag(null);
  };

  const handleFoamKeyDown = (item) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    if (canPourFoam) {
      beginFoamPour(item.key);
      return;
    }
    setFoamPositions((prev) => ({ ...prev, [item.key]: { left: item.left, top: item.top } }));
  };

  // ---- Powder pick-up/pour/drag handlers -- identical shape to the syrup/
  // foam handlers above, see the big comment above POWDER_HOVER_GAP for
  // what's different about powder itself (particle stream, foam-dependent
  // landing spot).
  const beginPowderPour = (key) => {
    if (!canPourPowder) return;
    const item = TOPPING_ITEMS.find((i) => i.key === key);
    setPowderPositions((prev) => ({ ...prev, [key]: getPowderHoverPos(item) }));
    setPowderPourOffset(0);
    setPowderPouringKey(key);
    setPowderPourStage('moving');
  };

  useEffect(() => {
    if (powderPourStage === 'moving') {
      const t = setTimeout(() => setPowderPourStage('pouring'), POWDER_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (powderPourStage === 'pouring') {
      setCupPowder({ key: powderPouringKey });
      const t = setTimeout(() => {
        const home = TOPPING_ITEMS.find((i) => i.key === powderPouringKey);
        setPowderPositions((prev) => ({ ...prev, [powderPouringKey]: { left: home.left, top: home.top } }));
        setPowderPourStage('idle');
        setPowderPouringKey(null);
        setPowderPourOffset(0);
      }, POWDER_POUR_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [powderPourStage, powderPouringKey]);

  // Same capture-phase-before-useFlatFocusNav intercept as the syrup/foam
  // aim effects above -- see the syrup one's own big comment for why this
  // has to be capture phase + stopImmediatePropagation.
  useEffect(() => {
    if (powderPourStage !== 'pouring' || !powderPouringKey) return undefined;
    const handlePowderAimKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Left' && action !== 'Right') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPowderPourOffset((prev) => {
        const next = prev + (action === 'Right' ? POWDER_MOVE_STEP : -POWDER_MOVE_STEP);
        return Math.min(POWDER_MOVE_RANGE, Math.max(-POWDER_MOVE_RANGE, next));
      });
    };
    window.addEventListener('keydown', handlePowderAimKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handlePowderAimKeyDown, { capture: true });
  }, [powderPourStage, powderPouringKey]);

  const handlePowderPointerDown = (item) => (e) => {
    if (powderPouringKey === item.key) return; // can't re-grab mid-pour
    const base = powderPositions[item.key];
    e.currentTarget.setPointerCapture(e.pointerId);
    powderDragStartRef.current = { pointerX: e.clientX, pointerY: e.clientY, left: base.left, top: base.top };
    setPowderDrag({ key: item.key, left: base.left, top: base.top });
  };

  const handlePowderPointerMove = (item) => (e) => {
    if (!powderDrag || powderDrag.key !== item.key) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - powderDragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - powderDragStartRef.current.pointerY) / rect.height) * 100;
    setPowderDrag({
      key: item.key,
      left: powderDragStartRef.current.left + dxPct,
      top: powderDragStartRef.current.top + dyPct,
    });
  };

  const handlePowderPointerUp = (item) => (e) => {
    if (!powderDrag || powderDrag.key !== item.key) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (canPourPowder && isOverIncomingCup(powderDrag.left, powderDrag.top)) {
      setPowderDrag(null);
      beginPowderPour(item.key);
      return;
    }
    const home = { left: item.left, top: item.top };
    const totalMove = Math.max(
      Math.abs(e.clientX - powderDragStartRef.current.pointerX),
      Math.abs(e.clientY - powderDragStartRef.current.pointerY)
    );
    const rect = containerRef.current?.getBoundingClientRect();
    const totalMovePct = rect ? (totalMove / Math.max(rect.width, rect.height)) * 100 : 0;
    const snapBack =
      totalMovePct < POWDER_CLICK_MAX_MOVE_PCT ||
      (Math.abs(powderDrag.left - home.left) < item.width * POWDER_SNAP_FRACTION &&
        Math.abs(powderDrag.top - home.top) < item.height * POWDER_SNAP_FRACTION);
    setPowderPositions((prev) => ({
      ...prev,
      [item.key]: snapBack ? home : { left: powderDrag.left, top: powderDrag.top },
    }));
    setPowderDrag(null);
  };

  const handlePowderKeyDown = (item) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    if (canPourPowder) {
      beginPowderPour(item.key);
      return;
    }
    setPowderPositions((prev) => ({ ...prev, [item.key]: { left: item.left, top: item.top } }));
  };

  // ---- Falling syrup stream -- see the big comment on SYRUP_STREAM_COLORS/
  // getSyrupBoxFor above. Anchored to the pouring bottle's own current
  // (offset-nudged) position, falling down to the syrup box's own top edge
  // so it reads as landing right where the syrup will appear.
  const pouringSyrupItem = pouringKey ? TOPPING_ITEMS.find((i) => i.key === pouringKey) : null;
  const pouringSyrupPos = pouringKey ? syrupPositions[pouringKey] : null;
  const syrupPourLeft =
    pouringSyrupItem && pouringSyrupPos ? pouringSyrupPos.left + pouringSyrupItem.width / 2 + pourOffset : 0;
  const syrupPourTop = pouringSyrupItem && pouringSyrupPos ? pouringSyrupPos.top + pouringSyrupItem.height : 0;
  const syrupPourHeight = incomingSyrupBox ? Math.max(incomingSyrupBox.top - syrupPourTop, 1) : 0;
  const syrupPourColor = pouringKey ? SYRUP_STREAM_COLORS[pouringKey] : SYRUP_STREAM_COLORS['guava-syrup'];

  // ---- Falling foam stream -- same idea as the syrup stream above, just
  // landing at the foam box's own top edge (incomingFoamBox) instead.
  const pouringFoamItem = foamPouringKey ? TOPPING_ITEMS.find((i) => i.key === foamPouringKey) : null;
  const pouringFoamPos = foamPouringKey ? foamPositions[foamPouringKey] : null;
  const foamPourLeft =
    pouringFoamItem && pouringFoamPos ? pouringFoamPos.left + pouringFoamItem.width / 2 + foamPourOffset : 0;
  const foamPourTop = pouringFoamItem && pouringFoamPos ? pouringFoamPos.top + pouringFoamItem.height : 0;
  const foamPourHeight = incomingFoamBox ? Math.max(incomingFoamBox.top - foamPourTop, 1) : 0;
  const foamPourColor = foamPouringKey ? FOAM_STREAM_COLORS[foamPouringKey] : FOAM_STREAM_COLORS['reg-cold-foam'];

  // ---- Falling powder stream -- same idea as the syrup/foam streams
  // above, just landing wherever the powder will actually settle: the
  // foam cap's own top edge if there's foam already in the cup to catch
  // it (cupFoam), otherwise the liquid column's own top edge
  // (incomingPowderLiquidBox) -- see the big comment above POWDER_HOVER_GAP.
  const pouringPowderItem = powderPouringKey ? TOPPING_ITEMS.find((i) => i.key === powderPouringKey) : null;
  const pouringPowderPos = powderPouringKey ? powderPositions[powderPouringKey] : null;
  const powderPourLeft =
    pouringPowderItem && pouringPowderPos
      ? pouringPowderPos.left + pouringPowderItem.width / 2 + powderPourOffset
      : 0;
  const powderPourTop =
    pouringPowderItem && pouringPowderPos ? pouringPowderPos.top + pouringPowderItem.height : 0;
  const powderLandingTop = cupFoam && incomingFoamCapBox ? incomingFoamCapBox.top : incomingPowderLiquidBox?.top;
  const powderPourHeight = powderLandingTop != null ? Math.max(powderLandingTop - powderPourTop, 1) : 0;
  const powderPourColor = powderPouringKey
    ? POWDER_STREAM_COLORS[powderPouringKey]
    : POWDER_STREAM_COLORS['matcha-powder'];

  // ---- Where matcha-powder/guava-powder settles once poured -- see the
  // big comment above POWDER_HOVER_GAP for why this is a scatter of small
  // flecks (not a smooth fill) and why the landing shape/spot depends on
  // whether foam's already in the cup. cupFoam here reflects whatever the
  // CURRENT state is at render time, not a snapshot from when the powder
  // itself was poured -- if foam gets poured in after the powder already
  // settled into the liquid, the flecks stay wherever they were (they
  // don't retroactively jump onto a foam layer added later).
  const powderLandingBox = cupFoam && incomingFoamCapBox ? incomingFoamCapBox : incomingPowderLiquidBox;
  const powderFleckOffsets = cupFoam && incomingFoamCapBox ? POWDER_FLECK_OFFSETS_ELLIPSE : POWDER_FLECK_OFFSETS_LIQUID;
  const powderFleckPositions =
    cupPowder && powderLandingBox ? getFleckPositions(powderLandingBox, powderFleckOffsets) : [];

  return (
    <div className="toppings-container" ref={containerRef}>
      <h1 className="sr-only">Toppings Station</h1>

      <div className="toppings-content">
        <img src={TOPPINGS_BACKGROUND_SRC} alt="Toppings station counter" className="toppings-art" />
        {/* All six topping items are now fully interactive (drag-onto-the-
            drink or Enter to pour) -- matcha-powder/guava-powder were the
            last two still on the old "just a selectable, non-draggable
            placeholder" treatment (see .station-item.selectable in
            ToppingsStation.css, still used elsewhere for genuinely inert
            items), so that placeholder block that used to render them
            (and, before that, the syrup/foam pairs too) has been removed
            entirely rather than left rendering an always-empty filtered
            list. */}
        {/* Guava/mint syrup -- draggable onto the drink (or Enter to pour)
            same as Milk Selection's own bottles, reusing MatchaMaking.css's
            .station-item.movable (drag cursor, focus glow, .dragging/
            .settling) rather than this file's own local .selectable, since
            that's the exact drag/focus treatment this needs and it's
            already loaded globally (see the comment on the carried-over cup
            below for that same reasoning). The 180deg flip (WHISK_FLIP_DEG,
            imported from MatchaMaking.js) plays while settling/pouring --
            see the big comment on SYRUP_HOVER_GAP above for why a full flip
            rather than milk bottles' own partial tilt. */}
        {TOPPING_ITEMS.filter((item) => item.key === 'guava-syrup' || item.key === 'mint-syrup').map((item) => {
          const dragging = syrupDrag?.key === item.key;
          const isPouring = pouringKey === item.key;
          const basePos = dragging ? syrupDrag : syrupPositions[item.key];
          const pos = isPouring ? { left: basePos.left + pourOffset, top: basePos.top } : basePos;
          return (
            <img
              key={item.key}
              src={item.src}
              alt={`${item.alt}. Drag onto the drink to pour some in, or select it and press Enter. While it's pouring, use Left/Right to aim the stream.`}
              className={`station-item movable${dragging ? ' dragging' : ''}${isPouring ? ' settling' : ''}`}
              data-focusable
              tabIndex={0}
              draggable={false}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${item.width}%`,
                height: `${item.height}%`,
                ...(isPouring ? { transform: `rotate(${WHISK_FLIP_DEG}deg)` } : {}),
              }}
              onPointerDown={handleSyrupPointerDown(item)}
              onPointerMove={handleSyrupPointerMove(item)}
              onPointerUp={handleSyrupPointerUp(item)}
              onKeyDown={handleSyrupKeyDown(item)}
            />
          );
        })}
        {/* Matcha-cold-foam/reg-cold-foam -- identical interaction to the
            syrup pair above (drag onto the drink or Enter to pour, 180deg
            flip via WHISK_FLIP_DEG, Left/Right to aim while pouring); see
            the big comment above FOAM_HOVER_GAP for what's different about
            where foam actually lands. */}
        {TOPPING_ITEMS.filter((item) => item.key === 'matcha-cold-foam' || item.key === 'reg-cold-foam').map(
          (item) => {
            const dragging = foamDrag?.key === item.key;
            const isPouring = foamPouringKey === item.key;
            const basePos = dragging ? foamDrag : foamPositions[item.key];
            const pos = isPouring ? { left: basePos.left + foamPourOffset, top: basePos.top } : basePos;
            return (
              <img
                key={item.key}
                src={item.src}
                alt={`${item.alt}. Drag onto the drink to pour some in, or select it and press Enter. While it's pouring, use Left/Right to aim the stream.`}
                className={`station-item movable${dragging ? ' dragging' : ''}${isPouring ? ' settling' : ''}`}
                data-focusable
                tabIndex={0}
                draggable={false}
                style={{
                  left: `${pos.left}%`,
                  top: `${pos.top}%`,
                  width: `${item.width}%`,
                  height: `${item.height}%`,
                  ...(isPouring ? { transform: `rotate(${WHISK_FLIP_DEG}deg)` } : {}),
                }}
                onPointerDown={handleFoamPointerDown(item)}
                onPointerMove={handleFoamPointerMove(item)}
                onPointerUp={handleFoamPointerUp(item)}
                onKeyDown={handleFoamKeyDown(item)}
              />
            );
          }
        )}
        {/* Matcha-powder/guava-powder -- identical interaction to the syrup/
            foam pairs above (drag onto the drink or Enter to pour, 180deg
            flip via WHISK_FLIP_DEG, Left/Right to aim while pouring); see
            the big comment above POWDER_HOVER_GAP for what's different
            about powder itself (particle stream, foam-dependent landing
            spot). */}
        {TOPPING_ITEMS.filter((item) => POWDER_PAIR.some((p) => p.key === item.key)).map((item) => {
          const dragging = powderDrag?.key === item.key;
          const isPouring = powderPouringKey === item.key;
          const basePos = dragging ? powderDrag : powderPositions[item.key];
          const pos = isPouring ? { left: basePos.left + powderPourOffset, top: basePos.top } : basePos;
          return (
            <img
              key={item.key}
              src={item.src}
              alt={`${item.alt}. Drag onto the drink to pour some in, or select it and press Enter. While it's pouring, use Left/Right to aim the stream.`}
              className={`station-item movable${dragging ? ' dragging' : ''}${isPouring ? ' settling' : ''}`}
              data-focusable
              tabIndex={0}
              draggable={false}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${item.width}%`,
                height: `${item.height}%`,
                ...(isPouring ? { transform: `rotate(${WHISK_FLIP_DEG}deg)` } : {}),
              }}
              onPointerDown={handlePowderPointerDown(item)}
              onPointerMove={handlePowderPointerMove(item)}
              onPointerUp={handlePowderPointerUp(item)}
              onKeyDown={handlePowderKeyDown(item)}
            />
          );
        })}
        {/* Carried-over drink -- purely decorative (aria-hidden, no
            data-focusable/tabIndex, same treatment Milk Selection's own
            incoming bowl started with), just so the finished drink doesn't
            vanish once sent over. Only the cup itself uses this screen's
            own .station-item (not .selectable, so it's not focusable) --
            the fills reuse MilkSelection.css's classes as-is. */}
        {incomingDrink && (
          <>
            <img
              src="./GlassCup.png"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="station-item"
              style={{
                left: `${INCOMING_DRINK_SPOT.left}%`,
                top: `${INCOMING_DRINK_SPOT.top}%`,
                width: `${INCOMING_DRINK_SIZE.width}%`,
                height: `${INCOMING_DRINK_SIZE.height}%`,
              }}
            />
            {incomingMilkBox && (
              <div
                className={`cup-milk-fill ${incomingDrink.milk.type}`}
                aria-hidden="true"
                style={{
                  left: `${incomingMilkBox.left}%`,
                  top: `${incomingMilkBox.top}%`,
                  width: `${incomingMilkBox.width}%`,
                  height: `${incomingMilkBox.height}%`,
                }}
              />
            )}
            {incomingMatchaBox && (
              <div
                className={`cup-matcha-fill ${incomingDrink.matcha.grade}`}
                aria-hidden="true"
                style={{
                  left: `${incomingMatchaBox.left}%`,
                  top: `${incomingMatchaBox.top}%`,
                  width: `${incomingMatchaBox.width}%`,
                  height: `${incomingMatchaBox.height}%`,
                }}
              />
            )}
            {/* Cold foam, poured on TOP of whatever's already in the cup --
                its own shape (.cup-foam-fill in ToppingsStation.css), with
                rounded top corners rather than matcha's own pointed glass-
                taper meniscus (see the big comment above FOAM_HOVER_GAP in
                this file), and its own color modifier class that stays
                solid/opaque almost the whole way down instead of fading
                the way matcha's own modifier classes do -- foam is meant
                to read as its own distinct layer sitting on top, not as
                blending into whatever's underneath. Rendered after the
                matcha fill above so it paints over it. */}
            {cupFoam && incomingFoamBox && (
              <div
                className={`cup-foam-fill ${cupFoam.key}`}
                aria-hidden="true"
                style={{
                  left: `${incomingFoamBox.left}%`,
                  top: `${incomingFoamBox.top}%`,
                  width: `${incomingFoamBox.width}%`,
                  height: `${incomingFoamBox.height}%`,
                }}
              />
            )}
            {/* Foam's own flattened top-surface ellipse, straddling the
                body's own top edge (see getFoamCapBoxFor above) -- reads as
                the flat surface of the poured foam sitting right at (or
                just above) the drink's fill line, which is what actually
                sells "filled all the way up" rather than the body's own
                rounded-but-still-a-bit-angular top edge on its own.
                Rendered after the body so it paints over that top edge. */}
            {cupFoam && incomingFoamCapBox && (
              <div
                className={`cup-foam-cap ${cupFoam.key}`}
                aria-hidden="true"
                style={{
                  left: `${incomingFoamCapBox.left}%`,
                  top: `${incomingFoamCapBox.top}%`,
                  width: `${incomingFoamCapBox.width}%`,
                  height: `${incomingFoamCapBox.height}%`,
                }}
              />
            )}
            {/* Syrup poured on top of everything else, but visually sinks to
                the BOTTOM of the drink -- see the big comment on
                getSyrupBoxFor above. .cup-syrup-fill is defined locally in
                ToppingsStation.css (unlike the milk/matcha fills, this one's
                a toppings-specific concept, not a Milk Selection one). */}
            {cupSyrup && incomingSyrupBox && (
              <div
                className={`cup-syrup-fill ${cupSyrup.key}`}
                aria-hidden="true"
                style={{
                  left: `${incomingSyrupBox.left}%`,
                  top: `${incomingSyrupBox.top}%`,
                  width: `${incomingSyrupBox.width}%`,
                  height: `${incomingSyrupBox.height}%`,
                }}
              />
            )}
            {/* Matcha-powder/guava-powder settles as a scatter of small
                flecks rather than a smooth fill -- see the big comment
                above POWDER_HOVER_GAP for why, and for why the landing
                shape/spot (powderFleckPositions) depends on whether foam's
                already in the cup. Rendered last (after syrup) so it sits
                over everything else already poured. */}
            {cupPowder &&
              powderFleckPositions.map((pos, index) => (
                <span
                  key={index}
                  className={`cup-powder-fleck ${cupPowder.key}`}
                  aria-hidden="true"
                  style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                />
              ))}
          </>
        )}
        {/* Falling syrup stream -- see the big comment on
            SYRUP_STREAM_COLORS/getSyrupBoxFor above. Reuses MatchaMaking.
            css's .spoon-pour/.spoon-pour-grain-N, same as Milk Selection's
            own falling-liquid effect. Only shown during the actual
            'pouring' stage, not 'moving'. */}
        {pourStage === 'pouring' && pouringKey && (
          <div
            className="spoon-pour"
            style={{
              left: `${syrupPourLeft}%`,
              top: `${syrupPourTop}%`,
              height: `${syrupPourHeight}%`,
            }}
          >
            <span className="spoon-pour-grain spoon-pour-grain-1" style={{ background: syrupPourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-2" style={{ background: syrupPourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-3" style={{ background: syrupPourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-4" style={{ background: syrupPourColor }} />
          </div>
        )}
        {/* Falling foam stream -- same idea as the syrup stream above, see
            the big comment on FOAM_STREAM_COLORS/getFoamHoverPos in this
            file. Only shown during the actual 'pouring' stage. */}
        {foamPourStage === 'pouring' && foamPouringKey && (
          <div
            className="spoon-pour"
            style={{
              left: `${foamPourLeft}%`,
              top: `${foamPourTop}%`,
              height: `${foamPourHeight}%`,
            }}
          >
            <span className="spoon-pour-grain spoon-pour-grain-1" style={{ background: foamPourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-2" style={{ background: foamPourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-3" style={{ background: foamPourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-4" style={{ background: foamPourColor }} />
          </div>
        )}
        {/* Falling powder stream -- reuses MatchaMaking.css's own
            .spoon-pour-grain circles directly, same "small particles" look
            that station already uses for its own falling powder, landing
            wherever the powder will actually settle (see powderLandingTop/
            POWDER_HOVER_GAP above). */}
        {powderPourStage === 'pouring' && powderPouringKey && (
          <div
            className="spoon-pour"
            style={{
              left: `${powderPourLeft}%`,
              top: `${powderPourTop}%`,
              height: `${powderPourHeight}%`,
            }}
          >
            <span className="spoon-pour-grain spoon-pour-grain-1" style={{ background: powderPourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-2" style={{ background: powderPourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-3" style={{ background: powderPourColor }} />
            <span className="spoon-pour-grain spoon-pour-grain-4" style={{ background: powderPourColor }} />
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

export default ToppingsStation;
