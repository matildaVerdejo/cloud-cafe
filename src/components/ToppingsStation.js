import React, { useEffect, useMemo, useRef, useState } from 'react';
import './ToppingsStation.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { getActionFromKeyEvent, shouldDebounceEnter } from '../gameloop/pal';
import {
  playButtonClick,
  playLiquidPouring,
  playFoamPouring,
  playToppingPowderPour,
  playToppingPlace,
} from '../gameloop/sfx';
import ProgressBar from './ProgressBar';
import OrderReceiptButton from './OrderReceiptButton';
import { getMilkBoxFor, getMatchaBoxFor, TABLE_SIZE, CUP_TYPES, getIceCupSlotPos, getIceCubeSize } from './MilkSelection';
import { WHISK_FLIP_DEG } from './MatchaMaking';
import { scoreToppings } from '../gameloop/scoring';

// Where the finished cup (see incomingDrink below) sent over from Milk
// Selection's own "Send to Toppings" drop-zone comes to rest on this
// screen -- its RESTING spot (draggable/focusable now, per request, so the
// finished drink can be carried on to the Serving screen -- see
// SEND_TO_FINAL_ZONE/canSendToFinal below -- same "arrives here, becomes
// interactive, carries on to the next screen" shape the bowl and cup
// themselves already go through one screen earlier). Centered in the
// middle of the frame -- left/top are just 50% minus half the box's own
// width/height, which works out independently on each axis even though the
// container itself isn't square (percentages here are already relative to
// the container's own width/height respectively, same as every other box
// in this file).
//
// This module-level pair (TABLE_SIZE-based, i.e. the GLASS cup's own size)
// is only actually used as an approximation for the syrup/foam/powder
// items' own hover-while-pouring position and isOverIncomingCup's hit-test
// box below -- both of those are already loose/eyeballed (no measured
// spout position, a few percentage points of margin) regardless of which
// cup is in play, so aiming/dropping against the glass cup's own box is
// close enough even when the actual incoming cup is the (narrower)
// plastic one. The cup that's actually RENDERED, and the box its own milk/
// matcha fills are computed against, use the real per-cup-type size
// instead -- see incomingDrinkSize/incomingDrinkHomeSpot in the component
// below, which read incomingDrink.cupType (set by Milk Selection's own
// beginSendDrink) via the CUP_TYPES map imported from MilkSelection.js.
const INCOMING_DRINK_SIZE = TABLE_SIZE;
// Nudges the incoming drink down from dead-center, per request -- applies
// to both centering formulas that place it (this module-level
// INCOMING_DRINK_SPOT, which approximates against TABLE_SIZE for the
// syrup/foam/powder items' own hover-while-pouring positions and hit-
// testing below, and the component's own real per-cup-type
// incomingDrinkHomeSpot further down) so everything -- the cup itself, its
// fills/flecks, the hover spots, the mix bars -- stays aligned together,
// for every order, not just the first-order walkthrough.
const DRINK_VERTICAL_OFFSET = 8;
const INCOMING_DRINK_SPOT = {
  left: 50 - INCOMING_DRINK_SIZE.width / 2,
  top: 50 - INCOMING_DRINK_SIZE.height / 2 + DRINK_VERTICAL_OFFSET,
};

// Per-cup-type horizontal nudge for the incoming drink's own centering on
// THIS screen only -- per request, the mug specifically reads a little
// left of where it should once it's on this station's table (this
// screen's centering formula just halves MugCup.png's own bounding-box
// width, which doesn't necessarily match where the mug's actual visible
// body sits inside that box). Expressed as a fraction of the cup's own
// width (rather than a flat percentage) so it scales correctly with
// incomingDrinkSize below; glass/plastic default to 0 (untouched) via the
// `?? 0` fallback where this is read. Not applied to Milk Selection's own
// on-table mug position, which wasn't reported as off.
const INCOMING_DRINK_LEFT_OFFSET_FRAC = { mug: 0.05 };

// "Send to Serving" drop-zone -- same idea/position as Milk Selection's own
// SEND_DRINK_ZONE (reused verbatim: this screen's own topping items don't
// extend into the bottom-right corner either -- the powder pair is the only
// one on the right edge, and it sits well above this, see TOPPING_ROW_BOTTOM
// above), and the same pattern as MatchaMaking's MAKE_DRINK_ZONE before
// that: the lower-right-corner marker/drop-target that carries the current
// station's finished item on to the next screen's own incoming-item prop,
// without navigating there itself -- the player still moves screens via the
// ProgressBar/Back-key, same as ever. width/height chosen so the marker
// renders as a true square in real on-screen pixels, same reasoning as
// SEND_DRINK_ZONE's own updated comment there.
const SEND_TO_FINAL_ZONE = { left: 89.7, top: 85, width: 7.3, height: 13 };

const DRINK_SEND_MOVE_MS = 350; // time to glide to the zone -- same value as Milk Selection's own CUP_SEND_MOVE_MS
const DRINK_SEND_VANISH_MS = 350; // same value as Milk Selection's own CUP_SEND_VANISH_MS

// Background swapped from the old baked-in-items ToppingsStation.png to
// MatchaBaseStation.png (the same empty-counter art the Matcha Making
// station uses) -- per request, now that the six topping items below have
// been separated out into their own PNGs and are placed on top instead of
// being baked into the background art itself.
const TOPPINGS_BACKGROUND_SRC = './MatchaBaseStation.jpg';

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
// Mint first (left), guava second (right) -- swapped from the original
// guava-then-mint order per request.
const SYRUP_PAIR_BASE = [
  { key: 'mint-syrup', src: './MintSyrup.png', alt: 'Mint syrup', canvasAspect: 140 / 269 },
  { key: 'guava-syrup', src: './GuavaSyrup.png', alt: 'Guava syrup', canvasAspect: 139 / 264 },
];
// Honey syrup -- new order-3-and-later topping, same "locked until order 3"
// gating as MilkSelection's own strawberry milk bottle (order 2) and this
// file's own banana foam (order 2). Sits to the right of guava-syrup, same
// "new item added to the end of its row" convention banana-foam already
// set for the foam row. Its own source PNG was cropped to its own opaque
// bounding box before being copied into public/ (same "trim the excess
// transparent padding" treatment the rest of this pair already got, see
// the comment above) -- canvasAspect (208/657) is that trimmed size, not
// the original canvas.
const HONEY_SYRUP_ITEM = { key: 'honey-syrup', src: './HoneySyrup.png', alt: 'Honey syrup', canvasAspect: 208 / 657 };
const SYRUP_PAIR_WITH_HONEY = [...SYRUP_PAIR_BASE, HONEY_SYRUP_ITEM];
// Mango/lavender/peach syrup -- orders 3/4/5 respectively, per a later
// request that every order's unlocks now stack rather than replace one
// another (nothing ever drops off the counter again -- see
// mangoSyrupUnlocked/lavenderSyrupUnlocked/peachSyrupUnlocked in the
// component below). Each sits at the end of the row in turn, same
// "new item lands as the new rightmost" convention honey-syrup itself set.
// canvasAspect for all three is their own raw 360x693 canvas (untrimmed,
// same "just use the file's own dimensions" convention banana-foam already
// set below for a bottle whose canvas still carries some padding) -- works
// out to 0.5195, close enough to guava-syrup's 0.5265/mint-syrup's 0.5205
// that no extra tuning is needed.
const MANGO_SYRUP_ITEM = { key: 'mango-syrup', src: './MangoSyrup.png', alt: 'Mango syrup', canvasAspect: 360 / 693 };
const LAVENDER_SYRUP_ITEM = {
  key: 'lavender-syrup',
  src: './LavenderSyrup.png',
  alt: 'Lavender syrup',
  canvasAspect: 360 / 693,
};
const PEACH_SYRUP_ITEM = { key: 'peach-syrup', src: './PeachSyrup.png', alt: 'Peach syrup', canvasAspect: 360 / 693 };
const SYRUP_PAIR_WITH_MANGO = [...SYRUP_PAIR_WITH_HONEY, MANGO_SYRUP_ITEM];
const SYRUP_PAIR_WITH_LAVENDER = [...SYRUP_PAIR_WITH_MANGO, LAVENDER_SYRUP_ITEM];
const SYRUP_PAIR_WITH_PEACH = [...SYRUP_PAIR_WITH_LAVENDER, PEACH_SYRUP_ITEM];
const FOAM_PAIR_BASE = [
  { key: 'matcha-cold-foam', src: './MatchaColdFoam.png', alt: 'Matcha cold foam', canvasAspect: 155 / 297 },
  { key: 'reg-cold-foam', src: './RegColdFoam.png', alt: 'Regular cold foam', canvasAspect: 151 / 290 },
];
// Banana foam -- new order-2-and-later topping, same "locked until order 2"
// gating as MilkSelection's own strawberry milk bottle. Sits next to
// reg-cold-foam (to its right), per request. canvasAspect measured the same
// way as the other five toppings (361x692 raw canvas) -- works out to
// 0.5217, close enough to matcha-cold-foam's 0.5219 and reg-cold-foam's
// 0.5207 that scaling by the shared TOPPING_HEIGHT alone already gives it
// the "same size" as the other two, no extra tuning needed. Same squeeze-
// bottle art style as reg-cold-foam/matcha-cold-foam (not a tin/jar), so it
// gets the exact same treatment (canvasAspect-only sizing, no leftPad/
// rightPad fields) as its two pair-mates.
const BANANA_FOAM_ITEM = { key: 'banana-foam', src: './BananaFoam.png', alt: 'Banana foam', canvasAspect: 361 / 692 };
const FOAM_PAIR_WITH_BANANA = [...FOAM_PAIR_BASE, BANANA_FOAM_ITEM];
// Strawberry/blueberry foam -- orders 4/5 respectively, same stacking
// unlock schedule as the syrup trio above (strawberryFoamUnlocked/
// blueberryFoamUnlocked in the component below). Same 361x692 raw-canvas
// convention as banana-foam.
const STRAWBERRY_FOAM_ITEM = {
  key: 'strawberry-foam',
  src: './StrawberryFoam.png',
  alt: 'Strawberry foam',
  canvasAspect: 361 / 692,
};
const BLUEBERRY_FOAM_ITEM = {
  key: 'blueberry-foam',
  src: './BlueberryFoam.png',
  alt: 'Blueberry foam',
  canvasAspect: 361 / 692,
};
const FOAM_PAIR_WITH_STRAWBERRY = [...FOAM_PAIR_WITH_BANANA, STRAWBERRY_FOAM_ITEM];
const FOAM_PAIR_WITH_BLUEBERRY = [...FOAM_PAIR_WITH_STRAWBERRY, BLUEBERRY_FOAM_ITEM];
// The same two item objects laid out at the top of the file (matcha-powder/
// guava-powder), just grouped the same "pair" way as SYRUP_PAIR_BASE/
// FOAM_PAIR_BASE above so the pour-mechanic code below can filter/iterate
// them the same way (layoutPair itself is still called with
// [MATCHA_POWDER_ITEM, GUAVA_POWDER_ITEM] directly below, in POWDER_ITEMS_
// BASE -- this is just an alias for the interactive-rendering code further
// down).
const POWDER_PAIR = [MATCHA_POWDER_ITEM, GUAVA_POWDER_ITEM];
// Choco powder -- new order-3-and-later topping, same stacking-unlock idea
// as the syrup/foam trios above (chocoPowderUnlocked in the component
// below). Sits to the right of guava-powder. canvasAspect (279/420) is its
// own raw canvas -- happens to exactly match matcha-powder's own canvas
// size.
const CHOCO_POWDER_ITEM = { key: 'choco-powder', src: './ChocoPowder.png', alt: 'Choco powder', canvasAspect: 279 / 420 };
const POWDER_PAIR_WITH_CHOCO = [...POWDER_PAIR, CHOCO_POWDER_ITEM];

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
// PAIR_GAP. The foam row's spacing was already confirmed good, so it keeps
// the wider PAIR_GAP (including for banana-foam, added later).
const TIGHT_PAIR_GAP = 0.15;
// The syrup pair needs to be even closer together than TIGHT_PAIR_GAP, per
// request -- tightened further still (was 0.05) per a later request to
// move guava-syrup and mint-syrup closer to each other.
const SYRUP_PAIR_GAP = 0.02;
const PAIR_GAP = 0.6;
// The foam pair's own PNGs (MatchaColdFoam.png/RegColdFoam.png) still carry
// a lot of internal transparent padding on their outward-facing sides even
// after the trim mentioned above (matcha-cold-foam's visible art starts
// ~38% of its own box-width in from its left edge; guava-powder's visible
// art, by contrast, only has ~4.6% of its own box-width as padding on its
// right side). Anchoring the foam pair at the same EDGE_MARGIN as the
// syrup/powder pairs therefore left a noticeably bigger *visual* gap
// between the screen's left edge and the actual foam art than the gap
// between guava-powder's actual art and the right edge, even though both
// pairs' boxes technically started/ended at the same EDGE_MARGIN. Given a
// separate, smaller left anchor here (2.01, vs EDGE_MARGIN's 5) so the
// foam pair's *visible* left margin lines up with the powder pair's
// *visible* right margin instead -- per request. The syrup pair (mint-syrup
// leftmost after the swap) shares this same anchor too, per a later request
// to move it left so it lines back up with the foam pair below it -- its
// own leftmost item's padding (mint-syrup, ~38.6% of its own box-width) is
// close enough to matcha-cold-foam's (~38.1%) that reusing this one anchor
// for both keeps the two pairs' visible left edges aligned within a
// fraction of a percent, not just their boxes.
const STACK_LEFT_MARGIN = 2.01;
// Syrup pair's top -- shifted down slightly from the very top edge (was
// CORNER_PAIR_TOP-style 6), per request.
const SYRUP_TOP = 12;
// Foam pair sits directly below the syrup pair -- its own height plus a
// small vertical gap below SYRUP_TOP.
const STACK_GAP = 3;
const FOAM_TOP = SYRUP_TOP + TOPPING_HEIGHT + STACK_GAP;

// Lays out a row of items (originally always exactly a "pair" of two --
// name kept for the powder/syrup call sites that still are -- generalized
// to any length once the foam row grew a third member, banana-foam) as
// boxes `gap` apart at a shared height/top, anchored either to a left
// edge, a right edge, or horizontally centered on a point -- anchor is
// { type: 'left' | 'right' | 'center', x }. Behaves identically to the old
// two-item-only version for every existing 2-item call site.
function layoutPair(pair, height, top, gap, anchor) {
  const widths = pair.map((item) => height * item.canvasAspect * (9 / 16));
  const totalWidth = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  let startLeft;
  if (anchor.type === 'left') {
    startLeft = anchor.x;
  } else if (anchor.type === 'right') {
    startLeft = anchor.x - totalWidth;
  } else {
    startLeft = anchor.x - totalWidth / 2;
  }
  const lefts = [];
  let cursor = startLeft;
  for (let i = 0; i < widths.length; i += 1) {
    lefts.push(cursor);
    cursor += widths[i] + gap;
  }
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

// matcha-powder first, guava-powder to its right (then choco-powder further
// right still, order-3-and-later only) -- smaller (POWDER_HEIGHT), tight
// (TIGHT_PAIR_GAP), down on the table baseline at the right edge instead of
// up in the corner. Two precomputed tiers (base / with-choco), same
// "precompute every tier, pick one per customerNumber" pattern as the
// syrup/foam rows below.
const POWDER_ITEMS_BASE = layoutPair(POWDER_PAIR, POWDER_HEIGHT, TOPPING_ROW_BOTTOM - POWDER_HEIGHT, TIGHT_PAIR_GAP, {
  type: 'right',
  x: 100 - EDGE_MARGIN,
});
const POWDER_ITEMS_WITH_CHOCO = layoutPair(
  POWDER_PAIR_WITH_CHOCO,
  POWDER_HEIGHT,
  TOPPING_ROW_BOTTOM - POWDER_HEIGHT,
  TIGHT_PAIR_GAP,
  { type: 'right', x: 100 - EDGE_MARGIN }
);
// mint-syrup first, guava-syrup to its right, then honey-syrup (order 2+),
// mango-syrup (order 3+), lavender-syrup (order 4+), peach-syrup (order 5+)
// -- each stacking on the end in turn, per request that every order's own
// unlocks now stack rather than replace one another. Upper-left corner,
// shifted down slightly (SYRUP_TOP) and even tighter (SYRUP_PAIR_GAP).
// Anchored at STACK_LEFT_MARGIN (not EDGE_MARGIN) so it lines back up with
// the foam row directly below it -- see STACK_LEFT_MARGIN's own comment.
// Five precomputed tiers, same "precompute every tier, pick one per
// customerNumber" pattern as MilkSelection's own BOTTLE_ITEMS_BASE/
// _WITH_STRAWBERRY -- picked via syrupItems in the component below.
const SYRUP_ITEMS_BASE = layoutPair(SYRUP_PAIR_BASE, TOPPING_HEIGHT, SYRUP_TOP, SYRUP_PAIR_GAP, {
  type: 'left',
  x: STACK_LEFT_MARGIN,
});
const SYRUP_ITEMS_WITH_HONEY = layoutPair(SYRUP_PAIR_WITH_HONEY, TOPPING_HEIGHT, SYRUP_TOP, SYRUP_PAIR_GAP, {
  type: 'left',
  x: STACK_LEFT_MARGIN,
});
const SYRUP_ITEMS_WITH_MANGO = layoutPair(SYRUP_PAIR_WITH_MANGO, TOPPING_HEIGHT, SYRUP_TOP, SYRUP_PAIR_GAP, {
  type: 'left',
  x: STACK_LEFT_MARGIN,
});
const SYRUP_ITEMS_WITH_LAVENDER = layoutPair(SYRUP_PAIR_WITH_LAVENDER, TOPPING_HEIGHT, SYRUP_TOP, SYRUP_PAIR_GAP, {
  type: 'left',
  x: STACK_LEFT_MARGIN,
});
const SYRUP_ITEMS_WITH_PEACH = layoutPair(SYRUP_PAIR_WITH_PEACH, TOPPING_HEIGHT, SYRUP_TOP, SYRUP_PAIR_GAP, {
  type: 'left',
  x: STACK_LEFT_MARGIN,
});
// matcha-cold-foam first, reg-cold-foam to its right, then banana-foam
// (order 2+), strawberry-foam (order 4+ -- nothing new joins this row at
// order 3, that's mango-syrup/choco-powder's turn instead), blueberry-foam
// (order 5+) -- directly below the syrup row, stacked at FOAM_TOP. Anchored
// at STACK_LEFT_MARGIN (not EDGE_MARGIN) so its visible left margin matches
// the powder pair's visible right margin -- see STACK_LEFT_MARGIN's own
// comment. Four precomputed tiers, same "precompute every tier" pattern as
// the syrup row above -- picked via foamItems in the component below.
const FOAM_ITEMS_BASE = layoutPair(FOAM_PAIR_BASE, TOPPING_HEIGHT, FOAM_TOP, PAIR_GAP, {
  type: 'left',
  x: STACK_LEFT_MARGIN,
});
const FOAM_ITEMS_WITH_BANANA = layoutPair(FOAM_PAIR_WITH_BANANA, TOPPING_HEIGHT, FOAM_TOP, PAIR_GAP, {
  type: 'left',
  x: STACK_LEFT_MARGIN,
});
const FOAM_ITEMS_WITH_STRAWBERRY = layoutPair(FOAM_PAIR_WITH_STRAWBERRY, TOPPING_HEIGHT, FOAM_TOP, PAIR_GAP, {
  type: 'left',
  x: STACK_LEFT_MARGIN,
});
const FOAM_ITEMS_WITH_BLUEBERRY = layoutPair(FOAM_PAIR_WITH_BLUEBERRY, TOPPING_HEIGHT, FOAM_TOP, PAIR_GAP, {
  type: 'left',
  x: STACK_LEFT_MARGIN,
});

// Display name per topping, shown as a label above whichever one currently
// has focus (see focusedTopping/.topping-label below) -- same "selected" ==
// "has the focus halo" idea, same pastel-brown-with-white-halo look, as
// MatchaMaking.js's own TIN_LABELS/.matcha-tin-label and MilkSelection.js's
// own BOTTLE_LABELS/.milk-bottle-label. Keyed the same way TOPPING_ITEMS
// itself is (matcha-cold-foam/reg-cold-foam, not CustomerOrdering.js's own
// differently-keyed matcha-foam/reg-foam speech names).
const TOPPING_LABELS = {
  'guava-syrup': 'guava syrup',
  'mint-syrup': 'mint syrup',
  'honey-syrup': 'honey syrup',
  'matcha-cold-foam': 'matcha foam',
  'reg-cold-foam': 'regular foam',
  'banana-foam': 'banana foam',
  'matcha-powder': 'matcha powder',
  'guava-powder': 'guava powder',
  'mint-leaves': 'mint leaves',
  'mango-syrup': 'mango syrup',
  'choco-powder': 'choco powder',
  'lavender-syrup': 'lavender syrup',
  'strawberry-foam': 'strawberry foam',
  'banana-chips': 'banana chips',
  'peach-syrup': 'peach syrup',
  'blueberry-foam': 'blueberry foam',
  'cherry-blossoms': 'cherry blossoms',
};

// Gap between a topping's own top edge and its label -- negative, same as
// MilkSelection.js's own BOTTLE_LABEL_GAP, so the label overlaps down onto
// the item's own art rather than needing clear space above it. That's
// deliberate here in particular: the syrup pair and foam pair are stacked
// only STACK_GAP (3%) apart, so a label that required its own free space
// above/below an item would collide with its neighboring pair.
const TOPPING_LABEL_GAP = -0.5;

// ---- Pouring a syrup onto the carried-over drink -------------------------
// Same overall shape as Milk Selection's bottle-pour sequence (glide to a
// hover spot above the cup, "pour", glide back home), with two differences
// specific to syrup: the bottle does a full 180deg flip (reusing
// MatchaMaking's own WHISK_FLIP_DEG -- a syrup bottle tips all the way
// upside-down to pour, not a partial tilt like the milk bottles) rather
// than staying upright, and while it's flipped a balance minigame runs
// (see SYRUP_MIX_BAR_WIDTH and the physics effect further down) -- keep a
// small ball inside the green zone using Left/Right or it spills syrup onto
// the counter and costs points (see scoreToppings' own syrup-pour check).
// The bottle/falling stream still visually nudge left/right same as before,
// just now as a side effect of the ball's own live position rather than a
// separate purely-cosmetic control -- it still doesn't change where the
// syrup fill itself ends up (see .cup-syrup-fill below, always anchored to
// the same spot regardless).
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

const SYRUP_MOVE_MS = 350; // time to glide to the hover spot
// How long 'pouring' holds -- the whole balance-minigame window (see
// SYRUP_MIX_BAR_WIDTH below) -- before gliding back home. Originally matched
// MatchaMaking's own WHISK_MIX_DURATION_MS (10s) exactly, but per request
// shortened to ~5s for syrup specifically -- felt like it "didn't stop" at
// the full whisking-length window. No longer a straight copy of that value.
const SYRUP_POUR_MS = 5000;
// Max % the bottle (and stream) can be nudged off-center in either
// direction -- no longer a manual per-keypress step (see SYRUP_MIX_BAR_WIDTH
// below), just the clamp range the balance minigame's ball position gets
// mapped into.
const SYRUP_MOVE_RANGE = 8;

// Colors for the falling syrup stream -- reused directly (no extra alpha
// adjustment) for .cup-syrup-fill's own gradient solid-color stop too,
// same "one palette, one source of truth" idea as MatchaMaking's
// SCOOP_FILL_COLORS/scoopColor.
const SYRUP_STREAM_COLORS = {
  'guava-syrup': 'rgba(224, 90, 111, 0.92)',
  'mint-syrup': 'rgba(101, 196, 155, 0.9)',
  // Honey-amber, sampled from HoneySyrup.png's own bottle-label color, same
  // "one palette, one source of truth" idea as the other two.
  'honey-syrup': 'rgba(214, 158, 46, 0.92)',
  // Sampled from each bottle's own art the same way -- mango's golden-orange,
  // lavender's soft purple, peach's coral-orange.
  'mango-syrup': 'rgba(237, 168, 47, 0.92)',
  'lavender-syrup': 'rgba(181, 156, 214, 0.92)',
  'peach-syrup': 'rgba(237, 149, 116, 0.92)',
};

// ---- Syrup pour balance minigame ------------------------------------------
// Same "keep a ball inside the green zone using Left/Right, or it drifts off
// and spills" challenge as MatchaMaking's own whisking minigame (see that
// file's own big comment above MIX_BAR_WIDTH for the full physics model and
// why "held" is tracked via a grace window rather than keyup) -- reused here
// for syrup specifically, not foam/powder, per request, since syrup is the
// one topping pair here that's an actual poured liquid. Per request, this is
// meant to feel IDENTICAL to the whisking challenge, not just similar --
// every physics constant below is a straight copy of MatchaMaking's own
// MIX_* value (not independently tuned) -- only SYRUP_POUR_MS itself (the
// overall window length, not the physics feel) has since been shortened to
// ~5s per request, rather than matching WHISK_MIX_DURATION_MS's 10s.
// REPLACES the old purely-cosmetic Left/Right aim
// effect (pourOffset stepped by a fixed SYRUP_MOVE_STEP per keypress, with
// no gameplay effect) -- pourOffset is now DERIVED from the ball's own
// position every tick instead (see the physics effect in the component
// below), so the falling stream/flipped bottle still visually track
// Left/Right, just as a side effect of the real minigame now.
const SYRUP_MIX_BAR_WIDTH = 20; // % of container -- narrower than MatchaMaking's own MIX_BAR_WIDTH (26) to fit comfortably above this station's smaller drink (purely a layout fit, not a physics constant, so this one's NOT a straight copy)
const SYRUP_MIX_BAR_HEIGHT = 3.2;
// Extra clearance above SYRUP_HOVER_GAP's own hovering/flipped bottle,
// which sits at this same moment right above the drink -- keeps the bar
// from overlapping it.
const SYRUP_MIX_BAR_CLEARANCE = 7;
function getSyrupMixBarPos() {
  return {
    left: INCOMING_DRINK_SPOT.left + INCOMING_DRINK_SIZE.width / 2 - SYRUP_MIX_BAR_WIDTH / 2,
    top: INCOMING_DRINK_SPOT.top - SYRUP_MIX_BAR_HEIGHT - SYRUP_MIX_BAR_CLEARANCE,
  };
}
// Matches MatchaMaking's own MIX_ZONE_WIDTH_FRAC exactly -- see this
// section's own big comment above for why these are straight copies now.
const SYRUP_MIX_ZONE_WIDTH_FRAC = 0.26;
const SYRUP_MIX_ZONE_LEFT_FRAC = (1 - SYRUP_MIX_ZONE_WIDTH_FRAC) / 2;
const SYRUP_MIX_BALL_WIDTH_FRAC = 0.06; // matches MatchaMaking's own MIX_BALL_WIDTH_FRAC
const SYRUP_MIX_HOLD_ACCEL = 150; // matches MatchaMaking's own MIX_HOLD_ACCEL
const SYRUP_MIX_HOLD_GRACE_MS = 150; // matches MatchaMaking's own MIX_HOLD_GRACE_MS
const SYRUP_MIX_DRIFT_AMPLITUDE = 34; // matches MatchaMaking's own MIX_DRIFT_AMPLITUDE
const SYRUP_MIX_DRIFT_ANGULAR_FREQ = 1.3; // matches MatchaMaking's own MIX_DRIFT_ANGULAR_FREQ
const SYRUP_MIX_FRICTION_HALF_LIFE_S = 0.35; // matches MatchaMaking's own MIX_FRICTION_HALF_LIFE_S
const SYRUP_MIX_SPILL_INTERVAL_MS = 550; // matches MatchaMaking's own MIX_SPILL_INTERVAL_MS

// ---- Syrup spill blobs -- one per mess-up (up to SYRUP_SPILL_STAGE_COUNT),
// on whichever side of the drink the ball actually drifted toward -- same
// escalating-puddle-trail idea as MatchaMaking's own PNG-based spill
// puddles (see its RIGHT_SPILL_BASE/LEFT_SPILL_BASE/SPILL_SLOT_STEP, which
// SYRUP_RIGHT_SPILL_BASE/SYRUP_LEFT_SPILL_BASE/SYRUP_SPILL_SLOT_STEP below
// mirror). Per request, these reuse that SAME Spill1-4.png hand-drawn art
// (the 'cafe-grade' set -- the original, unrecolored art MatchaMaking's own
// classic-grade/ceremonial-grade sets are themselves derived from) rather
// than a shape drawn here from scratch, just tinted to whichever syrup is
// actually pouring (SYRUP_STREAM_COLORS) instead of matcha's own green.
// Recoloring an arbitrary PNG to a runtime color isn't something a plain
// <img> can do -- the trick is rendering a <div> with the PNG set as a CSS
// mask (mask-image) instead of a src, and a background-color behind that
// mask: the mask clips the div down to exactly the art's own opaque shape,
// and the background-color shows through only inside that shape, in
// whatever color gets set inline per spill (see .syrup-spill-puddle in
// ToppingsStation.css for the mask properties themselves).
const SYRUP_SPILL_STAGE_COUNT = 4;
const SYRUP_SPILL_IMAGES = ['./Spill1.png', './Spill2.png', './Spill3.png', './Spill4.png'];
// Each PNG's own native pixel size -- copied directly from MatchaMaking.js's
// own SPILL_IMAGE_DIMS (measured off these exact same source files) so the
// mask isn't stretched/distorted away from its real shape.
const SYRUP_SPILL_IMAGE_DIMS = [
  { width: 102, height: 85 },
  { width: 123, height: 136 },
  { width: 275, height: 206 },
  { width: 238, height: 193 },
];
// Rendered height (as a % of the container), one per stage -- copied
// directly from MatchaMaking.js's own SPILL_STAGE_HEIGHTS/SPILL_STAGE_
// ROTATIONS for the exact same "escalating size/rotation per stage" look,
// same "identical feel" request the minigame's own physics constants
// already follow. SYRUP_SPILL_DIMS derives width from height the same
// width-from-height aspect-ratio conversion this project uses throughout
// (see BOTTLE_WIDTH's comment in MilkSelection.js).
const SYRUP_SPILL_STAGE_HEIGHTS = [5, 6.2, 7.5, 9];
const SYRUP_SPILL_STAGE_ROTATIONS = [-8, 10, -6, 5];
const SYRUP_SPILL_DIMS = SYRUP_SPILL_STAGE_HEIGHTS.map((heightPercent, i) => ({
  height: heightPercent,
  width: (heightPercent * (SYRUP_SPILL_IMAGE_DIMS[i].width / SYRUP_SPILL_IMAGE_DIMS[i].height)) / (16 / 9),
}));
const SYRUP_RIGHT_SPILL_BASE = { leftFrac: 1.08, topFrac: 0.82 };
const SYRUP_LEFT_SPILL_BASE = { leftFrac: -0.08, topFrac: 0.82 };
const SYRUP_SPILL_SLOT_STEP = { leftFrac: 0.05, topFrac: 0.07 };
// Once all SYRUP_SPILL_STAGE_COUNT blobs are down, further mess-ups grow
// them together instead of stacking indefinitely -- same SPILL_GROWTH_STEP/
// SPILL_GROWTH_CAP idea as MatchaMaking's own spillGrowth.
const SYRUP_SPILL_GROWTH_STEP = 0.08;
const SYRUP_SPILL_GROWTH_CAP = 1.5;

// The bottom portion of the milk box's own shape (see getMilkBoxFor in
// MilkSelection.js) -- covers the bottom SYRUP_HEIGHT_FRAC of it, anchored
// to the milk box's actual bottom edge (there's no "raise" zone the way
// matcha has one, since syrup doesn't need to raise the drink's overall
// fill line, just tint the bottom of what's already there).
const SYRUP_HEIGHT_FRAC = 0.4;
// Exported (alongside the other box-math helpers below) so
// FinalCombination.js can re-derive the exact same fill boxes for its own
// carried-over drink display, same "generic, parameterized, exported for
// the next screen" pattern as MilkSelection.js's own getMilkBoxFor/
// getMatchaBoxFor.
export function getSyrupBoxFor(milkBox) {
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
// wider, higher-up) fractions above instead of matcha's. Exported for
// FinalCombination.js, same reasoning as getSyrupBoxFor's own export above.
export function getFoamBoxFor(topBox) {
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
// Exported for FinalCombination.js, same reasoning as getSyrupBoxFor's own
// export above.
export function getFoamCapBoxFor(foamBox) {
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
// How far off-center a missed lever catch can land the poured foam -- same
// number the old cosmetic Left/Right aim used to clamp to (FOAM_MOVE_STEP,
// the old per-keypress nudge, is gone now that the lever drives this
// directly instead of stepped keypresses).
const FOAM_MOVE_RANGE = 8;

// Colors for the falling foam stream -- reused directly for the
// .cup-foam-fill/.cup-foam-cap color modifier classes too (see
// ToppingsStation.css), same "one palette, one source of truth" idea as
// SYRUP_STREAM_COLORS. Sampled from each PNG's own average opaque pixel
// color (MatchaColdFoam.png -> pale sage green, RegColdFoam.png -> creamy
// white) so the poured fill reads as the same substance as its bottle art.
const FOAM_STREAM_COLORS = {
  'matcha-cold-foam': 'rgba(200, 213, 171, 0.95)',
  'reg-cold-foam': 'rgba(234, 232, 227, 0.95)',
  // Banana-yellow, same family as the banana-foam bottle's own art.
  'banana-foam': 'rgba(240, 219, 137, 0.95)',
  // Strawberry-pink/blueberry-blue, same "matches the bottle art" reasoning.
  'strawberry-foam': 'rgba(247, 175, 199, 0.95)',
  'blueberry-foam': 'rgba(138, 152, 214, 0.95)',
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
// Same "lever drives this directly now" note as FOAM_MOVE_RANGE's own
// comment above -- the old POWDER_MOVE_STEP per-keypress nudge is gone.
const POWDER_MOVE_RANGE = 8;

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
  // Chocolate-brown, sampled from ChocoPowder.png's own label color.
  'choco-powder': 'rgba(94, 58, 42, 0.95)',
};

// ---- Shared aim-lever minigame (foam/powder/mint-leaves placement) -------
// Per request: foam, powder, and mint-leaf placement -- everything topping-
// related except syrup, which already has its own balance minigame (see the
// big comment above SYRUP_MIX_BAR_WIDTH) -- now go through a single "catch
// the moving lever" challenge instead of the old purely-cosmetic Left/Right
// aim-while-pouring (foamPourOffset/powderPourOffset used to be free-form
// player-adjustable during 'pouring' with no scoring or placement effect
// attached at all -- see FOAM_MOVE_STEP's own comment). A small marker
// sweeps left-right along a bar above the drink (sine wave, same style of
// oscillation math as the syrup balance minigame's own drift term, just
// driving the marker's whole position here instead of a small perturbation);
// pressing Enter locks in wherever it currently reads. Landing within
// LEVER_CENTER_TOLERANCE of dead center places the topping perfectly
// centered with full credit and no spill; landing further off shifts the
// FINAL landed topping off-center on the drink (reusing each topping's own
// existing *_MOVE_RANGE for how far, same range the old cosmetic aim used)
// AND spills some of it onto the counter (see leverMissFor and the
// foamSpill/powderSpill/leafSpill render-time values in the component
// below), with credit tapering the further off-center the catch landed --
// see gameloop/scoring.js's own scoreToppings for the graduated math.
//
// This is a deliberate departure from syrup/foam/powder's own established
// "aim is purely cosmetic, the poured fill always lands centered regardless"
// convention (see getSyrupBoxFor's own comment) -- per this request, a bad
// catch here is supposed to visibly, actually mess up the drink, not just
// the falling stream's cosmetic path.
//
// One shared state machine (leverStage/leverFor below), not three separate
// ones, since canPourFoam/canPourPowder/canPlaceLeaf are already mutually
// exclusive with each other (and with syrup) -- only one of these can ever
// be waiting on a catch at a time.
const LEVER_PERIOD_MS = 3200; // one full left-right-left sweep of the marker
const LEVER_AMPLITUDE_PCT = 42; // how far the marker's center swings from dead-center (50%) of the bar, in % of the bar's own width
const LEVER_CENTER_TOLERANCE = 0.12; // |offsetFrac| (see below) within this counts as "hit the middle" -- full credit, no spill
const LEVER_MARKER_WIDTH_FRAC = 0.06; // matches MatchaMaking's own MIX_BALL_WIDTH_FRAC/SYRUP_MIX_BALL_WIDTH_FRAC
const LEVER_BAR_WIDTH = 20; // % of container -- matches SYRUP_MIX_BAR_WIDTH
const LEVER_BAR_HEIGHT = 3.2; // matches SYRUP_MIX_BAR_HEIGHT
const LEVER_BAR_CLEARANCE = 7; // matches SYRUP_MIX_BAR_CLEARANCE -- clears whichever bottle/tin is hovering at this same spot for foam/powder (mint-leaves has no hovering sprite, so this is just extra breathing room there)
function getLeverBarPos() {
  return {
    left: INCOMING_DRINK_SPOT.left + INCOMING_DRINK_SIZE.width / 2 - LEVER_BAR_WIDTH / 2,
    top: INCOMING_DRINK_SPOT.top - LEVER_BAR_HEIGHT - LEVER_BAR_CLEARANCE,
  };
}

// How far off-center mint-leaves placement can land -- own copy of the same
// idea as FOAM_MOVE_RANGE/POWDER_MOVE_RANGE above (there's no cosmetic-aim
// history to inherit this number from, since the leaf never had one before
// this minigame).
const LEAF_MOVE_RANGE = 8;
// Same idea, own copies, for the two newer standalone garnishes.
const CHIP_MOVE_RANGE = 8;
const BLOSSOM_MOVE_RANGE = 8;
// A fresh leaf-green for the leaf's own spill puddle (see FOAM_STREAM_COLORS/
// POWDER_STREAM_COLORS above for the same per-topping-type color role) --
// deliberately not reusing SYRUP_STREAM_COLORS['mint-syrup'] even though
// both are mint-adjacent greens, so a leaf spill still reads as its own
// thing next to an actual mint-syrup spill if both ever show up in the same
// round.
const LEAF_SPILL_COLOR = 'rgba(90, 140, 70, 0.92)';
// Same idea for the two newer standalone garnishes -- their own colors
// (banana-chip tan, cherry-blossom pink) rather than reusing an existing
// syrup/foam one, same "reads as its own thing" reasoning as LEAF_SPILL_COLOR.
const CHIP_SPILL_COLOR = 'rgba(196, 148, 74, 0.92)';
const BLOSSOM_SPILL_COLOR = 'rgba(232, 173, 191, 0.92)';

// Given a topping's own resolved lever-catch offset (in the same physical
// %-of-container units as foamPourOffset/powderPourOffset/leafPourOffset)
// and that topping's own *_MOVE_RANGE, returns null for a centered catch
// (nothing spills) or { side, bucket } for a missed one -- side is which
// way it missed (for which of SYRUP_RIGHT_SPILL_BASE/SYRUP_LEFT_SPILL_BASE
// to spill toward, reused directly from the syrup section above since that
// positioning math isn't actually syrup-specific), bucket (0-3) is how bad
// the miss was, indexing directly into SYRUP_SPILL_DIMS/SYRUP_SPILL_IMAGES/
// SYRUP_SPILL_STAGE_ROTATIONS (also reused directly) for an escalating
// size/shape/rotation the same way MatchaMaking's own whisking spills and
// the syrup balance minigame's own spills already scale with severity --
// just derived here from a single catch's distance from center instead of
// an accumulating mess-up count, since this is a one-shot catch, not a
// continuous minigame.
function leverMissFor(offset, moveRange) {
  const offsetFrac = moveRange ? offset / moveRange : 0;
  const distance = Math.abs(offsetFrac);
  if (distance <= LEVER_CENTER_TOLERANCE) return null;
  const severity = Math.min(1, (distance - LEVER_CENTER_TOLERANCE) / (1 - LEVER_CENTER_TOLERANCE));
  const bucket = Math.min(SYRUP_SPILL_STAGE_COUNT - 1, Math.floor(severity * SYRUP_SPILL_STAGE_COUNT));
  return { side: offsetFrac < 0 ? 'left' : 'right', bucket };
}

// Renders one spill puddle for a missed foam/powder/leaf lever catch --
// same mask-image tinting technique and SYRUP_SPILL_DIMS/SYRUP_SPILL_IMAGES/
// SYRUP_SPILL_STAGE_ROTATIONS/SYRUP_RIGHT_SPILL_BASE/SYRUP_LEFT_SPILL_BASE
// the syrup spill block already uses (none of that math is actually syrup-
// specific despite the name -- see leverMissFor's own comment above), just
// for a single one-shot catch instead of an accumulating mess-up array, and
// its own .topping-spill-puddle class in ToppingsStation.css (an identical
// copy of .syrup-spill-puddle's own rules) so the two don't share a literal
// class name despite being visually the same kind of thing. Returns null
// (nothing rendered) for a null spill, i.e. a centered catch.
function renderToppingSpill(spill, color, key) {
  if (!spill) return null;
  const base = spill.side === 'right' ? SYRUP_RIGHT_SPILL_BASE : SYRUP_LEFT_SPILL_BASE;
  const dims = SYRUP_SPILL_DIMS[spill.bucket];
  const maskUrl = `url(${SYRUP_SPILL_IMAGES[spill.bucket]})`;
  return (
    <span
      key={key}
      aria-hidden="true"
      className="topping-spill-puddle"
      style={{
        left: `${INCOMING_DRINK_SPOT.left + base.leftFrac * INCOMING_DRINK_SIZE.width}%`,
        top: `${INCOMING_DRINK_SPOT.top + base.topFrac * INCOMING_DRINK_SIZE.height}%`,
        width: `${dims.width}%`,
        height: `${dims.height}%`,
        background: color,
        WebkitMaskImage: maskUrl,
        maskImage: maskUrl,
        transform: `translate(-50%, -50%) rotate(${SYRUP_SPILL_STAGE_ROTATIONS[spill.bucket]}deg)`,
      }}
    />
  );
}

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
// Both offset sets and getFleckPositions/getPowderLiquidBoxFor below are
// exported for FinalCombination.js, same reasoning as getSyrupBoxFor's own
// export above -- the carried-over drink there needs to reproduce the
// exact same powder-fleck placement, not just the fill layers.
export const POWDER_FLECK_OFFSETS_ELLIPSE = [
  { dx: 0, dy: 0 },
  { dx: -0.28, dy: -0.05 },
  { dx: 0.3, dy: 0.02 },
  { dx: -0.15, dy: 0.22 },
  { dx: 0.17, dy: -0.2 },
  { dx: -0.05, dy: -0.28 },
  { dx: 0.08, dy: 0.28 },
  { dx: -0.32, dy: 0.12 },
];
export const POWDER_FLECK_OFFSETS_LIQUID = [
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
export function getFleckPositions(box, offsets) {
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
export function getPowderLiquidBoxFor(topBox, milkBox) {
  return {
    left: milkBox.left,
    top: topBox.top,
    width: milkBox.width,
    height: milkBox.top + milkBox.height - topBox.top,
  };
}

// ---- Mint leaves pot: pick up a leaf, place it on the drink ------------
// New order-3-and-later garnish, sitting directly below the powder pair on
// the table (per request), right-anchored the same as that pair so its own
// right edge lines up with guava-powder's. canvasAspect (299/278) is its
// own PNG's opaque bounding box (9,12-308,290 out of a 312x294 canvas),
// same "trim the padding, measure what's left" convention as every other
// topping item. POT_HEIGHT is a touch taller than the powder pair's own
// POWDER_HEIGHT -- eyeballed, no reference for how a squat pot should read
// next to two slim tins.
//
// Unlike the syrup/foam/powder items above, the pot itself never moves and
// isn't draggable -- it's a fixed, D-pad-selectable prop (same ".selectable"
// treatment MatchaMaking.js's own grade tins use: keyboard/D-pad Enter
// only, no mouse-drag mechanic) that, on Enter, "gives" the player a leaf
// after a short pause (LEAF_PLACE_MS, purely for pacing -- same beat every
// other topping's own moving/pouring stage already has) which then appears
// resting on top of the drink. There's no draggable "leaf in transit"
// sprite (the syrup/foam/powder bottles have one because THEY are the
// thing being carried and re-carried every use; a leaf is a one-shot
// garnish, not a reusable bottle) -- see beginLeafPlace/leafStage in the
// component below.
const MINT_LEAVES_POT_ITEM = {
  key: 'mint-leaves-pot',
  src: './MintLeavesBowl.png',
  alt: 'Pot of mint leaves',
  canvasAspect: 299 / 278,
};
// Banana chips (order 4+) and cherry blossoms (order 5+) -- two more
// standalone garnishes, same "own bowl, own one-shot pickup" shape as mint
// leaves (see the big comment above MINT_LEAVES_POT_ITEM), per a later
// request that every order's own unlocks stack rather than replace one
// another. Each sits to the LEFT of the previous pot once it joins (see
// POT_PAIR_WITH_CHIPS/_WITH_BLOSSOMS and POT_ITEMS_BASE/_WITH_CHIPS/
// _WITH_BLOSSOMS below, right-anchored the same way SYRUP/FOAM/POWDER rows
// grow) rather than stacking vertically -- there isn't the vertical room
// below the powder pair for three more stacked pots the height of
// MINT_LEAVES_POT_ITEM. canvasAspect for both (491/455, 492/456) is their
// own raw canvas' opaque bounding box, same "trim the padding, measure
// what's left" convention as MINT_LEAVES_POT_ITEM's own 299/278.
const BANANA_CHIPS_POT_ITEM = {
  key: 'banana-chips-pot',
  src: './BananaChipsBowl.png',
  alt: 'Bowl of banana chips',
  canvasAspect: 491 / 455,
};
const CHERRY_BLOSSOMS_POT_ITEM = {
  key: 'cherry-blossoms-pot',
  src: './CherryBlossomsBowl.png',
  alt: 'Bowl of cherry blossoms',
  canvasAspect: 492 / 456,
};
const POT_HEIGHT = POWDER_HEIGHT * 1.15;
const POT_GAP = 3; // vertical gap below the powder pair's own bottom edge (TOPPING_ROW_BOTTOM)
// Same "precompute every tier, pick one per customerNumber" pattern as the
// syrup/foam/powder rows above -- picked via potItems in the component
// below. mint-leaves-pot alone (order 2+, per mintLeavesUnlocked there) is
// still the ONLY pot on orders 2-3; banana-chips-pot joins at order 4,
// cherry-blossoms-pot at order 5 -- growing this row right-to-left the same
// way layoutPair's own right-anchor already grows the powder row when a new
// item is appended.
const POT_PAIR_BASE = [MINT_LEAVES_POT_ITEM];
const POT_PAIR_WITH_CHIPS = [...POT_PAIR_BASE, BANANA_CHIPS_POT_ITEM];
const POT_PAIR_WITH_BLOSSOMS = [...POT_PAIR_WITH_CHIPS, CHERRY_BLOSSOMS_POT_ITEM];
const POT_ITEMS_BASE = layoutPair(POT_PAIR_BASE, POT_HEIGHT, TOPPING_ROW_BOTTOM + POT_GAP, TIGHT_PAIR_GAP, {
  type: 'right',
  x: 100 - EDGE_MARGIN,
});
const POT_ITEMS_WITH_CHIPS = layoutPair(POT_PAIR_WITH_CHIPS, POT_HEIGHT, TOPPING_ROW_BOTTOM + POT_GAP, TIGHT_PAIR_GAP, {
  type: 'right',
  x: 100 - EDGE_MARGIN,
});
const POT_ITEMS_WITH_BLOSSOMS = layoutPair(
  POT_PAIR_WITH_BLOSSOMS,
  POT_HEIGHT,
  TOPPING_ROW_BOTTOM + POT_GAP,
  TIGHT_PAIR_GAP,
  { type: 'right', x: 100 - EDGE_MARGIN }
);

// How long Enter-on-the-pot takes before the leaf actually appears on the
// drink -- purely a pacing beat (there's no visible travel to time this
// against, unlike SYRUP_MOVE_MS/FOAM_MOVE_MS/POWDER_MOVE_MS, which each
// have to at least cover their own bottle's CSS glide).
const LEAF_PLACE_MS = 400;

// The leaf's own resting size -- small, a garnish, not a bottle -- and
// where it lands: perched at the top-center of whichever box is currently
// the drink's own topmost layer (topBox -- the foam cap if foam's already
// been poured, otherwise the matcha/milk layer itself; same "whichever
// box is on top" reasoning the foam section above already uses for its own
// topBox parameter), mostly floating above that layer's own top edge with
// only a small dip down into it, like a leaf laid across the drink's
// surface rather than a poured fill. canvasAspect (88/45) is MintLeaf.png's
// own opaque bounding box (1,2-89,47 out of a 90x48 canvas). Exported for
// FinalCombination.js, same reasoning as this file's other box-math
// helpers (getSyrupBoxFor, getFoamBoxFor, etc.) above.
const LEAF_HEIGHT = 6; // % of container height
const LEAF_CANVAS_ASPECT = 88 / 45;
const LEAF_WIDTH = LEAF_HEIGHT * LEAF_CANVAS_ASPECT * (9 / 16);
const LEAF_DIP_FRAC = 0.15; // portion of the leaf's own height that dips below topBox's own top edge
// offset (default 0, same default-param backward-compatibility shape as
// every other optional-parameter addition in this project) is the leaf's
// own resolved lever-catch offset -- see LEAF_MOVE_RANGE/leafPourOffset in
// the component below. Added on top of the centered left math below rather
// than replacing it, same "shift, don't recompute" approach the milk pour
// gauge's own cup fill scale uses.
export function getLeafBoxFor(topBox, offset = 0) {
  return {
    left: topBox.left + topBox.width / 2 - LEAF_WIDTH / 2 + offset,
    top: topBox.top - LEAF_HEIGHT * (1 - LEAF_DIP_FRAC),
    width: LEAF_WIDTH,
    height: LEAF_HEIGHT,
  };
}

// ---- Banana chips/cherry blossoms: same one-shot-garnish shape as the
// mint leaf above (own pot, own lever-catch, no draggable "in transit"
// sprite), just their own resting size/aspect and their own single-piece
// PNG (BananaChip.png/CherryBlossom.png -- the whole-bowl BananaChipsBowl.png/
// CherryBlossomsBowl.png above are the POT art, not what lands on the
// drink). canvasAspect for each is its own raw canvas' opaque bounding box,
// same convention as LEAF_CANVAS_ASPECT.
const CHIP_HEIGHT = 6; // % of container height, same as LEAF_HEIGHT
const CHIP_CANVAS_ASPECT = 606 / 443; // BananaChip.png's own opaque bbox (201,253-807,696 out of a 1062x938 canvas)
const CHIP_WIDTH = CHIP_HEIGHT * CHIP_CANVAS_ASPECT * (9 / 16);
const CHIP_DIP_FRAC = 0.15;
export function getChipBoxFor(topBox, offset = 0) {
  return {
    left: topBox.left + topBox.width / 2 - CHIP_WIDTH / 2 + offset,
    top: topBox.top - CHIP_HEIGHT * (1 - CHIP_DIP_FRAC),
    width: CHIP_WIDTH,
    height: CHIP_HEIGHT,
  };
}

const BLOSSOM_HEIGHT = 6;
const BLOSSOM_CANVAS_ASPECT = 446 / 424; // CherryBlossom.png's own opaque bbox (35,30-481,454 out of a 515x485 canvas)
const BLOSSOM_WIDTH = BLOSSOM_HEIGHT * BLOSSOM_CANVAS_ASPECT * (9 / 16);
const BLOSSOM_DIP_FRAC = 0.15;
export function getBlossomBoxFor(topBox, offset = 0) {
  return {
    left: topBox.left + topBox.width / 2 - BLOSSOM_WIDTH / 2 + offset,
    top: topBox.top - BLOSSOM_HEIGHT * (1 - BLOSSOM_DIP_FRAC),
    width: BLOSSOM_WIDTH,
    height: BLOSSOM_HEIGHT,
  };
}

const ToppingsStation = ({
  activeStep,
  customerNumber,
  onNavigate,
  onAdvance,
  order,
  incomingDrink,
  onSendToFinal,
  onScored,
}) => {
  const containerRef = useRef(null);

  // Traps the syrup pair's own nav (see the mint-syrup/guava-syrup legs of
  // the nav-graph effect below) down to just Left/Right cycling between the
  // two of them during the first-order walkthrough's own syrup-picking beat
  // (showSyrupSpotlight, declared much further down) -- per request, the
  // player shouldn't be able to arrow away from the syrup pair at all
  // during that beat. Declared here (rather than only where
  // showSyrupSpotlight itself lives) so the nav-graph effect -- which has
  // to be registered before useFlatFocusNav for the same ordering reasons
  // as every leg of that graph -- can read the CURRENT value without
  // needing showSyrupSpotlight in its own dependency array. Kept in sync
  // every render by a small effect declared right after showSyrupSpotlight
  // itself, same "ref declared early, synced late" pattern MilkSelection.js
  // uses for its own restrict*NavRef refs.
  const restrictSyrupNavRef = useRef(false);

  // Same idea again, for the foam pair during the first-order walkthrough's
  // own foam-picking beat (showFoamSpotlight, declared much further down)
  // -- per request, the player shouldn't be able to arrow away from the
  // foam pair at all during that beat, only cycle Left/Right between
  // matcha-cold-foam and reg-cold-foam. Kept in sync the same "ref declared
  // early, synced late" way, by a small effect declared right after
  // showFoamSpotlight itself.
  const restrictFoamNavRef = useRef(false);

  // Same idea again, for the powder pair during the first-order
  // walkthrough's own powder-picking beat (showPowderSpotlight, declared
  // much further down) -- per request, the player shouldn't be able to
  // arrow away from the powder pair at all during that beat, only cycle
  // Left/Right between matcha-powder and guava-powder. Kept in sync the
  // same "ref declared early, synced late" way, by a small effect declared
  // right after showPowderSpotlight itself.
  const restrictPowderNavRef = useRef(false);

  // Every order's own new toppings now stack on top of the last (per a
  // later request -- nothing ever drops off the counter again). Banana
  // foam/honey syrup/mint leaves unlock together at order 2 (previously
  // staggered across orders 2/3); mango syrup/choco powder at order 3;
  // lavender syrup/strawberry foam/banana chips at order 4; peach syrup/
  // blueberry foam/cherry blossoms at order 5 (the session's last order,
  // see ORDERS_PER_SESSION in ProgressBar.js). Same "precompute every tier,
  // pick one per customerNumber" gating as MilkSelection's own
  // strawberryUnlocked/bottleItems. Since App.js only ever mounts one
  // station component at a time (see the identical caveat on
  // strawberryUnlocked in MilkSelection.js), customerNumber is fixed for
  // this component's whole mounted lifetime, so a plain read here (no
  // memoization) is safe.
  const bananaFoamUnlocked = customerNumber >= 2;
  const honeySyrupUnlocked = customerNumber >= 2;
  const mintLeavesUnlocked = customerNumber >= 2;
  const mangoSyrupUnlocked = customerNumber >= 3;
  const chocoPowderUnlocked = customerNumber >= 3;
  const lavenderSyrupUnlocked = customerNumber >= 4;
  const strawberryFoamUnlocked = customerNumber >= 4;
  const bananaChipsUnlocked = customerNumber >= 4;
  const peachSyrupUnlocked = customerNumber >= 5;
  const blueberryFoamUnlocked = customerNumber >= 5;
  const cherryBlossomsUnlocked = customerNumber >= 5;
  // Each row (syrup/foam/powder) unlocks independently now that they no
  // longer all advance together -- see SYRUP_ITEMS_*/FOAM_ITEMS_*/
  // POWDER_ITEMS_* above. toppingItems (the combined pour-mechanic list the
  // rest of this file already reads) is just their concatenation, same
  // shape TOPPING_ITEMS_ORDER1/2/3 used to be precomputed as, just built
  // per-render from the three independent picks instead.
  const syrupItems = peachSyrupUnlocked
    ? SYRUP_ITEMS_WITH_PEACH
    : lavenderSyrupUnlocked
    ? SYRUP_ITEMS_WITH_LAVENDER
    : mangoSyrupUnlocked
    ? SYRUP_ITEMS_WITH_MANGO
    : honeySyrupUnlocked
    ? SYRUP_ITEMS_WITH_HONEY
    : SYRUP_ITEMS_BASE;
  const foamItems = blueberryFoamUnlocked
    ? FOAM_ITEMS_WITH_BLUEBERRY
    : strawberryFoamUnlocked
    ? FOAM_ITEMS_WITH_STRAWBERRY
    : bananaFoamUnlocked
    ? FOAM_ITEMS_WITH_BANANA
    : FOAM_ITEMS_BASE;
  const powderItems = chocoPowderUnlocked ? POWDER_ITEMS_WITH_CHOCO : POWDER_ITEMS_BASE;
  // Bug fix: this used to be a plain `[...powderItems, ...syrupItems,
  // ...foamItems]` array literal, rebuilt fresh (new reference, even though
  // never different contents within one customer) on every single render.
  // toppingItems sits in the dependency array of the syrup/foam/powder
  // pourStage transition effects below (each has its own setTimeout that
  // hands the pour back to 'idle' after SYRUP_POUR_MS/FOAM_POUR_MS/
  // POWDER_POUR_MS) -- and the syrup balance minigame's own physics tick
  // calls setPourOffset/setSyrupSpills/setSyrupSpillGrowth every animation
  // frame while pouring, so the component was re-rendering ~60x/second
  // during a syrup pour. Every one of those re-renders created a new
  // toppingItems reference, which re-ran the transition effect (cleanup +
  // restart, replaying the pour SFX too), clearing the pending setTimeout
  // and rescheduling a brand-new one before it could ever fire -- so the
  // pour never actually stopped. useMemo keyed on the three (already
  // reference-stable, since each is just a ternary pick of module-level
  // constant arrays) inputs keeps this array's identity stable across
  // renders unless the unlocked set genuinely changes.
  const toppingItems = useMemo(
    () => [...powderItems, ...syrupItems, ...foamItems],
    [powderItems, syrupItems, foamItems]
  );
  // The pot row (mint-leaves-pot, then banana-chips-pot, then
  // cherry-blossoms-pot) -- kept separate from toppingItems, same as before
  // (it was never part of TOPPING_ITEMS_ORDER1/2/3 either), since it's a
  // different mechanic (one-shot pickup, not a reusable pour) that the rest
  // of this file's syrup/foam/powder-focused helpers don't need to know
  // about.
  const potItems = cherryBlossomsUnlocked
    ? POT_ITEMS_WITH_BLOSSOMS
    : bananaChipsUnlocked
    ? POT_ITEMS_WITH_CHIPS
    : POT_ITEMS_BASE;

  // This station's own explicit keyboard nav graph, per request -- same
  // "exact fixed graph, not generic spatial nearest-neighbor matching"
  // approach as every other frame's own graph. Starting legs: station dot
  // Up -> the carried-over cup; cup Left -> reg-cold-foam (the "white"
  // foam -- closer to center, since FOAM_PAIR_BASE/_WITH_BANANA's own
  // layoutPair always places index 0, matcha-cold-foam, further left and
  // index 1, reg-cold-foam, to its right/closer in), Left again from there
  // -> matcha-cold-foam (the green one, further out); cup Right ->
  // matcha-powder (closer to center within POWDER_PAIR, same reasoning),
  // Right again from there -> guava-powder (further out). More legs to be
  // added here as the rest of this frame's nav gets worked out.
  //
  // None of the syrup/foam/powder pairs (or the cup) had any distinguishing
  // class of their own to query by (all three pairs, plus the cup, share
  // the exact same .station-item.movable class) -- data-topping-key was
  // added to each of their own JSX (see the syrup/foam/powder render
  // blocks and the cup below) purely so this effect can look them up
  // reliably by key instead of guessing at DOM order across three separate
  // .filter(...).map(...) blocks.
  //
  // Registered before useFlatFocusNav(containerRef) below for the same
  // reason worked out for every other frame: useFlatFocusNav's own spatial
  // Up/Down/Left/Right handling calls focus() synchronously within the
  // same event dispatch, so if this effect attached its listener after
  // useFlatFocusNav's, a single keypress could let that generic hook move
  // focus first and then have this handler act again immediately after,
  // skipping a step. Registering this one first guarantees it only ever
  // sees focus as it was *before* any handler for this keypress has run.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Up' && action !== 'Down' && action !== 'Left' && action !== 'Right') return;
      const active = document.activeElement;

      const cup = containerRef.current?.querySelector('[data-topping-key="cup"]') ?? null;
      const regFoam = containerRef.current?.querySelector('[data-topping-key="reg-cold-foam"]') ?? null;
      const matchaFoam = containerRef.current?.querySelector('[data-topping-key="matcha-cold-foam"]') ?? null;
      // Only actually rendered from order 2 onward (see bananaFoamUnlocked
      // above) -- null before then, so the optional-chained focus() calls
      // below just no-op until then. strawberryFoam/blueberryFoam (order
      // 4+/5+) are the row's newer members, same "null until unlocked"
      // shape.
      const bananaFoam = containerRef.current?.querySelector('[data-topping-key="banana-foam"]') ?? null;
      const strawberryFoam = containerRef.current?.querySelector('[data-topping-key="strawberry-foam"]') ?? null;
      const blueberryFoam = containerRef.current?.querySelector('[data-topping-key="blueberry-foam"]') ?? null;
      const matchaPowder = containerRef.current?.querySelector('[data-topping-key="matcha-powder"]') ?? null;
      const guavaPowder = containerRef.current?.querySelector('[data-topping-key="guava-powder"]') ?? null;
      // Choco powder (order 3+) -- null before then.
      const chocoPowder = containerRef.current?.querySelector('[data-topping-key="choco-powder"]') ?? null;
      const guavaSyrup = containerRef.current?.querySelector('[data-topping-key="guava-syrup"]') ?? null;
      const mintSyrup = containerRef.current?.querySelector('[data-topping-key="mint-syrup"]') ?? null;
      // Only actually rendered from order 2 onward (see honeySyrupUnlocked/
      // mintLeavesUnlocked above) -- null before then, so the optional-
      // chained focus() calls below just no-op until either unlocks.
      // mangoSyrup/lavenderSyrup/peachSyrup (order 3+/4+/5+) are the syrup
      // row's newer members, same "null until unlocked" shape.
      const honeySyrup = containerRef.current?.querySelector('[data-topping-key="honey-syrup"]') ?? null;
      const mangoSyrup = containerRef.current?.querySelector('[data-topping-key="mango-syrup"]') ?? null;
      const lavenderSyrup = containerRef.current?.querySelector('[data-topping-key="lavender-syrup"]') ?? null;
      const peachSyrup = containerRef.current?.querySelector('[data-topping-key="peach-syrup"]') ?? null;
      const mintLeavesPot = containerRef.current?.querySelector('[data-topping-key="mint-leaves-pot"]') ?? null;
      // Banana-chips-pot (order 4+) and cherry-blossoms-pot (order 5+) --
      // the pot row's newer members, sitting to mint-leaves-pot's right once
      // unlocked (see POT_PAIR_WITH_CHIPS/_WITH_BLOSSOMS above).
      const bananaChipsPot = containerRef.current?.querySelector('[data-topping-key="banana-chips-pot"]') ?? null;
      const cherryBlossomsPot = containerRef.current?.querySelector('[data-topping-key="cherry-blossoms-pot"]') ?? null;
      const orderButton = document.querySelector('.order-receipt-button');
      const gearButton = document.querySelector('.settings-toggle-button');

      // Station dot -> cup.
      if (active === document.querySelector('.progress-step.current')) {
        if (action === 'Up') {
          e.preventDefault();
          e.stopImmediatePropagation();
          cup?.focus();
        }
        return;
      }

      // Cup: Left -> reg-cold-foam (white), Right -> matcha-powder, Down ->
      // station dot.
      if (active === cup) {
        if (action === 'Left') {
          e.preventDefault();
          e.stopImmediatePropagation();
          regFoam?.focus();
        } else if (action === 'Right') {
          e.preventDefault();
          e.stopImmediatePropagation();
          matchaPowder?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          document.querySelector('.progress-step.current')?.focus();
        }
        return;
      }

      // Reg-cold-foam (white): Left -> matcha-cold-foam (green, the only leg
      // still allowed once restrictFoamNavRef.current is true -- see its
      // own comment above), Right -> banana-foam (order 2+ only -- null on
      // order 1, when this restriction is the only time it ever applies
      // anyway), Up -> guava-syrup, Down -> station dot. Every action is
      // fully handled here (preventDefault/stopImmediatePropagation
      // unconditional) rather than partially falling through to
      // useFlatFocusNav's own generic spatial fallback, so the foam pair's
      // navigation is airtight regardless of restrictFoamNavRef, same shape
      // as the syrup pair's own mint-syrup/guava-syrup legs above.
      if (active === regFoam) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Per request: both foam bottles show the halo until the player's
        // first arrow press, then it collapses to just the focused one --
        // see foamSpotlightMoved's own comment above.
        setFoamSpotlightMoved(true);
        if (action === 'Left') {
          matchaFoam?.focus();
        } else if (!restrictFoamNavRef.current) {
          if (action === 'Right') {
            bananaFoam?.focus();
          } else if (action === 'Up') {
            guavaSyrup?.focus();
          } else if (action === 'Down') {
            document.querySelector('.progress-step.current')?.focus();
          }
        }
        return;
      }

      // Matcha-cold-foam (green): Right -> reg-cold-foam (the only leg
      // still allowed once restricted), Up -> guava-syrup (same target as
      // reg-cold-foam's own Up above -- the syrup pair sits directly above
      // the whole foam pair, not one-per-foam), Down -> station dot. Left is
      // trapped either way -- it's the leftmost item, nothing further left
      // to land on.
      if (active === matchaFoam) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setFoamSpotlightMoved(true);
        if (action === 'Right') {
          regFoam?.focus();
        } else if (!restrictFoamNavRef.current) {
          if (action === 'Up') {
            guavaSyrup?.focus();
          } else if (action === 'Down') {
            document.querySelector('.progress-step.current')?.focus();
          }
        }
        return;
      }

      // Banana-foam (order 2+, sits to the right of reg-cold-foam): Left ->
      // reg-cold-foam, Right -> strawberry-foam (order 4+ -- null before
      // then, so this traps same as it used to unconditionally), Up ->
      // guava-syrup (same shared target as every foam's own Up), Down ->
      // station dot.
      if (active === bananaFoam) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left') {
          regFoam?.focus();
        } else if (action === 'Right') {
          strawberryFoam?.focus();
        } else if (action === 'Up') {
          guavaSyrup?.focus();
        } else if (action === 'Down') {
          document.querySelector('.progress-step.current')?.focus();
        }
        return;
      }

      // Strawberry-foam (order 4+, sits to the right of banana-foam): Left
      // -> banana-foam, Right -> blueberry-foam (order 5+ -- null before
      // then, traps), Up -> guava-syrup, Down -> station dot.
      if (active === strawberryFoam) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left') {
          bananaFoam?.focus();
        } else if (action === 'Right') {
          blueberryFoam?.focus();
        } else if (action === 'Up') {
          guavaSyrup?.focus();
        } else if (action === 'Down') {
          document.querySelector('.progress-step.current')?.focus();
        }
        return;
      }

      // Blueberry-foam (order 5+, the row's last member): Left ->
      // strawberry-foam, Up -> guava-syrup, Down -> station dot. Right is
      // trapped -- it's the last item in the row.
      if (active === blueberryFoam) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left') {
          strawberryFoam?.focus();
        } else if (action === 'Up') {
          guavaSyrup?.focus();
        } else if (action === 'Down') {
          document.querySelector('.progress-step.current')?.focus();
        }
        return;
      }

      // Mint-syrup (now leftmost, per swap): Right -> guava-syrup (the only
      // leg still allowed once restrictSyrupNavRef.current is true -- see
      // its own comment above), Down -> matcha-cold-foam (same target as
      // guava-syrup's own Down below -- the whole foam pair sits directly
      // below the syrup pair, not one-per-syrup), Up -> settings (not the
      // order button -- unlike the powder pair, this pair's Up goes to the
      // gear directly). Left is trapped either way -- it's the leftmost
      // item, nothing further left to land on. Every action is fully
      // handled here (preventDefault/stopImmediatePropagation unconditional)
      // rather than partially falling through to useFlatFocusNav's own
      // generic spatial fallback, so the pair's navigation is airtight
      // regardless of restrictSyrupNavRef, same shape as MilkSelection.js's
      // own ICE_ADJACENCY-driven ice-cube leg.
      if (active === mintSyrup) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Per request: both syrup bottles show the halo until the player's
        // first arrow press, then it collapses to just the focused one --
        // see syrupSpotlightMoved's own comment above.
        setSyrupSpotlightMoved(true);
        if (action === 'Right') {
          guavaSyrup?.focus();
        } else if (!restrictSyrupNavRef.current) {
          if (action === 'Down') {
            matchaFoam?.focus();
          } else if (action === 'Up') {
            gearButton?.focus();
          }
        }
        return;
      }

      // Guava-syrup: Left -> mint-syrup (the only leg still allowed once
      // restricted), Right -> honey-syrup (order 2+ -- falls through to
      // matcha-powder, continuing the same rightward chain matcha-powder's
      // own Right -> guava-powder already forms, whenever honey-syrup isn't
      // rendered yet), Down -> matcha-cold-foam, Up -> settings (same
      // target as mint-syrup's own Up above). Right/Down/Up are all gated
      // behind !restrictSyrupNavRef.current -- harmless in practice since
      // that ref is only ever true on order 1, when honey-syrup doesn't
      // exist yet anyway, but kept explicit for the same "every escape
      // route gated, not just the ones that happen to matter today"
      // reasoning as mint-syrup's own leg above.
      if (active === guavaSyrup) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSyrupSpotlightMoved(true);
        if (action === 'Left') {
          mintSyrup?.focus();
        } else if (!restrictSyrupNavRef.current) {
          if (action === 'Right') {
            (honeySyrup ?? matchaPowder)?.focus();
          } else if (action === 'Down') {
            matchaFoam?.focus();
          } else if (action === 'Up') {
            gearButton?.focus();
          }
        }
        return;
      }

      // Honey-syrup (order 2+, sits to the right of guava-syrup): Left ->
      // guava-syrup, Right -> mango-syrup (order 3+ -- falls through to
      // matcha-powder, continuing the same rightward chain, whenever
      // mango-syrup isn't rendered yet), Down -> matcha-cold-foam (same
      // target as the rest of the syrup row's own Down), Up -> settings.
      if (active === honeySyrup) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left') {
          guavaSyrup?.focus();
        } else if (action === 'Right') {
          (mangoSyrup ?? matchaPowder)?.focus();
        } else if (action === 'Down') {
          matchaFoam?.focus();
        } else if (action === 'Up') {
          gearButton?.focus();
        }
        return;
      }

      // Mango-syrup (order 3+, sits to the right of honey-syrup): Left ->
      // honey-syrup, Right -> lavender-syrup (order 4+ -- falls through to
      // matcha-powder, same rightward-chain reasoning), Down ->
      // matcha-cold-foam, Up -> settings.
      if (active === mangoSyrup) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left') {
          honeySyrup?.focus();
        } else if (action === 'Right') {
          (lavenderSyrup ?? matchaPowder)?.focus();
        } else if (action === 'Down') {
          matchaFoam?.focus();
        } else if (action === 'Up') {
          gearButton?.focus();
        }
        return;
      }

      // Lavender-syrup (order 4+, sits to the right of mango-syrup): Left
      // -> mango-syrup, Right -> peach-syrup (order 5+ -- falls through to
      // matcha-powder, same rightward-chain reasoning), Down ->
      // matcha-cold-foam, Up -> settings.
      if (active === lavenderSyrup) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left') {
          mangoSyrup?.focus();
        } else if (action === 'Right') {
          (peachSyrup ?? matchaPowder)?.focus();
        } else if (action === 'Down') {
          matchaFoam?.focus();
        } else if (action === 'Up') {
          gearButton?.focus();
        }
        return;
      }

      // Peach-syrup (order 5+, the row's last member): Left ->
      // lavender-syrup, Right -> matcha-powder (crossing over into the
      // powder row, same escape every other rightmost syrup item's own
      // Right already does), Down -> matcha-cold-foam, Up -> settings.
      if (active === peachSyrup) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left') {
          lavenderSyrup?.focus();
        } else if (action === 'Right') {
          matchaPowder?.focus();
        } else if (action === 'Down') {
          matchaFoam?.focus();
        } else if (action === 'Up') {
          gearButton?.focus();
        }
        return;
      }

      // Matcha-powder: Right -> guava-powder (the only leg still allowed
      // once restrictPowderNavRef.current is true -- see its own comment
      // above), Up -> order button, Down -> the mint-leaves pot (order 3+
      // only -- falls through to the cup whenever the pot isn't rendered
      // yet, since it sits directly below the powder pair once it exists --
      // see mintLeavesUnlocked above). Left is trapped either way -- it's
      // the leftmost item, nothing further left to land on. Every action is
      // fully handled here (preventDefault/stopImmediatePropagation
      // unconditional) rather than partially falling through to
      // useFlatFocusNav's own generic spatial fallback, so the pair's
      // navigation is airtight regardless of restrictPowderNavRef, same
      // shape as the syrup/foam pairs' own legs above.
      if (active === matchaPowder) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Per request: both powders show the halo until the player's first
        // arrow press, then it collapses to just the focused one -- see
        // powderSpotlightMoved's own comment above.
        setPowderSpotlightMoved(true);
        if (action === 'Right') {
          guavaPowder?.focus();
        } else if (!restrictPowderNavRef.current) {
          if (action === 'Up') {
            orderButton?.focus();
          } else if (action === 'Down') {
            (mintLeavesPot ?? cup)?.focus();
          }
        }
        return;
      }

      // Guava-powder: Left -> matcha-powder (the only leg still allowed
      // once restricted), Right -> choco-powder (order 3+ -- null before
      // then, traps same as this used to unconditionally), Up -> order
      // button, Down -> the mint-leaves pot (same fallback-to-cup reasoning
      // as matcha-powder's own Down above).
      if (active === guavaPowder) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPowderSpotlightMoved(true);
        if (action === 'Left') {
          matchaPowder?.focus();
        } else if (action === 'Right') {
          chocoPowder?.focus();
        } else if (!restrictPowderNavRef.current) {
          if (action === 'Up') {
            orderButton?.focus();
          } else if (action === 'Down') {
            (mintLeavesPot ?? cup)?.focus();
          }
        }
        return;
      }

      // Choco-powder (order 3+, the row's last member, sits to the right of
      // guava-powder): Left -> guava-powder, Up -> order button, Down -> the
      // mint-leaves pot (same fallback-to-cup reasoning as the rest of the
      // powder row's own Down). Right is trapped -- it's the last item.
      if (active === chocoPowder) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left') {
          guavaPowder?.focus();
        } else if (action === 'Up') {
          orderButton?.focus();
        } else if (action === 'Down') {
          (mintLeavesPot ?? cup)?.focus();
        }
        return;
      }

      // Mint-leaves pot (order 2+, sits below the powder pair): Up ->
      // matcha-powder (mirroring that item's own Down leg above), Right ->
      // banana-chips-pot (order 4+ -- null before then, traps), Down ->
      // cup. Left is trapped -- it's the leftmost item in the pot row.
      if (active === mintLeavesPot) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Up') {
          matchaPowder?.focus();
        } else if (action === 'Right') {
          bananaChipsPot?.focus();
        } else if (action === 'Down') {
          cup?.focus();
        }
        return;
      }

      // Banana-chips pot (order 4+, sits to the right of the mint-leaves
      // pot): Left -> mint-leaves pot, Right -> cherry-blossoms pot (order
      // 5+ -- null before then, traps), Up -> matcha-powder, Down -> cup.
      if (active === bananaChipsPot) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left') {
          mintLeavesPot?.focus();
        } else if (action === 'Right') {
          cherryBlossomsPot?.focus();
        } else if (action === 'Up') {
          matchaPowder?.focus();
        } else if (action === 'Down') {
          cup?.focus();
        }
        return;
      }

      // Cherry-blossoms pot (order 5+, the pot row's last member): Left ->
      // banana-chips pot, Up -> matcha-powder, Down -> cup. Right is
      // trapped -- it's the last item in the row.
      if (active === cherryBlossomsPot) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left') {
          bananaChipsPot?.focus();
        } else if (action === 'Up') {
          matchaPowder?.focus();
        } else if (action === 'Down') {
          cup?.focus();
        }
        return;
      }

      // Order button -> Left goes to settings, Down goes to matcha-powder,
      // same reciprocal pair every other frame's own order button/gear
      // share.
      if (active === orderButton) {
        if (action === 'Left') {
          e.preventDefault();
          e.stopImmediatePropagation();
          gearButton?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          matchaPowder?.focus();
        }
        return;
      }

      // Settings gear -> Right goes back to the order button, Down goes to
      // guava-syrup -- same reciprocal-pair shape as every other frame's
      // own gear legs. Down only while its popover is closed; while open,
      // SettingsPanel's own handler owns Down (moving into the volume
      // controls instead).
      if (active === gearButton) {
        if (action === 'Right') {
          e.preventDefault();
          e.stopImmediatePropagation();
          orderButton?.focus();
        } else if (action === 'Down' && !document.querySelector('.settings-popover')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          guavaSyrup?.focus();
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useFlatFocusNav(containerRef);

  // ---- Sending the finished drink on to Serving ---------------------------
  // Same "carry to a corner zone, then shrink/fade away" shape as Milk
  // Selection's own cupSendStage/beginSendDrink (itself modeled on
  // MatchaMaking's bowlStage/beginBowlCarry) -- see SEND_TO_FINAL_ZONE above
  // for the zone box, and canSendToFinal/beginSendToFinal further down (they
  // have to come after pourStage/foamPourStage/powderPourStage exist).
  //   'idle'      -- normal, drink sits at incomingDrinkHomeSpot, freely
  //                  draggable.
  //   'carrying'  -- confirmed (dropped on the zone, or Enter/Space once
  //                  canSendToFinal) -- gliding to the zone's own center.
  //   'vanishing' -- arrived; shrinking/fading away (reuses MatchaMaking.
  //                  css's .bowl-vanishing, already loaded globally).
  //   'sent'      -- fade's finished; the drink (glass + every fill/fleck
  //                  layered onto it) stops rendering entirely, same as the
  //                  bowl/cup once their own stages reach 'sent' one screen
  //                  earlier.
  const [drinkSendStage, setDrinkSendStage] = useState('idle');
  const [drinkSendPos, setDrinkSendPos] = useState(null);

  // Which cup type this actually is (Milk Selection's own beginSendDrink
  // sets cupType on the object it hands off) -- defaults to 'glass' if
  // it's ever missing (incomingDrink is null before the player's first
  // order this round, and defensively in case an older/partial incomingDrink
  // shape ever shows up without it). CUP_TYPES (imported from
  // MilkSelection.js) is the same lookup that screen's own cup rendering
  // uses, so this cup renders with the exact same art/size it had there.
  const incomingCupType = incomingDrink?.cupType ?? 'glass';
  const incomingDrinkSize = CUP_TYPES[incomingCupType].tableSize;
  // Same centering formula INCOMING_DRINK_SPOT above uses (DRINK_VERTICAL_
  // OFFSET included, so it stays aligned with that approximation), just
  // against this particular cup's own (possibly narrower, if plastic) size
  // instead of always TABLE_SIZE, so it's still centered horizontally in
  // the frame regardless of which cup type arrived -- plus
  // INCOMING_DRINK_LEFT_OFFSET_FRAC's own per-type nudge (0 for glass/
  // plastic, so only the mug actually moves).
  const incomingDrinkHomeSpot = {
    left: 50 - incomingDrinkSize.width / 2 + (INCOMING_DRINK_LEFT_OFFSET_FRAC[incomingCupType] ?? 0) * incomingDrinkSize.width,
    top: 50 - incomingDrinkSize.height / 2 + DRINK_VERTICAL_OFFSET,
  };
  // The drink's own live render position. Unlike the individual toppings
  // above (which only ever move a bottle/tin around, never the drink
  // itself), every fill/fleck layered onto this drink is computed off this
  // one shared position (see incomingMilkBox just below, and everything
  // derived from it) rather than off the fixed incomingDrinkHomeSpot
  // directly -- so the whole assembled drink (glass, milk, matcha, foam,
  // foam cap, syrup, powder flecks, all of it) visually travels together
  // as one piece while it's being dragged or carried to the zone, rather
  // than only the glass image moving while its contents stay behind at the
  // old spot (which is what would happen if these boxes stayed anchored to
  // the home spot constant during a drag/carry).
  const incomingDrinkRenderPos = drinkSendPos || incomingDrinkHomeSpot;

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
  // this screen's own incomingDrinkRenderPos/incomingDrinkSize instead of
  // CUP_SPOTS.table/TABLE_SIZE -- incomingDrinkRenderPos (not the fixed
  // home spot) so this box, and everything derived from it below, moves
  // along with the cup while it's being dragged/carried to the Serving
  // zone (see the big comment on incomingDrinkRenderPos above), and
  // incomingDrinkSize (not always TABLE_SIZE) so it fits whichever cup
  // type actually arrived (glass, plastic, or mug).
  const incomingMilkBox = incomingDrink?.milk ? getMilkBoxFor(incomingDrinkRenderPos, incomingDrinkSize, CUP_TYPES[incomingCupType].bodyFrac) : null;
  const incomingMatchaBox = incomingDrink?.matcha && incomingMilkBox ? getMatchaBoxFor(incomingMilkBox) : null;
  const incomingSyrupBox = incomingMilkBox ? getSyrupBoxFor(incomingMilkBox) : null;
  // Foam always lands on whatever the drink's current top layer is -- the
  // matcha layer if one was poured, otherwise straight onto the milk. See
  // getFoamBoxFor (above FOAM_HOVER_GAP) for its own box math -- a
  // shallower, narrower-overlap variant of getMatchaBoxFor's shape, plus a
  // touch of extra width, per request.
  const incomingTopBox = incomingMatchaBox || incomingMilkBox;
  // Centered/un-offset base box -- foamPourOffset doesn't exist as a
  // variable yet this early in the component (it's declared down with the
  // rest of the foam interaction state below), so the actual offset-shifted
  // box used everywhere foam is rendered/landed on (renderedFoamBox/
  // renderedFoamCapBox) is computed later instead, once that state exists --
  // see the big comment there for why a missed lever catch shifts this at
  // all now, unlike syrup's own purely-cosmetic pourOffset.
  const incomingFoamBox = incomingTopBox ? getFoamBoxFor(incomingTopBox) : null;
  // The whole visible liquid column -- only used for powder's own "no foam
  // to catch it" scatter case, see getPowderLiquidBoxFor above.
  const incomingPowderLiquidBox =
    incomingTopBox && incomingMilkBox ? getPowderLiquidBoxFor(incomingTopBox, incomingMilkBox) : null;

  // ---- Guava/mint/honey syrup: pick up, pour onto the drink, or snap back
  // home -- same drag/Enter-to-pour shape as Milk Selection's own milk
  // bottles -- see the big comment on SYRUP_HOVER_GAP/getSyrupHoverPos above
  // for what's different about syrup specifically (the flip, the aim, the
  // bottom-of-the-cup landing spot). Honey syrup (order 3+) is just a third
  // key in this same set -- every handler below is already generic over
  // `item.key`, so it needed no changes beyond being included here.
  const [syrupPositions, setSyrupPositions] = useState(() => {
    const positions = {};
    for (const item of toppingItems) {
      if (
        item.key === 'guava-syrup' ||
        item.key === 'mint-syrup' ||
        item.key === 'honey-syrup' ||
        item.key === 'mango-syrup' ||
        item.key === 'lavender-syrup' ||
        item.key === 'peach-syrup'
      ) {
        positions[item.key] = { left: item.left, top: item.top };
      }
    }
    return positions;
  });
  //   'idle'     -- normal, whichever syrup sits wherever it was left.
  //   'moving'   -- confirmed (dropped on the cup, or Enter/Space) -- gliding
  //                 to the hover-over-cup spot and flipping upside-down.
  //   'pouring'  -- arrived; cupSyrup is set (the fill appears) and it holds
  //                 the flip for SYRUP_POUR_MS -- during which Left/Right
  //                 plays the balance minigame (see SYRUP_MIX_BAR_WIDTH/the
  //                 physics effect further down) -- before gliding back home
  //                 and returning to 'idle' on its own, same reusable-not-
  //                 one-time-use item as the milk bottles.
  const [pourStage, setPourStage] = useState('idle');
  const [pouringKey, setPouringKey] = useState(null); // 'guava-syrup' | 'mint-syrup' | 'honey-syrup' | null
  // The "liquid pour" Audio instance currently playing for this syrup pour
  // (see playLiquidPouring below) -- held in a ref, same reasoning as Milk
  // Selection's own pourAudioRef, purely so it can be cut short the moment
  // SYRUP_POUR_MS ends rather than playing out past the pour itself.
  const pourAudioRef = useRef(null);
  // Horizontal nudge (see SYRUP_MOVE_RANGE above), reset to 0 at the start
  // of every pour and, since the balance minigame replaced the old manual
  // aim, now derived every tick from the ball's own live position (see the
  // physics effect further down) rather than stepped by keypresses
  // directly. Still purely cosmetic for where the fill itself lands -- see
  // the big comment on getSyrupBoxFor above for why it doesn't move where
  // the syrup actually ends up.
  const [pourOffset, setPourOffset] = useState(0);
  // The drink's own persistent "has syrup been poured in" state -- doesn't
  // reset on its own (only a fresh pour re-sets it), same "second pour just
  // restarts this rather than accumulating" caveat as Milk Selection's
  // cupMilk/cupMatcha. { key: 'guava-syrup' | 'mint-syrup' | 'honey-syrup' } | null.
  const [cupSyrup, setCupSyrup] = useState(null);

  // ---- First-order-only walkthrough spotlight, Toppings' own first (and so
  // far only) beat -- same shape as MilkSelection.js's showCupSpotlight/
  // showBaseSpotlight/etc. and MatchaMaking.js's own beats: full-screen pink
  // tint with everything except a few specific elements punched through via
  // a higher z-index (topping-spotlight-exempt), plus a pre-focused element
  // and a pink label pointing at it. Declared here, right after cupSyrup
  // itself, rather than up near containerRef, since its condition reads
  // cupSyrup and this file's own established convention (see MilkSelection.
  // js's showBaseSpotlight comment for the TDZ bug that taught this) is to
  // declare each beat right after the state it depends on rather than risk
  // a ReferenceError from referencing a useState before its own declaration.
  // Active for the whole time before the player's poured a syrup, AND for
  // the whole time a pour is actually in progress (pourStage 'moving' then
  // 'pouring', tracked by pouringKey being non-null) -- per request, the
  // pink tint needs to stay up through the balance minigame too, not drop
  // the instant cupSyrup gets set. cupSyrup is actually set right as
  // pourStage flips from 'moving' to 'pouring' (see the physics effect
  // below), i.e. right as the minigame itself starts, so a plain !cupSyrup
  // condition on its own would have ended this beat exactly when the
  // minigame begins -- the `|| pouringKey !== null` clause is what keeps it
  // up through that. Once the pour actually finishes (pourStage back to
  // 'idle', pouringKey reset to null -- see that same effect), cupSyrup is
  // already set and pouringKey is null, so both halves of the condition go
  // false together and the beat ends cleanly. There's no further Toppings
  // beat yet, so the pink tint just goes away entirely at that point (see
  // the overlay's own render condition further down).
  const showSyrupSpotlight = customerNumber === 1 && (!cupSyrup || pouringKey !== null);

  // Whether the player has actually pressed an arrow key or Enter yet
  // during this beat -- per request, both syrup bottles show the white
  // focus halo (see topping-focus-halo on the syrup JSX further down) the
  // instant showSyrupSpotlight turns on, and collapses down to just the one
  // actually focused bottle the moment the player makes their first move
  // (see the mint-syrup/guava-syrup legs of the nav-graph effect above, and
  // handleSyrupKeyDown below, both of which flip this true). Reset back to
  // false every time showSyrupSpotlight itself turns on, so it's ready
  // fresh if this beat were ever to run again.
  const [syrupSpotlightMoved, setSyrupSpotlightMoved] = useState(false);
  useEffect(() => {
    if (showSyrupSpotlight) setSyrupSpotlightMoved(false);
  }, [showSyrupSpotlight]);

  // Keeps restrictSyrupNavRef (declared/read far above, alongside
  // containerRef, for the same early-registration ordering reasons) in sync
  // with showSyrupSpotlight. No dependency array -- re-reads every render,
  // same "cheap and never a render behind" shape as MilkSelection.js's own
  // restrict*NavRef sync effects.
  useEffect(() => {
    restrictSyrupNavRef.current = showSyrupSpotlight;
  });

  // Pre-selects mint-syrup (SYRUP_PAIR_BASE's own first/leftmost item, see
  // its own comment above) the moment this beat starts, same "focus the
  // first exempted item so Enter/drag both work immediately with no extra
  // navigation" reasoning as every other spotlight beat's own focus effect.
  // Queried by its fixed data-topping-key rather than a shared CSS class
  // (unlike Milk Selection's cup/ice/bottle queries) since every station
  // item here -- cup, syrup, foam, powder alike -- shares the exact same
  // .station-item.movable class, so a class-based query would risk grabbing
  // the wrong one; data-topping-key is already this file's own established
  // way of looking up one specific item (see the nav-graph effect above).
  useEffect(() => {
    if (showSyrupSpotlight) {
      containerRef.current?.querySelector('[data-topping-key="mint-syrup"]')?.focus();
    }
  }, [showSyrupSpotlight]);

  // ---- Syrup pour balance minigame state -- see the big comment on
  // SYRUP_MIX_BAR_WIDTH above. Same ref-driven-direct-DOM-writes shape
  // MatchaMaking's own mixBallRef/mixPositionRef/mixVelocityRef use for the
  // ball itself (smooth 60fps physics without a React re-render every
  // frame); spills/spillGrowth stay as real state since they only update a
  // handful of times per pour and actually need to mount new elements.
  const syrupBallRef = useRef(null);
  const syrupBallPositionRef = useRef(0); // % along the bar, left edge of the ball
  const syrupBallVelocityRef = useRef(0); // %/second
  const [syrupSpills, setSyrupSpills] = useState([]); // [{ side, left, top }]
  // Mirrors syrupSpills, same "tick() needs a synchronous read" reasoning as
  // MatchaMaking's own spillsRef.
  const syrupSpillsRef = useRef([]);
  const [syrupSpillGrowth, setSyrupSpillGrowth] = useState(0);
  // Raw count of every mess-up during the CURRENT (or most recently
  // finished) syrup pour -- reset at the start of each fresh pour attempt
  // (see the physics effect below), read once the drink is actually sent on
  // to Serving (see beginSendToFinal's own scoreToppings call further down)
  // so the syrup-pour check there grades this exact attempt.
  const syrupMessUpCountRef = useRef(0);

  // ---- Matcha-cold-foam/reg-cold-foam: pick up, pour on top of the drink,
  // or snap back home -- identical shape to the syrup state just above, see
  // the big comment above FOAM_HOVER_GAP for what's actually different
  // about foam (lands on TOP of the drink instead of sinking to the
  // bottom).
  const [foamPositions, setFoamPositions] = useState(() => {
    const positions = {};
    for (const item of toppingItems) {
      if (
        item.key === 'matcha-cold-foam' ||
        item.key === 'reg-cold-foam' ||
        item.key === 'banana-foam' ||
        item.key === 'strawberry-foam' ||
        item.key === 'blueberry-foam'
      ) {
        positions[item.key] = { left: item.left, top: item.top };
      }
    }
    return positions;
  });
  const [foamPourStage, setFoamPourStage] = useState('idle'); // 'idle' | 'moving' | 'pouring'
  const [foamPouringKey, setFoamPouringKey] = useState(null); // 'matcha-cold-foam' | 'reg-cold-foam' | null
  const [foamPourOffset, setFoamPourOffset] = useState(0);
  // The "foam pour" Audio instance currently playing for this foam pour (see
  // playFoamPouring below) -- held in a ref, same reasoning as this file's
  // own pourAudioRef (syrup's equivalent), purely so it can be cut short the
  // moment FOAM_POUR_MS ends rather than playing out past the pour itself.
  const foamPourAudioRef = useRef(null);
  const [cupFoam, setCupFoam] = useState(null); // { key } | null

  // ---- Second first-order-only walkthrough beat, foam pair -- picks up the
  // instant showSyrupSpotlight above ends (i.e. the syrup pour + minigame
  // has fully settled, see that beat's own extended condition), same
  // "next beat starts where the last one's own condition goes false" shape
  // MilkSelection.js's showBowlSpotlight/showSendSpotlight chain uses.
  // Declared here, right after cupFoam itself, rather than up near
  // showSyrupSpotlight, for the same TDZ reason documented on that beat's
  // own comment (this one reads cupFoam, which isn't declared until here).
  // !showSyrupSpotlight (rather than re-deriving "syrup's done" from
  // cupSyrup/pouringKey directly) is deliberate -- reusing that beat's own
  // already-computed boolean guarantees the two beats can never both be
  // true at once (no double-pink-callout moment), the same "reuse the
  // existing state boundary as the next beat's own trigger" principle this
  // whole walkthrough system has followed throughout.
  // EXTENDED per a later request, same shape as showSyrupSpotlight's own
  // extension above -- stays up through the whole foam pour+minigame
  // (foamPourStage 'moving' -> 'aiming', the lever minigame itself -> then
  // 'pouring'), tracked by foamPouringKey being non-null the entire way,
  // not just until cupFoam gets set. cupFoam is actually set right as
  // foamPourStage flips to 'pouring' -- AFTER the lever minigame ('aiming')
  // has already run its course, unlike syrup where cupSyrup got set right
  // as ITS minigame began -- but foamPouringKey still spans the whole
  // 'moving'/'aiming'/'pouring' sequence either way, so the same
  // `|| foamPouringKey !== null` shape works here too. Ends once the pour
  // actually finishes (foamPourStage back to 'idle', foamPouringKey reset
  // to null) with cupFoam already set -- there's now a further Toppings
  // beat (showPowderSpotlight below), which picks up right where this
  // one's own condition goes false, same "reuse the state boundary" chain
  // showFoamSpotlight itself already picks up from showSyrupSpotlight.
  const showFoamSpotlight = customerNumber === 1 && !showSyrupSpotlight && (!cupFoam || foamPouringKey !== null);

  // Same "every item shows the halo until the first move" rule as
  // syrupSpotlightMoved above, just for the foam pair during this beat --
  // see topping-focus-halo on the foam JSX further down, and the
  // regFoam/matchaFoam legs of the nav-graph effect/handleFoamKeyDown
  // below, both of which flip this true.
  const [foamSpotlightMoved, setFoamSpotlightMoved] = useState(false);
  useEffect(() => {
    if (showFoamSpotlight) setFoamSpotlightMoved(false);
  }, [showFoamSpotlight]);

  // Pre-selects matcha-cold-foam (FOAM_PAIR_BASE's own first/leftmost item,
  // same reasoning as mint-syrup's own focus effect above) the moment this
  // beat starts.
  useEffect(() => {
    if (showFoamSpotlight) {
      containerRef.current?.querySelector('[data-topping-key="matcha-cold-foam"]')?.focus();
    }
  }, [showFoamSpotlight]);

  // Keeps restrictFoamNavRef (declared/read far above, alongside
  // containerRef, for the same early-registration ordering reasons) in sync
  // with showFoamSpotlight. No dependency array -- re-reads every render,
  // same "cheap and never a render behind" shape as this file's other
  // restrict refs' own sync effects.
  useEffect(() => {
    restrictFoamNavRef.current = showFoamSpotlight;
  });

  // ---- Matcha-powder/guava-powder: pick up, pour on top of the drink, or
  // snap back home -- identical shape to the syrup/foam state above, see
  // the big comment above POWDER_HOVER_GAP for what's different about
  // powder itself (particle stream, and where it settles depending on
  // whether foam's already in the cup).
  const [powderPositions, setPowderPositions] = useState(() => {
    const positions = {};
    for (const item of toppingItems) {
      if (item.key === 'matcha-powder' || item.key === 'guava-powder' || item.key === 'choco-powder') {
        positions[item.key] = { left: item.left, top: item.top };
      }
    }
    return positions;
  });
  const [powderPourStage, setPowderPourStage] = useState('idle'); // 'idle' | 'moving' | 'pouring'
  const [powderPouringKey, setPowderPouringKey] = useState(null); // 'matcha-powder' | 'guava-powder' | null
  const [powderPourOffset, setPowderPourOffset] = useState(0);
  // The "topping powder pour" Audio instance currently playing for this
  // powder pour (see playToppingPowderPour below) -- held in a ref, same
  // reasoning as this file's own pourAudioRef/foamPourAudioRef, purely so
  // it can be cut short the moment POWDER_POUR_MS ends rather than playing
  // out past the pour itself.
  const powderPourAudioRef = useRef(null);
  const [cupPowder, setCupPowder] = useState(null); // { key } | null

  // ---- Third first-order-only walkthrough beat, powder pair -- picks up
  // the instant showFoamSpotlight above ends (foam pour + lever minigame
  // fully settled, see that beat's own extended condition), same "reuse the
  // existing state boundary as the next beat's own trigger" chain
  // showFoamSpotlight itself picks up from showSyrupSpotlight. Declared
  // here, right after cupPowder itself, for the same TDZ reason documented
  // on both earlier beats' own comments. !showSyrupSpotlight is included
  // alongside !showFoamSpotlight (not just the latter) so this can never
  // accidentally fire during the syrup beat too -- !showFoamSpotlight alone
  // is also true for the whole syrup beat (foam hasn't started yet), so
  // without this extra guard the powder beat would incorrectly overlap the
  // syrup beat instead of waiting for it to actually finish first. Ends
  // once the player actually pours a powder (cupPowder gets set) -- there's
  // no further Toppings beat yet, so the pink tint just goes away entirely
  // EXTENDED per a later request, same shape as showSyrupSpotlight's/
  // showFoamSpotlight's own extensions above -- stays up through the whole
  // powder pour+minigame (powderPourStage 'moving' -> 'aiming', the shared
  // lever minigame -> then 'pouring'), tracked by powderPouringKey being
  // non-null the entire way, not just until cupPowder gets set. cupPowder
  // is actually set right as powderPourStage flips to 'pouring' -- same
  // "after the lever minigame, not during it" timing as cupFoam -- but
  // powderPouringKey still spans the whole 'moving'/'aiming'/'pouring'
  // sequence either way, so the same `|| powderPouringKey !== null` shape
  // works here too. Ends once the pour actually finishes (powderPourStage
  // back to 'idle', powderPouringKey reset to null) with cupPowder already
  // set -- there's now a further Toppings beat (showSendSpotlight below),
  // which picks up right where this one's own condition goes false.
  const showPowderSpotlight =
    customerNumber === 1 &&
    !showSyrupSpotlight &&
    !showFoamSpotlight &&
    (!cupPowder || powderPouringKey !== null);

  // Same "every item shows the halo until the first move" rule as
  // syrupSpotlightMoved/foamSpotlightMoved above, just for the powder pair
  // during this beat -- see topping-focus-halo on the powder JSX further
  // down, and the matchaPowder/guavaPowder legs of the nav-graph effect/
  // handlePowderKeyDown below, both of which flip this true.
  const [powderSpotlightMoved, setPowderSpotlightMoved] = useState(false);
  useEffect(() => {
    if (showPowderSpotlight) setPowderSpotlightMoved(false);
  }, [showPowderSpotlight]);

  // Pre-selects matcha-powder (POWDER_PAIR's own first/leftmost item, same
  // reasoning as mint-syrup's/matcha-cold-foam's own focus effects above)
  // the moment this beat starts.
  useEffect(() => {
    if (showPowderSpotlight) {
      containerRef.current?.querySelector('[data-topping-key="matcha-powder"]')?.focus();
    }
  }, [showPowderSpotlight]);

  // Keeps restrictPowderNavRef (declared/read far above, alongside
  // containerRef, for the same early-registration ordering reasons) in sync
  // with showPowderSpotlight. No dependency array -- re-reads every render,
  // same "cheap and never a render behind" shape as this file's other
  // restrict refs' own sync effects.
  useEffect(() => {
    restrictPowderNavRef.current = showPowderSpotlight;
  });

  // ---- Fourth first-order-only walkthrough beat, sending the
  // drink on -- picks up the instant showPowderSpotlight above ends (powder
  // pour + lever minigame fully settled, see that beat's own extended
  // condition), same "reuse the existing state boundary as the next beat's
  // own trigger" chain every beat on this screen has followed. Unlike the
  // three pick/pour beats before it, there's no single "chosen ingredient"
  // here to exempt -- the only things left to interact with are the cup
  // itself and the Send to Serving drop-zone (make-drink-zone) in the
  // bottom-right corner, so those are what get exempted (see their own
  // className/render-condition changes below) instead of any topping image.
  // drinkSendStage !== 'sent' (rather than just 'idle', the same "stay up
  // through the whole carry/vanish animation, not just until it begins"
  // extension MilkSelection.js's own showSendSpotlight needed) keeps the
  // pink tint up while the drink is actually gliding to the zone, not just
  // before the player's grabbed it. There's now a fifth and final beat past
  // 'sent' too (showAdvanceSpotlight below), which picks up right where
  // this one's own condition goes false, same "reuse the state boundary"
  // chain every beat on this screen has followed.
  const showSendSpotlight =
    customerNumber === 1 && !showSyrupSpotlight && !showFoamSpotlight && !showPowderSpotlight && drinkSendStage !== 'sent';

  // Pre-selects the finished drink itself (the only thing left to act on)
  // the moment this beat starts, same "focus the exempted target so Enter/
  // drag both work immediately" reasoning as every other beat's own focus
  // effect on this screen.
  useEffect(() => {
    if (showSendSpotlight) {
      containerRef.current?.querySelector('[data-topping-key="cup"]')?.focus();
    }
  }, [showSendSpotlight]);

  // ---- Fifth and actually-final first-order-only walkthrough beat, picking
  // up the instant showSendSpotlight above ends (drinkSendStage reaches
  // 'sent' -- the cup, its contents, and the send zone have all stopped
  // rendering by then, see their own conditional returns/render guards
  // further down) and running for the rest of this screen's lifetime (this
  // whole component unmounts once the player actually leaves for Serving).
  // Same "final beat hands the flashing baton to the current-step dot
  // itself" shape as MilkSelection.js's own showAdvanceSpotlight/
  // MatchaMaking.js's own showStationAdvanceSpotlight -- there's nothing
  // left on screen worth pointing at except the ProgressBar, so this
  // exempts that instead (see spotlightExempt on <ProgressBar> further
  // down) and its own new pink callout (topping-progress-callout below)
  // takes over from the bar's old plain-text currentStepHint, same "new
  // pink-styled callout replaces the old text hint for the first order
  // only" treatment every other final beat in this project's walkthrough
  // system already uses. Orders 2/3 (customerNumber !== 1) never set this
  // and keep that old hint exactly as before.
  const showAdvanceSpotlight = customerNumber === 1 && drinkSendStage === 'sent';

  // ---- Mint-leaves pot: Enter picks up a leaf, which lands on the drink
  // after a short pause -- see the big comment above MINT_LEAVES_POT_ITEM/
  // LEAF_PLACE_MS/getLeafBoxFor for why this is a much simpler shape than
  // the syrup/foam/powder state above (no drag, no aim, no travel sprite).
  // cupMintLeaf persists once placed, same "doesn't reset on its own" rule
  // cupSyrup/cupFoam/cupPowder already follow.
  const [leafStage, setLeafStage] = useState('idle'); // 'idle' | 'aiming' | 'placing'
  const [cupMintLeaf, setCupMintLeaf] = useState(false);
  // Horizontal nudge, own copy of the same foamPourOffset/powderPourOffset
  // shape (see FOAM_MOVE_RANGE's own comment) -- set once by
  // resolveLeafLever, read by getLeafBoxFor's own offset param. Unlike
  // foam/powder there's no earlier cosmetic-aim history for this to have
  // come from; it starts at 0 simply because no leaf has been aimed yet.
  const [leafPourOffset, setLeafPourOffset] = useState(0);

  // ---- Banana-chips/cherry-blossoms pots: same one-shot-garnish shape as
  // mint-leaves-pot immediately above (own state trio each, per this
  // project's own "duplicate rather than generalize across similarly-shaped
  // mechanics" convention -- see the syrup/foam/powder state above for the
  // same pattern) -- just their own stage/flag/offset triples.
  const [chipStage, setChipStage] = useState('idle'); // 'idle' | 'aiming' | 'placing'
  const [cupBananaChip, setCupBananaChip] = useState(false);
  const [chipPourOffset, setChipPourOffset] = useState(0);
  const [blossomStage, setBlossomStage] = useState('idle'); // 'idle' | 'aiming' | 'placing'
  const [cupCherryBlossom, setCupCherryBlossom] = useState(false);
  const [blossomPourOffset, setBlossomPourOffset] = useState(0);

  // ---- Shared aim-lever minigame -- see the big comment on LEVER_PERIOD_MS
  // above. leverFor tracks which of the three pending placements this run
  // is actually for ('foam' | 'powder' | 'leaf'), read once by
  // handleLeverKeyDown at the moment of the catch so it can route to the
  // right resolve* function -- not, e.g., foamPourStage, since checking
  // three separate stage variables to figure out "which one is this for"
  // would be more fragile than just tracking it directly.
  const [leverStage, setLeverStage] = useState('idle'); // 'idle' | 'active'
  const [leverFor, setLeverFor] = useState(null); // 'foam' | 'powder' | 'leaf' | 'chip' | 'blossom' | null
  // Live marker center position (0-100, 50 == dead center), written by the
  // rAF physics effect below -- a ref, not state, same "no React re-render
  // needed every frame, the DOM node is mutated directly instead" reasoning
  // as the syrup balance minigame's own syrupBallPositionRef.
  const leverPositionRef = useRef(50);
  const leverMarkerRef = useRef(null);
  // The bar itself is the focus target (see the JSX below) -- auto-focused
  // the instant leverStage flips to 'active' (see the effect below), same
  // "send focus straight to the only meaningful next action" reasoning as
  // the milk pour gauge's own milkGaugeButtonRef in MilkSelection.js.
  const leverBarRef = useRef(null);

  // Sine-wave sweep, same style of oscillation math as the syrup balance
  // minigame's own drift term (SYRUP_MIX_DRIFT_AMPLITUDE * sin(...)), just
  // driving the marker's whole position here instead of perturbing a
  // player-controlled ball. Runs only while leverStage === 'active';
  // torn down (and the marker implicitly stops wherever it was) the instant
  // a catch resolves and flips leverStage back to 'idle'.
  useEffect(() => {
    if (leverStage !== 'active') return undefined;
    const startedAt = performance.now();
    let frameId;
    const tick = () => {
      const elapsedMs = performance.now() - startedAt;
      const centerPct = 50 + LEVER_AMPLITUDE_PCT * Math.sin((elapsedMs / LEVER_PERIOD_MS) * 2 * Math.PI);
      leverPositionRef.current = centerPct;
      if (leverMarkerRef.current) {
        leverMarkerRef.current.style.left = `${centerPct - (LEVER_MARKER_WIDTH_FRAC * 100) / 2}%`;
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [leverStage]);

  // Sends focus straight to the bar the instant it appears -- see
  // leverBarRef's own comment above.
  useEffect(() => {
    if (leverStage === 'active') {
      leverBarRef.current?.focus();
    }
  }, [leverStage]);

  // Resolve functions -- one per pending placement, called from
  // handleLeverKeyDown below with offsetFrac (-1..1, 0 == dead center)
  // already computed from the marker's own live position at the instant of
  // the catch. Each just sets that topping's own *PourOffset (in physical
  // %-of-container units, same MOVE_RANGE-scaled shape foamPourOffset
  // already had) and advances that topping's own stage machine on to its
  // existing 'pouring'/'placing' stage -- everything downstream (the falling
  // stream, the final landed box, the spill puddle) already reads that same
  // offset value, see the render-time foamSpill/powderSpill/leafSpill and
  // incomingFoamBox/powderLandingBox/incomingLeafBox further down.
  const resolveFoamLever = (offsetFrac) => {
    setFoamPourOffset(offsetFrac * FOAM_MOVE_RANGE);
    setFoamPourStage('pouring');
  };
  const resolvePowderLever = (offsetFrac) => {
    setPowderPourOffset(offsetFrac * POWDER_MOVE_RANGE);
    setPowderPourStage('pouring');
  };
  const resolveLeafLever = (offsetFrac) => {
    setLeafPourOffset(offsetFrac * LEAF_MOVE_RANGE);
    setLeafStage('placing');
  };
  const resolveChipLever = (offsetFrac) => {
    setChipPourOffset(offsetFrac * CHIP_MOVE_RANGE);
    setChipStage('placing');
  };
  const resolveBlossomLever = (offsetFrac) => {
    setBlossomPourOffset(offsetFrac * BLOSSOM_MOVE_RANGE);
    setBlossomStage('placing');
  };

  // The one real interaction with the lever -- Enter/center catches it
  // wherever it currently reads. shouldDebounceEnter guards against a
  // repeating held key firing this more than once for a single physical
  // press, same as every other Enter handler in this file. Plain onKeyDown
  // on the focused bar element (not a global window listener) -- unlike the
  // milk pour gauge's own press-and-HOLD gesture, this is a single discrete
  // press, the same shape every other Enter handler in this file already
  // uses.
  const handleLeverKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    playButtonClick();
    const offsetFrac = (leverPositionRef.current - 50) / LEVER_AMPLITUDE_PCT;
    const target = leverFor;
    setLeverStage('idle');
    setLeverFor(null);
    if (target === 'foam') resolveFoamLever(offsetFrac);
    else if (target === 'powder') resolvePowderLever(offsetFrac);
    else if (target === 'leaf') resolveLeafLever(offsetFrac);
    else if (target === 'chip') resolveChipLever(offsetFrac);
    else if (target === 'blossom') resolveBlossomLever(offsetFrac);
  };

  // Which topping (if any, across all three pairs) currently has the white
  // focus halo -- drives the name label above it (TOPPING_LABELS/
  // .topping-label), same focus-not-confirm distinction as MatchaMaking.js's
  // own focusedTin/MilkSelection.js's own focusedBottle. A single piece of
  // state covers all six items (rather than one per pair) since only one
  // item can ever be focused at a time regardless of which pair it's in.
  // The onBlur guard (only clear if this item is still the one recorded)
  // avoids a stale clear if focus has already moved to a different item by
  // the time this one's blur fires.
  const [focusedTopping, setFocusedTopping] = useState(null);

  // Only needs an actual drink to pour onto and nothing else already
  // mid-pour -- unlike Milk Selection's own bottles/bowl there's no ice/
  // base precondition here, since the drink arriving from that screen is
  // already whatever it's going to be by the time it gets here. Also gated
  // on the OTHER toppings' own stages so only one bottle is ever mid-pour
  // at a time -- otherwise two simultaneous capture-phase Left/Right aim
  // listeners (any two of syrup's/foam's/powder's, see the effects below)
  // would both fire off a single keypress -- and on drinkSendStage being
  // 'idle' too, so nothing can be poured onto the drink once it's already
  // mid-carry/vanishing off to Serving.
  const canPourSyrup =
    !!incomingDrink &&
    pourStage === 'idle' &&
    foamPourStage === 'idle' &&
    powderPourStage === 'idle' &&
    leafStage === 'idle' &&
    chipStage === 'idle' &&
    blossomStage === 'idle' &&
    drinkSendStage === 'idle';
  const canPourFoam =
    !!incomingDrink &&
    foamPourStage === 'idle' &&
    pourStage === 'idle' &&
    powderPourStage === 'idle' &&
    leafStage === 'idle' &&
    chipStage === 'idle' &&
    blossomStage === 'idle' &&
    drinkSendStage === 'idle';
  const canPourPowder =
    !!incomingDrink &&
    powderPourStage === 'idle' &&
    pourStage === 'idle' &&
    foamPourStage === 'idle' &&
    leafStage === 'idle' &&
    chipStage === 'idle' &&
    blossomStage === 'idle' &&
    drinkSendStage === 'idle';
  // Same mutual-exclusion gating as the three pours above, just for the
  // mint-leaves pot -- mintLeavesUnlocked (order 2+) gates whether the pot
  // is even rendered at all, this additionally gates whether it can
  // actually be used right now.
  const canPlaceLeaf =
    mintLeavesUnlocked &&
    !!incomingDrink &&
    leafStage === 'idle' &&
    pourStage === 'idle' &&
    foamPourStage === 'idle' &&
    powderPourStage === 'idle' &&
    chipStage === 'idle' &&
    blossomStage === 'idle' &&
    drinkSendStage === 'idle';
  // Same shape as canPlaceLeaf above, just for the two newer standalone
  // garnishes -- bananaChipsUnlocked (order 4+)/cherryBlossomsUnlocked
  // (order 5+) gate whether each pot is even rendered at all.
  const canPlaceChip =
    bananaChipsUnlocked &&
    !!incomingDrink &&
    chipStage === 'idle' &&
    pourStage === 'idle' &&
    foamPourStage === 'idle' &&
    powderPourStage === 'idle' &&
    leafStage === 'idle' &&
    blossomStage === 'idle' &&
    drinkSendStage === 'idle';
  const canPlaceBlossom =
    cherryBlossomsUnlocked &&
    !!incomingDrink &&
    blossomStage === 'idle' &&
    pourStage === 'idle' &&
    foamPourStage === 'idle' &&
    powderPourStage === 'idle' &&
    leafStage === 'idle' &&
    chipStage === 'idle' &&
    drinkSendStage === 'idle';
  // The drink itself can be sent on once there's actually a drink and
  // nothing's currently mid-pour onto it (same "don't let two things move
  // at once" reasoning as the toppings' own gating above) and it isn't
  // already mid-send.
  const canSendToFinal =
    !!incomingDrink &&
    drinkSendStage === 'idle' &&
    pourStage === 'idle' &&
    foamPourStage === 'idle' &&
    powderPourStage === 'idle' &&
    leafStage === 'idle' &&
    chipStage === 'idle' &&
    blossomStage === 'idle';

  const beginSyrupPour = (key) => {
    if (!canPourSyrup) return;
    const item = toppingItems.find((i) => i.key === key);
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
      // "liquid pour" SFX -- syrup is the one topping pair here that's an
      // actual poured liquid (unlike the cold-foam/powder pairs below,
      // which intentionally don't play this), so it fires once right as
      // the fill lands, same "on the 'pouring' transition, not 'moving'"
      // timing Milk Selection's own base/matcha pours use -- and, same as
      // there, gets cut short (not left to finish on its own) the moment
      // SYRUP_POUR_MS elapses below, and also on cleanup.
      pourAudioRef.current = playLiquidPouring();
      setCupSyrup({ key: pouringKey });
      const t = setTimeout(() => {
        pourAudioRef.current?.pause();
        pourAudioRef.current = null;
        const home = toppingItems.find((i) => i.key === pouringKey);
        setSyrupPositions((prev) => ({ ...prev, [pouringKey]: { left: home.left, top: home.top } }));
        setPourStage('idle');
        setPouringKey(null);
        setPourOffset(0);
      }, SYRUP_POUR_MS);
      return () => {
        clearTimeout(t);
        pourAudioRef.current?.pause();
        pourAudioRef.current = null;
      };
    }
    return undefined;
  }, [pourStage, pouringKey, toppingItems]);

  // ---- Syrup pour balance minigame physics -- runs for the whole
  // 'pouring' stage, same overall shape as MatchaMaking's own
  // whiskStage === 'mixing' physics effect (a single requestAnimationFrame
  // loop, ball position written straight to the DOM via syrupBallRef every
  // frame rather than through React state -- see that file's own big
  // comment for why) -- just scoped to SYRUP_POUR_MS instead of WHISK_MIX_
  // DURATION_MS, and spilling plain colored blobs (SYRUP_RIGHT_SPILL_BASE/
  // SYRUP_LEFT_SPILL_BASE above) instead of PNG puddles. This REPLACES the
  // old plain Left/Right-steps-pourOffset-directly effect that used to live
  // here -- pourOffset is now derived from the ball's own live position
  // every tick (see the tick() closure below) instead, so the falling
  // stream/flipped bottle still visually track Left/Right, just as a side
  // effect of the real minigame now, not a separate cosmetic-only control.
  // Same capture-phase + stopImmediatePropagation reasoning the old effect
  // already had (BEFORE useFlatFocusNav's own bubble-phase window listener
  // can treat Left/Right as "move focus" instead), only attached while an
  // actual syrup pour is in progress.
  useEffect(() => {
    if (pourStage !== 'pouring' || !pouringKey) return undefined;

    const ballWidthPercent = SYRUP_MIX_BALL_WIDTH_FRAC * 100;
    const maxPosition = 100 - ballWidthPercent;
    // Starts centered in the bar, same "a beat before the drift matters"
    // reasoning as MatchaMaking's own mixPositionRef reset.
    syrupBallPositionRef.current = 50 - ballWidthPercent / 2;
    syrupBallVelocityRef.current = 0;
    syrupMessUpCountRef.current = 0;
    syrupSpillsRef.current = [];
    setSyrupSpills([]);
    setSyrupSpillGrowth(0);
    setPourOffset(0);

    const zoneLeftPercent = SYRUP_MIX_ZONE_LEFT_FRAC * 100;
    const zoneRightPercent = zoneLeftPercent + SYRUP_MIX_ZONE_WIDTH_FRAC * 100;

    // Timestamps (performance.now()-space) of the most recent qualifying
    // keydown for each direction -- same MIX_HOLD_GRACE_MS-style "held"
    // smoothing as MatchaMaking's own physics effect.
    let leftHeldUntil = 0;
    let rightHeldUntil = 0;

    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Left' && action !== 'Right') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const until = performance.now() + SYRUP_MIX_HOLD_GRACE_MS;
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
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const elapsedMs = now - startTime;

      if (now < rightHeldUntil) syrupBallVelocityRef.current += SYRUP_MIX_HOLD_ACCEL * dt;
      if (now < leftHeldUntil) syrupBallVelocityRef.current -= SYRUP_MIX_HOLD_ACCEL * dt;

      const drift = SYRUP_MIX_DRIFT_AMPLITUDE * Math.sin((elapsedMs / 1000) * SYRUP_MIX_DRIFT_ANGULAR_FREQ);
      syrupBallVelocityRef.current += drift * dt;
      syrupBallVelocityRef.current *= 0.5 ** (dt / SYRUP_MIX_FRICTION_HALF_LIFE_S);
      syrupBallPositionRef.current += syrupBallVelocityRef.current * dt;

      // Soft bounce off the ends, same reasoning as MatchaMaking's own
      // mixPositionRef clamp.
      if (syrupBallPositionRef.current <= 0) {
        syrupBallPositionRef.current = 0;
        syrupBallVelocityRef.current = Math.abs(syrupBallVelocityRef.current) * 0.3;
      } else if (syrupBallPositionRef.current >= maxPosition) {
        syrupBallPositionRef.current = maxPosition;
        syrupBallVelocityRef.current = -Math.abs(syrupBallVelocityRef.current) * 0.3;
      }

      const ballEl = syrupBallRef.current;
      if (ballEl) {
        ballEl.style.left = `${syrupBallPositionRef.current}%`;
        const ballCenter = syrupBallPositionRef.current + ballWidthPercent / 2;
        const inZone = ballCenter >= zoneLeftPercent && ballCenter <= zoneRightPercent;
        ballEl.classList.toggle('in-zone', inZone);

        // The stream/bottle's own cosmetic aim now follows the ball itself
        // -- see this effect's own big comment above for why. Maps the
        // ball's center (0-100 along the bar) onto the same
        // -SYRUP_MOVE_RANGE..+SYRUP_MOVE_RANGE range the old manual-step
        // version already used, so nothing downstream (syrupPourLeft, the
        // dragged-bottle render position) needed to change.
        const normalized = (ballCenter - 50) / 50;
        const offset = Math.max(-SYRUP_MOVE_RANGE, Math.min(SYRUP_MOVE_RANGE, normalized * SYRUP_MOVE_RANGE));
        setPourOffset(offset);

        // Sloppy pouring (ball outside the green zone) spills syrup out
        // onto the counter on whichever side it drifted toward --
        // retriggers every SYRUP_MIX_SPILL_INTERVAL_MS for as long as the
        // ball stays out, same "keeps looking messy, not a one-shot splash"
        // reasoning as MatchaMaking's own spill logic. The first
        // SYRUP_SPILL_STAGE_COUNT mess-ups each add another colored blob;
        // every mess-up after that just grows the blobs already down
        // instead (see SYRUP_SPILL_GROWTH_STEP above).
        if (!inZone && elapsedMs - lastSpillAt >= SYRUP_MIX_SPILL_INTERVAL_MS) {
          lastSpillAt = elapsedMs;
          const side = ballCenter < zoneLeftPercent ? 'left' : 'right';
          syrupMessUpCountRef.current += 1;
          if (syrupMessUpCountRef.current <= SYRUP_SPILL_STAGE_COUNT) {
            const sameSideBefore = syrupSpillsRef.current.filter((s) => s.side === side).length;
            const base = side === 'right' ? SYRUP_RIGHT_SPILL_BASE : SYRUP_LEFT_SPILL_BASE;
            const leftFrac =
              side === 'right'
                ? base.leftFrac + sameSideBefore * SYRUP_SPILL_SLOT_STEP.leftFrac
                : base.leftFrac - sameSideBefore * SYRUP_SPILL_SLOT_STEP.leftFrac;
            const topFrac = base.topFrac + sameSideBefore * SYRUP_SPILL_SLOT_STEP.topFrac;
            const entry = {
              side,
              left: INCOMING_DRINK_SPOT.left + leftFrac * INCOMING_DRINK_SIZE.width,
              top: INCOMING_DRINK_SPOT.top + topFrac * INCOMING_DRINK_SIZE.height,
            };
            syrupSpillsRef.current = [...syrupSpillsRef.current, entry];
            setSyrupSpills(syrupSpillsRef.current);
          } else {
            setSyrupSpillGrowth((g) => g + 1);
          }
        }
      }

      if (elapsedMs < SYRUP_POUR_MS) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [pourStage, pouringKey]);

  const handleSyrupKeyDown = (item) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    // Same "first move collapses the halo down to just the focused one"
    // rule as the nav-graph effect's own mint-syrup/guava-syrup legs --
    // Enter counts as a move too.
    setSyrupSpotlightMoved(true);
    playButtonClick();
    if (canPourSyrup) {
      beginSyrupPour(item.key);
      return;
    }
    // Bug fix: canPourSyrup is false both when this item can't pour yet AND
    // while it (or another topping) is already mid-pour -- previously this
    // branch didn't distinguish the two, so pressing Enter again on the
    // bottle that's actively pouring snapped its on-screen position straight
    // back to its shelf spot while pourStage/pouringKey stayed 'pouring',
    // leaving the flipped (WHISK_FLIP_DEG) bottle and its falling stream/
    // spill rendering stuck at the shelf instead of over the cup -- reported
    // as the bottle looking "upside down and dripping" in place. Bail out
    // here instead of resetting position for the item that's actually mid-
    // pour; only snap idle, out-of-sync items back home.
    if (pouringKey === item.key) return;
    setSyrupPositions((prev) => ({ ...prev, [item.key]: { left: item.left, top: item.top } }));
  };

  // ---- Foam pick-up/pour/drag handlers -- identical shape to the syrup
  // handlers just above, see the big comment above FOAM_HOVER_GAP for what's
  // different about foam itself (lands on top of the drink, not the bottom).
  const beginFoamPour = (key) => {
    if (!canPourFoam) return;
    const item = toppingItems.find((i) => i.key === key);
    setFoamPositions((prev) => ({ ...prev, [key]: getFoamHoverPos(item) }));
    setFoamPourOffset(0);
    setFoamPouringKey(key);
    setFoamPourStage('moving');
  };

  useEffect(() => {
    if (foamPourStage === 'moving') {
      const t = setTimeout(() => setFoamPourStage('aiming'), FOAM_MOVE_MS);
      return () => clearTimeout(t);
    }
    // Hands off to the shared lever minigame (see LEVER_PERIOD_MS's own big
    // comment above) instead of pouring immediately -- 'pouring' only
    // starts once resolveFoamLever actually catches it (see
    // handleLeverKeyDown). Fires once per stage-entry (leverFor/leverStage
    // only get set here, not re-set on every render while 'aiming' persists,
    // since this effect only re-runs when foamPourStage itself changes).
    if (foamPourStage === 'aiming') {
      setLeverFor('foam');
      setLeverStage('active');
      return undefined;
    }
    if (foamPourStage === 'pouring') {
      // "foam pour" SFX -- fires once right as the fill actually lands, same
      // "on the 'pouring' transition, not 'moving'/'aiming'" timing every
      // other pour SFX in this file uses, and gets cut short (not left to
      // finish on its own) the moment FOAM_POUR_MS elapses below, and also
      // on cleanup -- same pattern the syrup pour's own pourAudioRef uses.
      foamPourAudioRef.current = playFoamPouring();
      setCupFoam({ key: foamPouringKey });
      const t = setTimeout(() => {
        foamPourAudioRef.current?.pause();
        foamPourAudioRef.current = null;
        const home = toppingItems.find((i) => i.key === foamPouringKey);
        setFoamPositions((prev) => ({ ...prev, [foamPouringKey]: { left: home.left, top: home.top } }));
        setFoamPourStage('idle');
        setFoamPouringKey(null);
        // foamPourOffset is deliberately NOT reset here anymore (it used to
        // be, back when it was purely cosmetic and only ever drove the
        // now-finished falling stream) -- it now also positions the FINAL
        // landed foam fill (see incomingFoamBox below), which stays on
        // screen long after this pour's own animation ends, so it has to
        // persist. Only beginFoamPour (a fresh pour) resets it.
      }, FOAM_POUR_MS);
      return () => {
        clearTimeout(t);
        foamPourAudioRef.current?.pause();
        foamPourAudioRef.current = null;
      };
    }
    return undefined;
  }, [foamPourStage, foamPouringKey, toppingItems]);

  const handleFoamKeyDown = (item) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    // Same "first move collapses the halo down to just the focused one"
    // rule as the nav-graph effect's own regFoam/matchaFoam legs -- Enter
    // counts as a move too.
    setFoamSpotlightMoved(true);
    playButtonClick();
    if (canPourFoam) {
      beginFoamPour(item.key);
      return;
    }
    // Same fix as handleSyrupKeyDown's own version of this branch just
    // above -- don't snap the item that's already mid-pour back to its
    // shelf spot while its stage is still active.
    if (foamPouringKey === item.key) return;
    setFoamPositions((prev) => ({ ...prev, [item.key]: { left: item.left, top: item.top } }));
  };

  // ---- Powder pick-up/pour/drag handlers -- identical shape to the syrup/
  // foam handlers above, see the big comment above POWDER_HOVER_GAP for
  // what's different about powder itself (particle stream, foam-dependent
  // landing spot).
  const beginPowderPour = (key) => {
    if (!canPourPowder) return;
    const item = toppingItems.find((i) => i.key === key);
    setPowderPositions((prev) => ({ ...prev, [key]: getPowderHoverPos(item) }));
    setPowderPourOffset(0);
    setPowderPouringKey(key);
    setPowderPourStage('moving');
  };

  useEffect(() => {
    if (powderPourStage === 'moving') {
      const t = setTimeout(() => setPowderPourStage('aiming'), POWDER_MOVE_MS);
      return () => clearTimeout(t);
    }
    // Same lever hand-off as foam's own 'aiming' branch above.
    if (powderPourStage === 'aiming') {
      setLeverFor('powder');
      setLeverStage('active');
      return undefined;
    }
    if (powderPourStage === 'pouring') {
      // "topping powder pour" SFX -- fires once right as the flecks actually
      // land, same "on the 'pouring' transition, not 'moving'/'aiming'"
      // timing every other pour SFX in this file uses, and gets cut short
      // (not left to finish on its own) the moment POWDER_POUR_MS elapses
      // below, and also on cleanup -- same pattern the syrup/foam pours' own
      // pourAudioRef/foamPourAudioRef use.
      powderPourAudioRef.current = playToppingPowderPour();
      setCupPowder({ key: powderPouringKey });
      const t = setTimeout(() => {
        powderPourAudioRef.current?.pause();
        powderPourAudioRef.current = null;
        const home = toppingItems.find((i) => i.key === powderPouringKey);
        setPowderPositions((prev) => ({ ...prev, [powderPouringKey]: { left: home.left, top: home.top } }));
        setPowderPourStage('idle');
        setPowderPouringKey(null);
        // powderPourOffset intentionally NOT reset here -- same "now
        // positions the final landed flecks, has to persist past this
        // pour's own animation" reasoning as foamPourOffset above.
      }, POWDER_POUR_MS);
      return () => {
        clearTimeout(t);
        powderPourAudioRef.current?.pause();
        powderPourAudioRef.current = null;
      };
    }
    return undefined;
  }, [powderPourStage, powderPouringKey, toppingItems]);

  const handlePowderKeyDown = (item) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    // Same "first move collapses the halo down to just the focused one"
    // rule as the nav-graph effect's own matchaPowder/guavaPowder legs --
    // Enter counts as a move too.
    setPowderSpotlightMoved(true);
    playButtonClick();
    if (canPourPowder) {
      beginPowderPour(item.key);
      return;
    }
    // Same fix as handleSyrupKeyDown's own version of this branch above --
    // don't snap the item that's already mid-pour back to its shelf spot
    // while its stage is still active.
    if (powderPouringKey === item.key) return;
    setPowderPositions((prev) => ({ ...prev, [item.key]: { left: item.left, top: item.top } }));
  };

  // ---- Mint-leaves pot: Enter picks up a leaf -- much simpler than the
  // syrup/foam/powder handlers above (no drag, no aim, no re-grabbing
  // mid-pour to check for): just a gate, a short pause, then the leaf's own
  // persistent cupMintLeaf flips on. See the big comment above
  // MINT_LEAVES_POT_ITEM/LEAF_PLACE_MS for why there's no travel sprite.
  const beginLeafPlace = () => {
    if (!canPlaceLeaf) return;
    setLeafStage('aiming');
  };

  useEffect(() => {
    // Same lever hand-off as foam/powder's own 'aiming' branches above --
    // resolveLeafLever advances this on to 'placing' once caught.
    if (leafStage === 'aiming') {
      setLeverFor('leaf');
      setLeverStage('active');
      return undefined;
    }
    if (leafStage !== 'placing') return undefined;
    // "topping place" SFX -- fires once right as the leaf actually starts
    // settling onto the drink, same "on the real settle transition, not the
    // lever-catch itself" timing every other pour/place SFX in this file
    // uses. Fire-and-forget (see playToppingPlace's own comment in sfx.js)
    // -- LEAF_PLACE_MS is short enough, and this is a one-shot placement
    // rather than an ongoing pour, that there's nothing to cut it short
    // against.
    playToppingPlace();
    const t = setTimeout(() => {
      setCupMintLeaf(true);
      setLeafStage('idle');
    }, LEAF_PLACE_MS);
    return () => clearTimeout(t);
  }, [leafStage]);

  // ---- Banana-chips/cherry-blossoms pots -- identical shape to the
  // mint-leaves pot immediately above, own copies (same "duplicate rather
  // than generalize" convention this whole file already follows for
  // syrup/foam/powder).
  const beginChipPlace = () => {
    if (!canPlaceChip) return;
    setChipStage('aiming');
  };

  useEffect(() => {
    if (chipStage === 'aiming') {
      setLeverFor('chip');
      setLeverStage('active');
      return undefined;
    }
    if (chipStage !== 'placing') return undefined;
    playToppingPlace();
    const t = setTimeout(() => {
      setCupBananaChip(true);
      setChipStage('idle');
    }, LEAF_PLACE_MS);
    return () => clearTimeout(t);
  }, [chipStage]);

  const beginBlossomPlace = () => {
    if (!canPlaceBlossom) return;
    setBlossomStage('aiming');
  };

  useEffect(() => {
    if (blossomStage === 'aiming') {
      setLeverFor('blossom');
      setLeverStage('active');
      return undefined;
    }
    if (blossomStage !== 'placing') return undefined;
    playToppingPlace();
    const t = setTimeout(() => {
      setCupCherryBlossom(true);
      setBlossomStage('idle');
    }, LEAF_PLACE_MS);
    return () => clearTimeout(t);
  }, [blossomStage]);

  // Single dispatcher for all three pots (mirroring how syrup/foam/powder's
  // own handle*KeyDown(item) factories take the item and act on its key) --
  // routes Enter to whichever begin*Place function the pot's own key
  // actually corresponds to.
  const handlePotKeyDown = (key) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    playButtonClick();
    if (key === 'banana-chips-pot') beginChipPlace();
    else if (key === 'cherry-blossoms-pot') beginBlossomPlace();
    else beginLeafPlace();
  };

  // ---- Sending the finished drink on to Serving -- select + Enter, same
  // shape as Milk Selection's own handleCupKeyDown + beginSendDrink, just
  // without that screen's extra shelf<->table toggle (the drink here only
  // ever has the one resting spot, incomingDrinkHomeSpot).
  const beginSendToFinal = () => {
    if (!canSendToFinal) return;
    // Snapshotted right away (same "fired at the moment the item starts its
    // carry, not deferred until the fade finishes" reasoning as
    // MatchaMaking's beginBowlCarry/Milk Selection's beginSendDrink) --
    // milk/matcha/iceCubes come straight from incomingDrink (this screen
    // never changes those), foam/syrup/powder/leaf are this screen's own
    // cupFoam/cupSyrup/cupPowder/cupMintLeaf state.
    onSendToFinal?.({
      milk: incomingDrink.milk,
      matcha: incomingDrink.matcha,
      // Forwarded straight through, same "don't silently drop it" fix as
      // this screen's own incomingDrink.iceCubes handling above (see the
      // big comment on the ice-cube render block further down) -- without
      // this, the cubes that made it this far were rendering fine here but
      // getting lost the instant the drink moved on to Serving.
      iceCubes: incomingDrink.iceCubes ?? 0,
      foam: cupFoam,
      syrup: cupSyrup,
      powder: cupPowder,
      leaf: cupMintLeaf,
      chip: cupBananaChip,
      blossom: cupCherryBlossom,
      // Forwarded on so FinalCombination.js renders the same cup art/size
      // this screen (and Milk Selection before it) actually used -- same
      // "known simplification, now fixed" reasoning as this screen's own
      // incomingCupType above.
      cupType: incomingCupType,
    });
    // Grades this station's own toppings (syrup/foam/powder/leaf) against
    // the placed order -- see gameloop/scoring.js's own scoreToppings. Same
    // "read it right at the handoff, the last moment this screen's own
    // state still exists" reasoning as onSendToFinal itself just above.
    onScored?.(
      scoreToppings({
        syrupKey: cupSyrup?.key,
        foamKey: cupFoam?.key,
        powderKey: cupPowder?.key,
        mintLeavesApplied: cupMintLeaf,
        bananaChipsApplied: cupBananaChip,
        cherryBlossomsApplied: cupCherryBlossom,
        // syrupMessUpCountRef.current -- the balance minigame's own raw
        // mess-up count from whichever syrup pour actually landed (see that
        // ref's own comment further up) -- read here at the handoff, same
        // "last moment this screen's own state still exists" reasoning as
        // everything else this call already reads.
        syrupSpillCount: syrupMessUpCountRef.current,
        // Each topping's own aim-lever offset, normalized to the -1..1
        // fraction scoreToppings' own leverCredit expects (see that
        // function's comment) -- null (rather than 0, which would read as a
        // dead-center catch) when the topping was never applied, same "no
        // reading" null spillCount already uses in scoreMixingDrink's own
        // call site (MilkSelection.js).
        foamPlacementFrac: cupFoam ? foamPourOffset / FOAM_MOVE_RANGE : null,
        powderPlacementFrac: cupPowder ? powderPourOffset / POWDER_MOVE_RANGE : null,
        leafPlacementFrac: cupMintLeaf ? leafPourOffset / LEAF_MOVE_RANGE : null,
        chipPlacementFrac: cupBananaChip ? chipPourOffset / CHIP_MOVE_RANGE : null,
        blossomPlacementFrac: cupCherryBlossom ? blossomPourOffset / BLOSSOM_MOVE_RANGE : null,
        order,
      })
    );
    setDrinkSendPos({
      left: SEND_TO_FINAL_ZONE.left + SEND_TO_FINAL_ZONE.width / 2 - incomingDrinkSize.width / 2,
      top: SEND_TO_FINAL_ZONE.top + SEND_TO_FINAL_ZONE.height / 2 - incomingDrinkSize.height / 2,
    });
    setDrinkSendStage('carrying');
  };

  useEffect(() => {
    if (drinkSendStage === 'carrying') {
      const t = setTimeout(() => setDrinkSendStage('vanishing'), DRINK_SEND_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (drinkSendStage === 'vanishing') {
      const t = setTimeout(() => setDrinkSendStage('sent'), DRINK_SEND_VANISH_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [drinkSendStage]);

  const handleDrinkKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    if (canSendToFinal) {
      playButtonClick();
      beginSendToFinal();
    }
  };

  // ---- Falling syrup stream -- see the big comment on SYRUP_STREAM_COLORS/
  // getSyrupBoxFor above. Anchored to the pouring bottle's own current
  // (offset-nudged) position, falling down to the syrup box's own top edge
  // so it reads as landing right where the syrup will appear.
  const pouringSyrupItem = pouringKey ? toppingItems.find((i) => i.key === pouringKey) : null;
  const pouringSyrupPos = pouringKey ? syrupPositions[pouringKey] : null;
  const syrupPourLeft =
    pouringSyrupItem && pouringSyrupPos ? pouringSyrupPos.left + pouringSyrupItem.width / 2 + pourOffset : 0;
  const syrupPourTop = pouringSyrupItem && pouringSyrupPos ? pouringSyrupPos.top + pouringSyrupItem.height : 0;
  const syrupPourHeight = incomingSyrupBox ? Math.max(incomingSyrupBox.top - syrupPourTop, 1) : 0;
  const syrupPourColor = pouringKey ? SYRUP_STREAM_COLORS[pouringKey] : SYRUP_STREAM_COLORS['guava-syrup'];
  // Balance minigame bar's own fixed position -- see getSyrupMixBarPos'
  // own comment above for why this doesn't need to track the drink's live
  // render position the way syrupPourLeft/Top above conceptually could.
  const syrupMixBarPos = getSyrupMixBarPos();

  // Offset-shifted versions of incomingFoamBox/incomingFoamCapBox (both
  // declared much earlier, before foamPourOffset exists yet as a variable --
  // see LEVER_PERIOD_MS's own big comment for why a missed lever catch now
  // shifts the FINAL landed foam, not just the falling stream, a deliberate
  // departure from syrup's own purely-cosmetic pourOffset). left-shifted
  // only -- top/width/height don't change for a horizontal miss. Used for
  // everything below and in the JSX that cares where foam actually ended up
  // (foamPourHeight, powder/leaf's own foam-cap landing fallback, and the
  // .cup-foam-fill/.cup-foam-cap render further down) in place of the raw
  // incomingFoamBox/incomingFoamCapBox.
  const renderedFoamBox = incomingFoamBox ? { ...incomingFoamBox, left: incomingFoamBox.left + foamPourOffset } : null;
  const renderedFoamCapBox = renderedFoamBox ? getFoamCapBoxFor(renderedFoamBox) : null;

  // ---- Falling foam stream -- same idea as the syrup stream above, just
  // landing at the foam box's own top edge (renderedFoamBox) instead.
  const pouringFoamItem = foamPouringKey ? toppingItems.find((i) => i.key === foamPouringKey) : null;
  const pouringFoamPos = foamPouringKey ? foamPositions[foamPouringKey] : null;
  const foamPourLeft =
    pouringFoamItem && pouringFoamPos ? pouringFoamPos.left + pouringFoamItem.width / 2 + foamPourOffset : 0;
  const foamPourTop = pouringFoamItem && pouringFoamPos ? pouringFoamPos.top + pouringFoamItem.height : 0;
  const foamPourHeight = renderedFoamBox ? Math.max(renderedFoamBox.top - foamPourTop, 1) : 0;
  const foamPourColor = foamPouringKey ? FOAM_STREAM_COLORS[foamPouringKey] : FOAM_STREAM_COLORS['reg-cold-foam'];

  // ---- Falling powder stream -- same idea as the syrup/foam streams
  // above, just landing wherever the powder will actually settle: the
  // foam cap's own top edge if there's foam already in the cup to catch
  // it (cupFoam), otherwise the liquid column's own top edge
  // (incomingPowderLiquidBox) -- see the big comment above POWDER_HOVER_GAP.
  const pouringPowderItem = powderPouringKey ? toppingItems.find((i) => i.key === powderPouringKey) : null;
  const pouringPowderPos = powderPouringKey ? powderPositions[powderPouringKey] : null;
  const powderPourLeft =
    pouringPowderItem && pouringPowderPos
      ? pouringPowderPos.left + pouringPowderItem.width / 2 + powderPourOffset
      : 0;
  const powderPourTop =
    pouringPowderItem && pouringPowderPos ? pouringPowderPos.top + pouringPowderItem.height : 0;
  const powderLandingTop = cupFoam && renderedFoamCapBox ? renderedFoamCapBox.top : incomingPowderLiquidBox?.top;
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
  // don't retroactively jump onto a foam layer added later). left-shifted
  // by powderPourOffset on top of whatever base it's landing on (renderedFoam
  // CapBox already carries foam's own offset, if any, from a mis-poured foam
  // layer -- the two shifts compose naturally by simple addition).
  const powderLandingBoxBase = cupFoam && renderedFoamCapBox ? renderedFoamCapBox : incomingPowderLiquidBox;
  const powderLandingBox = powderLandingBoxBase
    ? { ...powderLandingBoxBase, left: powderLandingBoxBase.left + powderPourOffset }
    : null;
  const powderFleckOffsets = cupFoam && renderedFoamCapBox ? POWDER_FLECK_OFFSETS_ELLIPSE : POWDER_FLECK_OFFSETS_LIQUID;
  const powderFleckPositions =
    cupPowder && powderLandingBox ? getFleckPositions(powderLandingBox, powderFleckOffsets) : [];

  // ---- Where the mint-leaf garnish rests -- same "settle on the foam's
  // own top ellipse if there's foam to catch it, otherwise the plain top
  // layer instead" choice as powderLandingBox just above (a leaf perched on
  // the foam cap reads the same way flecks scattered onto it do). Computed
  // fresh every render off incomingTopBox/renderedFoamCapBox (both of which
  // already track incomingDrinkRenderPos) rather than stored in state, so
  // the garnish automatically glides/vanishes along with the rest of the
  // drink during the Send to Serving carry instead of staying behind.
  // getLeafBoxFor's own offset param (leafPourOffset) applies the leaf's own
  // additional shift on top of whatever this landing box already carries.
  const leafLandingBox = cupFoam && renderedFoamCapBox ? renderedFoamCapBox : incomingTopBox;
  const incomingLeafBox = cupMintLeaf && leafLandingBox ? getLeafBoxFor(leafLandingBox, leafPourOffset) : null;
  // Same "settle on the foam's own top ellipse if there's foam to catch it"
  // choice as leafLandingBox above, for the two newer standalone garnishes.
  const chipLandingBox = cupFoam && renderedFoamCapBox ? renderedFoamCapBox : incomingTopBox;
  const incomingChipBox = cupBananaChip && chipLandingBox ? getChipBoxFor(chipLandingBox, chipPourOffset) : null;
  const blossomLandingBox = cupFoam && renderedFoamCapBox ? renderedFoamCapBox : incomingTopBox;
  const incomingBlossomBox =
    cupCherryBlossom && blossomLandingBox ? getBlossomBoxFor(blossomLandingBox, blossomPourOffset) : null;

  // ---- Spill puddles for a missed lever catch -- see leverMissFor's own
  // comment above. null while nothing's actually been applied yet (nothing
  // to have missed) or the catch was dead-centered.
  const foamSpill = cupFoam ? leverMissFor(foamPourOffset, FOAM_MOVE_RANGE) : null;
  const powderSpill = cupPowder ? leverMissFor(powderPourOffset, POWDER_MOVE_RANGE) : null;
  const leafSpill = cupMintLeaf ? leverMissFor(leafPourOffset, LEAF_MOVE_RANGE) : null;
  const chipSpill = cupBananaChip ? leverMissFor(chipPourOffset, CHIP_MOVE_RANGE) : null;
  const blossomSpill = cupCherryBlossom ? leverMissFor(blossomPourOffset, BLOSSOM_MOVE_RANGE) : null;
  // Lever bar's own fixed position -- see getLeverBarPos' own comment above
  // for why this doesn't need to track the drink's live render position.
  const leverBarPos = getLeverBarPos();

  return (
    <div className="toppings-container" ref={containerRef}>
      <h1 className="sr-only">Toppings Station</h1>

      <div className="toppings-content">
        <img src={TOPPINGS_BACKGROUND_SRC} alt="Toppings station counter" className="toppings-art" />
        {/* All six topping items are now fully interactive (select and
            press Enter to pour) -- matcha-powder/guava-powder were the
            last two still on the old "just a selectable, non-interactive
            placeholder" treatment (see .station-item.selectable in
            ToppingsStation.css, still used elsewhere for genuinely inert
            items), so that placeholder block that used to render them
            (and, before that, the syrup/foam pairs too) has been removed
            entirely rather than left rendering an always-empty filtered
            list. */}
        {/* Guava/mint syrup -- select and press Enter to pour, reusing
            MatchaMaking.css's .station-item.movable (focus glow, .settling)
            rather than this file's own local .selectable, since that's the
            exact focus treatment this needs and it's already loaded
            globally (see the comment on the carried-over cup below for that
            same reasoning). The 180deg flip (WHISK_FLIP_DEG, imported from
            MatchaMaking.js) plays while settling/pouring -- see the big
            comment on SYRUP_HOVER_GAP above for why a full flip rather than
            milk bottles' own partial tilt. */}
        {toppingItems
          .filter((item) => SYRUP_PAIR_WITH_PEACH.some((s) => s.key === item.key))
          .map((item) => {
          const isPouring = pouringKey === item.key;
          const basePos = syrupPositions[item.key];
          const pos = isPouring ? { left: basePos.left + pourOffset, top: basePos.top } : basePos;
          return (
            <img
              key={item.key}
              src={item.src}
              alt={`${item.alt}. Select it and press Enter to pour some in. While it's pouring, use Left/Right to aim the stream.`}
              className={`station-item movable${isPouring ? ' settling' : ''}${
                // Per request: both syrup bottles get the white focus halo
                // the instant showSyrupSpotlight turns on, until the
                // player's first arrow/Enter press (syrupSpotlightMoved --
                // see its own comment above), at which point this drops
                // away and the normal single-bottle :focus-visible halo
                // (see .station-item.movable:focus-visible in
                // MatchaMaking.css) takes back over on its own. Excluded
                // while actually pouring (isPouring), same "don't halo the
                // one mid-animation" reasoning as Milk Selection's own
                // bottles excluding their own isPouring one.
                showSyrupSpotlight && !syrupSpotlightMoved && !isPouring ? ' topping-focus-halo' : ''
              }${
                showSyrupSpotlight ? ' topping-spotlight-exempt' : ''
              }`}
              data-focusable
              data-topping-key={item.key}
              tabIndex={0}
              draggable={false}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${item.width}%`,
                height: `${item.height}%`,
                ...(isPouring ? { transform: `rotate(${WHISK_FLIP_DEG}deg)` } : {}),
              }}
              onKeyDown={handleSyrupKeyDown(item)}
              onFocus={() => setFocusedTopping(item.key)}
              onBlur={() => setFocusedTopping((prev) => (prev === item.key ? null : prev))}
            />
          );
        })}
        {/* Matcha-cold-foam/reg-cold-foam/banana-foam -- select and press
            Enter to pour like the syrup pair above, but landing is now
            decided by the shared aim-lever minigame (see LEVER_PERIOD_MS's
            own big comment) rather than a Left/Right-steered stream; see the
            big comment above FOAM_HOVER_GAP for what's different about where
            foam actually lands. topping-spotlight-exempt applied whenever
            showFoamSpotlight is up, same "punch the pick-phase target
            through the pink tint" treatment the syrup pair's own images get
            from showSyrupSpotlight above -- deliberately NOT also exempted
            during showSyrupSpotlight, since the foam pair should still be
            covered by the pink tint while the player's working through the
            syrup beat, per request ("everything except... the syrups"),
            same for showFoamSpotlight now not exempting the syrup pair
            below (the two beats are mutually exclusive by construction, see
            showFoamSpotlight's own comment, but each only ever exempts its
            own target). */}
        {toppingItems.filter((item) => FOAM_PAIR_WITH_BLUEBERRY.some((f) => f.key === item.key)).map(
          (item) => {
            const isPouring = foamPouringKey === item.key;
            const basePos = foamPositions[item.key];
            const pos = isPouring ? { left: basePos.left + foamPourOffset, top: basePos.top } : basePos;
            return (
              <img
                key={item.key}
                src={item.src}
                alt={`${item.alt}. Select it and press Enter to pour some in. While it's pouring, catch the lever right in the middle to land it clean.`}
                className={`station-item movable${isPouring ? ' settling' : ''}${
                  // Per request: both foam bottles get the white focus halo
                  // the instant showFoamSpotlight turns on, until the
                  // player's first arrow/Enter press (foamSpotlightMoved --
                  // see its own comment above), at which point this drops
                  // away and the normal single-bottle :focus-visible halo
                  // takes back over on its own. Excluded while actually
                  // pouring (isPouring), same "don't halo the one mid-
                  // animation" reasoning as the syrup pair's own images.
                  showFoamSpotlight && !foamSpotlightMoved && !isPouring ? ' topping-focus-halo' : ''
                }${
                  showFoamSpotlight ? ' topping-spotlight-exempt' : ''
                }`}
                data-focusable
                data-topping-key={item.key}
                tabIndex={0}
                draggable={false}
                style={{
                  left: `${pos.left}%`,
                  top: `${pos.top}%`,
                  width: `${item.width}%`,
                  height: `${item.height}%`,
                  ...(isPouring ? { transform: `rotate(${WHISK_FLIP_DEG}deg)` } : {}),
                }}
                onKeyDown={handleFoamKeyDown(item)}
                onFocus={() => setFocusedTopping(item.key)}
                onBlur={() => setFocusedTopping((prev) => (prev === item.key ? null : prev))}
              />
            );
          }
        )}
        {/* Matcha-powder/guava-powder -- select and press Enter to pour like
            the syrup/foam pairs above, but landing is now decided by the
            same shared aim-lever minigame foam uses (see LEVER_PERIOD_MS's
            own big comment) rather than a Left/Right-steered stream; see the
            big comment above POWDER_HOVER_GAP for what's different about
            powder itself (particle stream, foam-dependent landing spot).
            topping-spotlight-exempt applied whenever showPowderSpotlight is
            up, same "punch the pick-phase target through the pink tint"
            treatment the syrup/foam pairs' own images get from their own
            beats -- deliberately not exempt during
            showSyrupSpotlight/showFoamSpotlight, same mutual-exclusivity
            reasoning as those two beats' own images. */}
        {toppingItems.filter((item) => POWDER_PAIR_WITH_CHOCO.some((p) => p.key === item.key)).map((item) => {
          const isPouring = powderPouringKey === item.key;
          const basePos = powderPositions[item.key];
          const pos = isPouring ? { left: basePos.left + powderPourOffset, top: basePos.top } : basePos;
          return (
            <img
              key={item.key}
              src={item.src}
              alt={`${item.alt}. Select it and press Enter to pour some in. While it's pouring, catch the lever right in the middle to land it clean.`}
              className={`station-item movable${isPouring ? ' settling' : ''}${
                // Per request: both powders get the white focus halo the
                // instant showPowderSpotlight turns on, until the player's
                // first arrow/Enter press (powderSpotlightMoved -- see its
                // own comment above), at which point this drops away and
                // the normal single-item :focus-visible halo takes back
                // over on its own. Excluded while actually pouring
                // (isPouring), same "don't halo the one mid-animation"
                // reasoning as the syrup/foam pairs' own images.
                showPowderSpotlight && !powderSpotlightMoved && !isPouring ? ' topping-focus-halo' : ''
              }${
                showPowderSpotlight ? ' topping-spotlight-exempt' : ''
              }`}
              data-focusable
              data-topping-key={item.key}
              tabIndex={0}
              draggable={false}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${item.width}%`,
                height: `${item.height}%`,
                ...(isPouring ? { transform: `rotate(${WHISK_FLIP_DEG}deg)` } : {}),
              }}
              onKeyDown={handlePowderKeyDown(item)}
              onFocus={() => setFocusedTopping(item.key)}
              onBlur={() => setFocusedTopping((prev) => (prev === item.key ? null : prev))}
            />
          );
        })}
        {/* Pot row -- mint-leaves pot (order 2+), banana-chips pot (order
            4+), cherry-blossoms pot (order 5+), growing left of the
            powder pair the same way the syrup/foam rows grow (see potItems
            above). D-pad-selectable but not draggable, same ".selectable"
            treatment MatchaMaking.js's own grade tins use (Enter/Space
            only, no mouse-drag mechanic) -- see the big comment above
            MINT_LEAVES_POT_ITEM in this file. Each pot's alt text/Enter
            action differs by what it actually gives the player, so alt and
            onKeyDown are looked up per item.key rather than hardcoded to
            the leaf's own copy. */}
        {potItems.map((item) => {
          const potAlt =
            item.key === 'banana-chips-pot'
              ? 'pick up a banana chip and place it on the drink'
              : item.key === 'cherry-blossoms-pot'
              ? 'pick up a cherry blossom and place it on the drink'
              : 'pick up a leaf and place it on the drink';
          return (
            <img
              key={item.key}
              src={item.src}
              alt={`${item.alt}. Select it and press Enter to ${potAlt}.`}
              className="station-item selectable"
              data-focusable
              data-topping-key={item.key}
              tabIndex={0}
              style={{
                left: `${item.left}%`,
                top: `${item.top}%`,
                width: `${item.width}%`,
                height: `${item.height}%`,
              }}
              onKeyDown={handlePotKeyDown(item.key)}
              onFocus={() => setFocusedTopping(item.key)}
              onBlur={() => setFocusedTopping((prev) => (prev === item.key ? null : prev))}
            />
          );
        })}
        {/* Name label above whichever topping currently has the white focus
            halo (see focusedTopping above) -- e.g. "guava syrup", "matcha
            foam". A single block covering all six items (rather than one
            per pair) since exactly one of them can be focused at a time;
            pos is worked out the same way each pair's own .map() above
            works it out (its resting position, shifted by that pair's own
            pourOffset while it's actually pouring). Foam is the one
            exception, per request -- its label disappears entirely the
            instant Enter's pressed and the pour actually starts
            (foamPouringKey === item.key), rather than continuing to follow
            the bottle through its own pour animation the way syrup's/
            powder's own labels still do. */}
        {toppingItems
          .filter((item) => item.key === focusedTopping)
          .filter((item) => {
            const isFoam = FOAM_PAIR_WITH_BLUEBERRY.some((f) => f.key === item.key);
            return !(isFoam && foamPouringKey === item.key);
          })
          .map((item) => {
          let pos;
          if (SYRUP_PAIR_WITH_PEACH.some((s) => s.key === item.key)) {
            const basePos = syrupPositions[item.key];
            pos = pouringKey === item.key ? { left: basePos.left + pourOffset, top: basePos.top } : basePos;
          } else if (FOAM_PAIR_WITH_BLUEBERRY.some((f) => f.key === item.key)) {
            const basePos = foamPositions[item.key];
            pos = foamPouringKey === item.key ? { left: basePos.left + foamPourOffset, top: basePos.top } : basePos;
          } else {
            const basePos = powderPositions[item.key];
            pos = powderPouringKey === item.key ? { left: basePos.left + powderPourOffset, top: basePos.top } : basePos;
          }
          return (
            <p
              key={item.key}
              className="topping-label"
              aria-hidden="true"
              style={{
                left: `${pos.left + item.width / 2}%`,
                top: `${pos.top - TOPPING_LABEL_GAP}%`,
              }}
            >
              {TOPPING_LABELS[item.key]}
            </p>
          );
        })}
        {/* Same focus-halo name label as the block above, just for the pot
            row -- it isn't part of toppingItems (it's not one of the
            pour-mechanic pairs that block already iterates), so it needs
            its own small version here, covering all three pots the same
            way the block above covers every syrup/foam/powder item. */}
        {potItems
          .filter((item) => item.key === focusedTopping)
          .map((item) => (
            <p
              key={item.key}
              className="topping-label"
              aria-hidden="true"
              style={{
                left: `${item.left + item.width / 2}%`,
                top: `${item.top - TOPPING_LABEL_GAP}%`,
              }}
            >
              {item.key === 'banana-chips-pot' ? 'banana chips' : item.key === 'cherry-blossoms-pot' ? 'cherry blossoms' : 'mint leaves'}
            </p>
          ))}
        {/* Carried-over drink -- now interactive (select + Enter to send),
            same treatment the bowl/cup themselves get one screen earlier
            once they're ready to move on. Every fill/fleck below is
            positioned off incomingMilkBox/incomingMatchaBox/etc., which are
            themselves computed off incomingDrinkRenderPos (see the big
            comment on that above) -- not the fixed home spot -- so the
            whole assembled drink glides/vanishes together as one piece
            instead of just the cup image moving while its contents stay
            behind. src/width/height come from CUP_TYPES[incomingCupType]
            (see the big comment on incomingCupType above) rather than
            always GlassCup.png/INCOMING_DRINK_SIZE, so this actually
            renders the same cup type (glass, plastic, or mug) the player
            used on Milk Selection instead of always showing the glass one.
            Stops rendering entirely once drinkSendStage reaches 'sent'
            (same "gone once sent" treatment the bowl/cup get). While
            'carrying'/'vanishing' the cup is still rendered but
            pointer-events: none (inline) so it can't be re-selected mid-
            transit, and everything here picks up .bowl-vanishing (reused
            from MatchaMaking.css, already loaded globally) once 'vanishing'
            starts. */}
        {incomingDrink && drinkSendStage !== 'sent' && (
          <>
            <img
              src={CUP_TYPES[incomingCupType].src}
              alt={
                canSendToFinal
                  ? 'Finished drink. Select it and press Enter to send it to Serving.'
                  : 'Finished drink.'
              }
              className={`station-item movable${
                drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''
              }${showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''}`}
              data-focusable
              data-topping-key="cup"
              tabIndex={0}
              draggable={false}
              style={{
                left: `${incomingDrinkRenderPos.left}%`,
                top: `${incomingDrinkRenderPos.top}%`,
                width: `${incomingDrinkSize.width}%`,
                height: `${incomingDrinkSize.height}%`,
                ...(drinkSendStage !== 'idle' ? { pointerEvents: 'none' } : {}),
              }}
              onKeyDown={handleDrinkKeyDown}
            />
            {/* Ice cubes carried over from Milk Selection -- incomingDrink
                only ever carried milk/matcha/cupType across before, so any
                ice the player placed in the cup there was silently getting
                dropped the moment the drink reached this screen. Milk
                Selection's own beginSendDrink now also hands off an
                iceCubes count (see its own comment), and getIceCupSlotPos/
                getIceCubeSize are reused directly from there (both exported
                for exactly this) so the cubes land in the same seven fixed
                cup-relative spots they already use, positioned off
                incomingDrinkRenderPos/incomingDrinkSize like every other
                fill here so they glide/vanish with the rest of the drink
                instead of staying behind. Rendered before the milk fill
                below (same paint-order reasoning Milk Selection's own
                comment gives) so milk/matcha correctly paints over them
                once poured. Purely decorative here -- unlike Milk
                Selection's own cubes, these aren't draggable/focusable;
                the player's ice decisions are already locked in by this
                screen. */}
            {Array.from({ length: incomingDrink.iceCubes ?? 0 }).map((_, index) => {
              const iceCubeSize = getIceCubeSize(incomingCupType);
              const iceSlotPos = getIceCupSlotPos(
                index,
                incomingDrinkRenderPos,
                incomingDrinkSize,
                CUP_TYPES[incomingCupType].bodyFrac,
                CUP_TYPES[incomingCupType].iceYOffsetFrac,
                CUP_TYPES[incomingCupType].iceSpreadScale,
                iceCubeSize
              );
              return (
                <img
                  key={index}
                  src="./IceCube.png"
                  alt=""
                  aria-hidden="true"
                  className={`ice-cube placed${drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''}${
                    showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''
                  }`}
                  style={{
                    left: `${iceSlotPos.left}%`,
                    top: `${iceSlotPos.top}%`,
                    width: `${iceCubeSize.width}%`,
                    height: `${iceCubeSize.height}%`,
                    pointerEvents: 'none',
                  }}
                />
              );
            })}
            {incomingMilkBox && (
              <div
                className={`cup-milk-fill ${incomingDrink.milk.type}${
                  drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''
                }${showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''}`}
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
                className={`cup-matcha-fill ${incomingDrink.matcha.grade}${
                  drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''
                }${showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''}`}
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
            {cupFoam && renderedFoamBox && (
              <div
                className={`cup-foam-fill ${cupFoam.key}${drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''}${
                  showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''
                }`}
                aria-hidden="true"
                style={{
                  left: `${renderedFoamBox.left}%`,
                  top: `${renderedFoamBox.top}%`,
                  width: `${renderedFoamBox.width}%`,
                  height: `${renderedFoamBox.height}%`,
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
            {cupFoam && renderedFoamCapBox && (
              <div
                className={`cup-foam-cap ${cupFoam.key}${drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''}${
                  showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''
                }`}
                aria-hidden="true"
                style={{
                  left: `${renderedFoamCapBox.left}%`,
                  top: `${renderedFoamCapBox.top}%`,
                  width: `${renderedFoamCapBox.width}%`,
                  height: `${renderedFoamCapBox.height}%`,
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
                className={`cup-syrup-fill ${cupSyrup.key}${drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''}${
                  showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''
                }`}
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
                  className={`cup-powder-fleck ${cupPowder.key}${
                    drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''
                  }${showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''}`}
                  aria-hidden="true"
                  style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                />
              ))}
            {/* Mint-leaf garnish -- see incomingLeafBox/getLeafBoxFor above.
                Rendered last of all, on top of everything else already
                poured, same as a real leaf laid across the finished drink's
                own surface. An <img> (not a colored div like the fills
                above) since a leaf actually has real printed detail worth
                showing, not a flat color. */}
            {incomingLeafBox && (
              <img
                src="./MintLeaf.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                className={`cup-leaf-garnish${drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''}${
                  showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''
                }`}
                style={{
                  left: `${incomingLeafBox.left}%`,
                  top: `${incomingLeafBox.top}%`,
                  width: `${incomingLeafBox.width}%`,
                  height: `${incomingLeafBox.height}%`,
                }}
              />
            )}
            {/* Banana chip/cherry blossom garnishes -- same shape as the
                mint-leaf garnish just above (own single-piece PNG, not the
                whole-bowl pot art), reusing .cup-leaf-garnish directly since
                it's already just plain positioning/animation with no color
                of its own. */}
            {incomingChipBox && (
              <img
                src="./BananaChip.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                className={`cup-leaf-garnish${drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''}${
                  showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''
                }`}
                style={{
                  left: `${incomingChipBox.left}%`,
                  top: `${incomingChipBox.top}%`,
                  width: `${incomingChipBox.width}%`,
                  height: `${incomingChipBox.height}%`,
                }}
              />
            )}
            {incomingBlossomBox && (
              <img
                src="./CherryBlossom.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                className={`cup-leaf-garnish${drinkSendStage === 'vanishing' ? ' bowl-vanishing' : ''}${
                  showSyrupSpotlight || showFoamSpotlight || showPowderSpotlight || showSendSpotlight ? ' topping-spotlight-exempt' : ''
                }`}
                style={{
                  left: `${incomingBlossomBox.left}%`,
                  top: `${incomingBlossomBox.top}%`,
                  width: `${incomingBlossomBox.width}%`,
                  height: `${incomingBlossomBox.height}%`,
                }}
              />
            )}
          </>
        )}
        {/* "Send to Serving" drop-zone -- see SEND_TO_FINAL_ZONE/
            canSendToFinal/beginSendToFinal above, same pattern as Milk
            Selection's own "Send to Toppings" zone (reusing its
            .make-drink-zone class directly, since MatchaMaking.css is
            already loaded globally). Appears once there's a drink to send
            and disappears the instant it actually heads there
            (drinkSendStage leaving 'idle'). Not itself focusable -- it's a
            drop target the drink gets sent to via its own Enter press.
            topping-spotlight-exempt applied whenever showSendSpotlight is
            up -- the "bottom right area to take it to the next station" per
            request, one of only two things (along with the cup itself) this
            final beat exempts. Just a plain gray square with a thick arrow
            pointing at it -- no text, no animation (see .make-drink-zone's
            own comment in MatchaMaking.css). */}
        {canSendToFinal && (
          <div
            className={`make-drink-zone${showSendSpotlight ? ' topping-spotlight-exempt' : ''}`}
            aria-hidden="true"
            style={{
              left: `${SEND_TO_FINAL_ZONE.left}%`,
              top: `${SEND_TO_FINAL_ZONE.top}%`,
              width: `${SEND_TO_FINAL_ZONE.width}%`,
              height: `${SEND_TO_FINAL_ZONE.height}%`,
            }}
          >
            <svg className="make-drink-zone-arrow" viewBox="0 0 60 40" preserveAspectRatio="none">
              <polygon points="0,12 32,12 32,2 58,20 32,38 32,28 0,28" />
            </svg>
          </div>
        )}
        {/* Falling syrup stream -- see the big comment on
            SYRUP_STREAM_COLORS/getSyrupBoxFor above. Reuses MatchaMaking.
            css's .spoon-pour/.spoon-pour-grain-N, same as Milk Selection's
            own falling-liquid effect. Only shown during the actual
            'pouring' stage, not 'moving'. topping-spotlight-exempt applied
            whenever showSyrupSpotlight is up (which it always is, for order
            1, by the time this can render -- see that beat's own extended
            condition above) so the stream itself -- the actual "syrup
            pouring out" the pink tint is meant to keep visible -- isn't
            hidden between the (exempt) bottle and the (exempt) cup. */}
        {pourStage === 'pouring' && pouringKey && (
          <div
            className={`spoon-pour${showSyrupSpotlight ? ' topping-spotlight-exempt' : ''}`}
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
        {/* Syrup pour balance minigame -- only up while a syrup's actually
            'pouring' (see the physics effect above). Reuses MatchaMaking.
            css's .mix-bar/.mix-bar-zone/.mix-ball/.mix-bar-highlight/
            .mix-bar-hint classes directly (already loaded globally, since
            App.js imports MatchaMaking.js regardless of which page is
            showing) rather than re-declaring the same gray-bar/green-zone
            look a third time -- same reasoning ToppingsStation.js already
            uses for reusing MilkSelection.css's fill classes. The ball's
            left position and in-zone glow are both written directly to
            syrupBallRef's DOM node every animation frame rather than
            through React props here, same "only needs to exist, not
            re-render" reasoning as MatchaMaking's own mixBallRef.
            aria-hidden throughout -- the pouring bottle's own focusable
            element is what a screen reader user would be interacting with
            instead. topping-spotlight-exempt applied whenever
            showSyrupSpotlight is up (see that beat's own extended condition
            above -- it's always true here for order 1, since this whole
            block only ever renders mid-pour) so the minigame itself stays
            visible/playable through the pink tint, per request. */}
        {pourStage === 'pouring' && pouringKey && (
          <>
            <div
              className={`mix-bar mix-bar-highlight${
                showSyrupSpotlight ? ' topping-spotlight-exempt' : ''
              }`}
              aria-hidden="true"
              style={{
                left: `${syrupMixBarPos.left}%`,
                top: `${syrupMixBarPos.top}%`,
                width: `${SYRUP_MIX_BAR_WIDTH}%`,
                height: `${SYRUP_MIX_BAR_HEIGHT}%`,
              }}
            >
              <span
                className="mix-bar-zone"
                style={{
                  left: `${SYRUP_MIX_ZONE_LEFT_FRAC * 100}%`,
                  width: `${SYRUP_MIX_ZONE_WIDTH_FRAC * 100}%`,
                }}
              />
              <span
                ref={syrupBallRef}
                className="mix-ball"
                // Initial left matches exactly where the physics effect
                // itself resets syrupBallPositionRef to (50 - half the
                // ball's own width) -- same "no flash at the wrong spot for
                // one frame" reasoning as MatchaMaking's own mix-ball.
                style={{
                  left: `${50 - (SYRUP_MIX_BALL_WIDTH_FRAC * 100) / 2}%`,
                  width: `${SYRUP_MIX_BALL_WIDTH_FRAC * 100}%`,
                }}
              />
            </div>
            {/* Old plain-text hint (MatchaMaking.css's .mix-bar-hint,
                already loaded globally) -- stays exactly as before for
                orders 2/3. Suppressed for order 1 (showSyrupSpotlight is up
                the entire time this minigame can render, per that beat's
                own extended condition above) in favor of the new pink
                walkthrough callout just below, same "new pink-styled
                callout replaces the old text hint for the first order only"
                treatment every other beat in this project's walkthrough
                system already uses. */}
            {!showSyrupSpotlight && (
              <p
                className="mix-bar-hint"
                style={{
                  left: `${syrupMixBarPos.left + SYRUP_MIX_BAR_WIDTH / 2}%`,
                  top: `${syrupMixBarPos.top - 11}%`,
                }}
              >
                use your arrow keys to balance the ball inside the green area and pour without spilling.
              </p>
            )}
            {/* New first-order-only walkthrough callout, replacing the hint
                above -- see showSyrupSpotlight's own comment for why this
                beat now spans the whole pour, not just the pre-pour pick.
                Column layout (text above, arrow below pointing down at the
                bar), same shape as .matcha-tin-callout/.milk-ice-callout
                elsewhere in this project. Positioned off the same
                syrupMixBarPos/SYRUP_MIX_BAR_WIDTH math the old hint used
                (centered on the bar's own horizontal midpoint), just shifted
                further up (-18 instead of -11) to leave room for the arrow
                between the card and the bar's own top edge. Eyeballed the
                same way every other exact position in this project is, may
                need a small nudge once actually seen against the live
                render. */}
            {showSyrupSpotlight && (
              <div
                className="topping-pour-callout"
                style={{ left: `${syrupMixBarPos.left + SYRUP_MIX_BAR_WIDTH / 2}%`, top: `${syrupMixBarPos.top - 18}%` }}
              >
                <p className="topping-pour-callout-text">use the arrows to pour the syrup without spilling</p>
                <svg
                  className="topping-pour-callout-arrow"
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
        {/* Shared foam/powder/leaf aim-lever minigame -- see the big comment
            on LEVER_PERIOD_MS above for why one widget covers all three.
            Only up while leverStage === 'active' (one of the three *PourStage/
            leafStage effects flips it there on entering 'aiming', see the
            comment near handleLeverKeyDown). The bar itself is the focus
            target (tabIndex + onKeyDown, auto-focused by the effect above) --
            unlike the syrup balance minigame, which listens on the already-
            focused pouring bottle/tin, there's no separate focused element
            to reuse here since the lever is the entire interaction. Reuses
            the same .mix-bar/.mix-bar-zone/.mix-ball classes the syrup
            minigame above does; the marker is styled as a .mix-ball too
            since it's visually the same "small thing riding the bar" shape,
            just gray (.lever-marker) instead of syrup-green and driven by
            leverMarkerRef every animation frame rather than through React
            state, same reasoning as syrupBallRef above.
            topping-spotlight-exempt applied whenever showFoamSpotlight is
            up AND leverFor === 'foam', OR showPowderSpotlight is up AND
            leverFor === 'powder' -- this same bar is shared with foam/
            powder/leaf's own minigames too (see LEVER_PERIOD_MS's own big
            comment), so it should only punch through the pink tint while
            it's actually the active beat's own turn to use it, not
            whenever any *Spotlight beat happens to be active. */}
        {leverStage === 'active' && (
          <>
            <div
              ref={leverBarRef}
              className={`mix-bar lever-bar${
                (showFoamSpotlight && leverFor === 'foam') || (showPowderSpotlight && leverFor === 'powder')
                  ? ' topping-spotlight-exempt'
                  : ''
              }`}
              tabIndex={0}
              onKeyDown={handleLeverKeyDown}
              style={{
                left: `${leverBarPos.left}%`,
                top: `${leverBarPos.top}%`,
                width: `${LEVER_BAR_WIDTH}%`,
                height: `${LEVER_BAR_HEIGHT}%`,
              }}
            >
              <span
                className="mix-bar-zone lever-zone"
                style={{
                  left: `${(0.5 - LEVER_CENTER_TOLERANCE / 2) * 100}%`,
                  width: `${LEVER_CENTER_TOLERANCE * 100}%`,
                }}
              />
              <span
                ref={leverMarkerRef}
                className="mix-ball lever-marker"
                style={{
                  left: `${50 - (LEVER_MARKER_WIDTH_FRAC * 100) / 2}%`,
                  width: `${LEVER_MARKER_WIDTH_FRAC * 100}%`,
                }}
              />
            </div>
            {/* Same topping-spotlight-exempt condition as the bar itself
                above -- unlike the syrup pour's own mix-bar-hint (replaced
                outright with a pink callout per an earlier request), this
                shared hint hasn't been asked to change text, so it just
                stays legible (exempted, not replaced) through the pink
                tint while it's foam's or powder's own turn on the lever. */}
            <p
              className={`mix-bar-hint${
                (showFoamSpotlight && leverFor === 'foam') || (showPowderSpotlight && leverFor === 'powder')
                  ? ' topping-spotlight-exempt'
                  : ''
              }`}
              style={{ left: `${leverBarPos.left + LEVER_BAR_WIDTH / 2}%`, top: `${leverBarPos.top - 11}%` }}
            >
              press enter/center right on the middle to land it clean.
            </p>
          </>
        )}
        {/* Syrup spill blobs -- one per mess-up during the syrup pour above
            (see syrupSpills/syrupSpillGrowth in that physics effect), using
            the same Spill1-4.png hand-drawn art MatchaMaking's own puddles
            do (see the big comment on SYRUP_SPILL_IMAGES above for the
            mask-image tinting trick), tinted to match whichever syrup was
            actually pouring (SYRUP_STREAM_COLORS) rather than matcha's own
            green. Each stays on screen once it appears (same "the mess
            visibly builds up, doesn't fade" choice as MatchaMaking's own
            puddles) and, per that same precedent, keeps sitting there even
            once the pour itself finishes -- no pourStage gate here,
            syrupSpills only ever gets populated during an actual pour and
            only ever reset at the start of a fresh one (see that effect
            above), so rendering whenever it's non-empty is sufficient on
            its own. */}
        {syrupSpills.length > 0 &&
          (() => {
            const spillColor = SYRUP_STREAM_COLORS[cupSyrup?.key ?? pouringKey ?? 'guava-syrup'];
            const spillGrowthScale = 1 + Math.min(syrupSpillGrowth * SYRUP_SPILL_GROWTH_STEP, SYRUP_SPILL_GROWTH_CAP - 1);
            return syrupSpills.map((spill, i) => {
              const dims = SYRUP_SPILL_DIMS[i];
              const maskUrl = `url(${SYRUP_SPILL_IMAGES[i]})`;
              return (
                <span
                  key={i}
                  aria-hidden="true"
                  className="syrup-spill-puddle"
                  style={{
                    left: `${spill.left}%`,
                    top: `${spill.top}%`,
                    width: `${dims.width}%`,
                    height: `${dims.height}%`,
                    background: spillColor,
                    WebkitMaskImage: maskUrl,
                    maskImage: maskUrl,
                    transform: `translate(-50%, -50%) rotate(${SYRUP_SPILL_STAGE_ROTATIONS[i]}deg) scale(${spillGrowthScale})`,
                  }}
                />
              );
            });
          })()}
        {/* Foam/powder/leaf lever-miss spill puddles -- unlike syrupSpills
            above these are a single one-shot value (foamSpill/powderSpill/
            leafSpill, computed from the persisted *PourOffset once the
            lever is caught, see leverMissFor above) rather than an
            accumulating array, since each topping is only placed once. */}
        {renderToppingSpill(foamSpill, FOAM_STREAM_COLORS[cupFoam?.key], 'foam-spill')}
        {renderToppingSpill(powderSpill, POWDER_STREAM_COLORS[cupPowder?.key], 'powder-spill')}
        {renderToppingSpill(leafSpill, LEAF_SPILL_COLOR, 'leaf-spill')}
        {renderToppingSpill(chipSpill, CHIP_SPILL_COLOR, 'chip-spill')}
        {renderToppingSpill(blossomSpill, BLOSSOM_SPILL_COLOR, 'blossom-spill')}
        {/* Falling foam stream -- same idea as the syrup stream above, see
            the big comment on FOAM_STREAM_COLORS/getFoamHoverPos in this
            file. Only shown during the actual 'pouring' stage.
            topping-spotlight-exempt applied whenever showFoamSpotlight is
            up (always true here for order 1, by the time this can render --
            see that beat's own extended condition above), same "the pour
            itself stays visible through the pink tint" treatment the syrup
            stream gets from showSyrupSpotlight. */}
        {foamPourStage === 'pouring' && foamPouringKey && (
          <div
            className={`spoon-pour${showFoamSpotlight ? ' topping-spotlight-exempt' : ''}`}
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
            POWDER_HOVER_GAP above). topping-spotlight-exempt applied
            whenever showPowderSpotlight is up (always true here for order
            1, by the time this can render -- see that beat's own extended
            condition above), same "the pour itself stays visible through
            the pink tint" treatment the syrup/foam streams get. */}
        {powderPourStage === 'pouring' && powderPouringKey && (
          <div
            className={`spoon-pour${showPowderSpotlight ? ' topping-spotlight-exempt' : ''}`}
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
        {/* First-order-only walkthrough callout, syrup pair -- see
            showSyrupSpotlight above. Row layout, arrow at the START pointing
            LEFT at the syrup pair (opposite orientation from Milk
            Selection's own .milk-cup-callout/.milk-base-callout, which sit
            to the target's left and point right -- here the label sits to
            the target's RIGHT per request, so the arrow has to point the
            other way), same real-SVG-triangle-arrow shape as every other
            walkthrough callout in this project either way. Positioned off
            SYRUP_ITEMS_BASE's own layout math (mint-syrup left: 2.01,
            guava-syrup right edge lands at ~19.7, both sharing SYRUP_TOP: 12
            and TOPPING_HEIGHT: 30) -- left: 22% clears the pair's own right
            edge, top: 27% levels with its vertical center
            (SYRUP_TOP + TOPPING_HEIGHT / 2). Eyeballed the same way every
            other exact position in this project is, may need a small nudge
            once actually seen against the live render. Gated on
            !pouringKey in addition to showSyrupSpotlight itself -- that
            beat now also stays up through the whole pour+minigame (see its
            own extended condition above), but THIS callout is specifically
            the "go pick one" prompt for the picking phase only; once a
            bottle's actually been grabbed, the topping-pour-callout further
            down (pointing at the minigame bar instead) takes over, so
            without this extra !pouringKey check both callouts would render
            at once during the pour. */}
        {showSyrupSpotlight && !pouringKey && (
          <div className="topping-syrup-callout">
            <svg
              className="topping-syrup-callout-arrow"
              viewBox="0 0 40 24"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="2,12 38,2 38,22" />
            </svg>
            <p className="topping-syrup-callout-text">pick the right syrup</p>
          </div>
        )}
        {/* Second first-order-only walkthrough callout, foam pair -- see
            showFoamSpotlight above. Same row layout, arrow at the START
            pointing LEFT at the foam pair, as .topping-syrup-callout above
            (the foam pair sits directly below the syrup pair, same
            STACK_LEFT_MARGIN left edge, so its own callout reuses the exact
            same "sits to the target's right, points left" shape). Positioned
            off FOAM_PAIR_BASE's own layout math (matcha-cold-foam left:
            2.01, reg-cold-foam right edge lands at ~20.2, both sharing
            FOAM_TOP: 45 and TOPPING_HEIGHT: 30) -- left: 22% clears the
            pair's own right edge (same x as the syrup callout above, since
            both pairs share a left edge), top: 60% levels with its vertical
            center (FOAM_TOP + TOPPING_HEIGHT / 2). Eyeballed the same way
            every other exact position in this project is, may need a small
            nudge once actually seen against the live render. */}
        {showFoamSpotlight && (
          <div className="topping-foam-callout">
            <svg
              className="topping-foam-callout-arrow"
              viewBox="0 0 40 24"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="2,12 38,2 38,22" />
            </svg>
            <p className="topping-foam-callout-text">use the arrows to pick the right foam</p>
          </div>
        )}
        {/* Third first-order-only walkthrough callout, powder pair -- see
            showPowderSpotlight above. Unlike the syrup/foam callouts, this
            one sits to its target's LEFT (row layout, arrow at the END
            pointing RIGHT), same orientation as .milk-cup-callout in
            MilkSelection.css -- the powder pair is right-edge-anchored (see
            POWDER_ITEMS' own layout math: right anchor at 100 - EDGE_MARGIN
            = 95), so there's no room for a callout to its right the way the
            left-anchored syrup/foam pairs had. Positioned off that same
            layout math (matcha-powder left: ~79.2, guava-powder right edge
            at ~95, both sharing top: TOPPING_ROW_BOTTOM - POWDER_HEIGHT = 24
            and height: POWDER_HEIGHT = 21) -- right: 21% clears the pair's
            own left edge with a small gap, top: 34.5% levels with its
            vertical center (24 + 21 / 2). Eyeballed the same way every
            other exact position in this project is, may need a small nudge
            once actually seen against the live render. Gated on
            !powderPouringKey in addition to showPowderSpotlight itself --
            same "go pick one" vs "now pour it" distinction as
            .topping-syrup-callout's own !pouringKey guard above, per
            request that this disappear the instant a powder's actually
            been picked rather than staying up through its own pour. */}
        {showPowderSpotlight && !powderPouringKey && (
          <div className="topping-powder-callout">
            <p className="topping-powder-callout-text">use the arrows and pick the right powder</p>
            <svg
              className="topping-powder-callout-arrow"
              viewBox="0 0 40 24"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="38,12 2,2 2,22" />
            </svg>
          </div>
        )}
        {/* Fourth and final first-order-only walkthrough callout, sending
            the drink on -- see showSendSpotlight above. Column layout,
            arrow below pointing down at the cup, positioned directly above
            it (same shape/position as MilkSelection.js's own analogous
            "point at the cup, send it on" callout, .milk-send-callout --
            INCOMING_DRINK_SPOT.top works out to 31.42% here, same as
            CUP_SPOTS.table's own top there, so left: 50%/top: 26% lines up
            the same way). Eyeballed the same way every other exact position
            in this project is, may need a small nudge once actually seen
            against the live render. */}
        {showSendSpotlight && (
          <div className="topping-send-callout">
            <p className="topping-send-callout-text">select the drink to take it to the serving station</p>
            <svg
              className="topping-send-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {/* Fifth and actually-final first-order-only walkthrough callout,
            picking up the instant showSendSpotlight above ends (drinkSend
            Stage reaches 'sent') and running for the rest of this screen's
            lifetime. Same shape as MilkSelection.js's own
            .milk-progress-callout (column layout, arrow below pointing
            down at the ProgressBar/station dots -- spotlightExempt has
            punched a hole through the pink tint there for this beat, see
            the ProgressBar call below) -- there's nothing left on THIS
            screen to point at once the drink's gone, so this points at the
            actual next action (the right-arrow key) via the progress bar
            instead of any one element on the counter. Replaces the old
            plain-text currentStepHint (now suppressed via the
            showAdvanceSpotlight ? null : ... ternary below) with this same
            pink-callout treatment so the whole walkthrough stays visually
            consistent right up to the screen transition -- same "same style
            as the other ones" request every prior beat's own callout
            already follows. */}
        {showAdvanceSpotlight && (
          <div className="topping-progress-callout">
            <p className="topping-progress-callout-text">use your right arrow key to move on to the serving station</p>
            <svg
              className="topping-progress-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {/* First-order-only walkthrough spotlight -- covers this screen's
            five beats. showSyrupSpotlight (the first) spans both the
            picking phase (before any bottle's grabbed) AND the whole
            pour+minigame that follows (see that beat's own extended
            condition above); showFoamSpotlight (the second) does the same
            for the foam pair, picking up the instant showSyrupSpotlight
            ends; showPowderSpotlight (the third) does the same for the
            powder pair, picking up the instant showFoamSpotlight ends;
            showSendSpotlight (the fourth) picks up the instant
            showPowderSpotlight ends and stays up through the whole carry/
            vanish to the Send to Serving zone, same "stay up through the
            whole mechanic" extension every pour beat before it got;
            showAdvanceSpotlight (the fifth and actually-final) picks up the
            instant showSendSpotlight ends and stays up for the rest of this
            screen's lifetime, same "hand the flashing baton to the
            current-step dot itself" shape MilkSelection.js's own final beat
            uses. Same flat, full-screen pink tint (no SVG mask, no holes,
            just a div with a higher-z-index element punched through it) as
            every other spotlight overlay in this project -- see
            .matcha-spotlight-overlay in MatchaMaking.css for the shared
            reasoning. Rendered LAST (after ProgressBar and all five
            callouts above, not before) so it actually paints over
            everything else on this screen by default -- only whichever
            elements the active beat exempts (see topping-spotlight-exempt
            on the cup/ice cube/milk-fill/matcha-fill/foam-fill/foam-cap/
            syrup-fill/powder-fleck/leaf-garnish classNames above, which
            stay exempt across the first FOUR beats, plus the syrup-image/
            falling-syrup-stream/minigame-bar classNames exempt only during
            showSyrupSpotlight, the foam-image/falling-foam-stream/
            lever-bar/lever-hint classNames exempt only during
            showFoamSpotlight (and, for the shared lever bar/hint, only
            when leverFor === 'foam' too), the powder-image/falling-powder-
            stream/lever-bar/lever-hint classNames exempt only during
            showPowderSpotlight (same leverFor === 'powder' caveat), the
            make-drink-zone className exempt only during showSendSpotlight,
            and spotlightExempt on <ProgressBar> itself exempt only during
            showAdvanceSpotlight) punch through it via a higher z-index.
            pointer-events: none so it never blocks input while it's up.
            BUG FIX: this actually has to render AFTER <ProgressBar> (not
            before it, as it originally did here) to work at all --
            .progress-bar-wrap (ProgressBar.css) carries its own hardcoded
            z-index: 25, an exact TIE with this overlay's own z-index: 25,
            and equal-z-index ties resolve by DOM/paint order (later
            element wins), not by which one's "more exempt". With the
            overlay rendered first (as it originally was), the bar -- later
            in the DOM either way -- always won that tie and showed through
            untinted regardless of spotlightExempt, covering the bar during
            this whole walkthrough only by accident never actually working.
            Moving this below <ProgressBar> makes THIS the later element
            instead, so it correctly covers the bar by default now, and only
            spotlightExempt's own explicit z-index: 26 override (see
            .progress-bar-wrap.ordering-spotlight-exempt in
            CustomerOrdering.css) punches back through, exactly as every
            other exempt element on this screen already does. Matches
            MatchaMaking.js/MilkSelection.js, where <ProgressBar> was
            already rendered before their own overlay for this same
            reason. */}
        <OrderReceiptButton order={order} />
        <ProgressBar
          activeStep={activeStep}
          customerNumber={customerNumber}
          onNavigate={onNavigate}
          onAdvance={onAdvance}
          // Final highlight beat for this station: once the drink's fully
          // sent off (drinkSendStage 'sent'), there's nothing left to do
          // here, so the current-step dot flashes as the "ok to move on"
          // signal -- same opt-in highlightCurrentStep/currentStepHint
          // props Milk Selection/MatchaMaking use for their own matching
          // beat.
          highlightCurrentStep={drinkSendStage === 'sent'}
          // Suppressed while showAdvanceSpotlight is up -- the new pink
          // topping-progress-callout below takes over for the first order
          // specifically. Orders 2/3 never set showAdvanceSpotlight, so
          // they keep seeing this plain-text hint exactly as before.
          currentStepHint={
            showAdvanceSpotlight ? null : 'use your right arrow key to move on to the serving station.'
          }
          // Suppresses ProgressBar's own mount-time autoFocus while
          // showSyrupSpotlight is up, same "the spotlight's own focus effect
          // owns where focus lands for this beat, not the progress dots"
          // reasoning as every other station's first walkthrough beat (see
          // showCupSpotlight in MilkSelection.js).
          suppressInitialFocus={showSyrupSpotlight}
          // Punches the ProgressBar itself through the pink tint once
          // showAdvanceSpotlight is up -- the fifth beat's own target, once
          // there's nothing left on the counter to point at. Same prop
          // MilkSelection.js's own final beat uses (see spotlightExempt in
          // MilkSelection.js/ProgressBar.js for the shared reasoning).
          spotlightExempt={showAdvanceSpotlight}
        />
        {(showSyrupSpotlight ||
          showFoamSpotlight ||
          showPowderSpotlight ||
          showSendSpotlight ||
          showAdvanceSpotlight) && <div className="topping-spotlight-overlay" aria-hidden="true" />}
      </div>
    </div>
  );
};

export default ToppingsStation;
