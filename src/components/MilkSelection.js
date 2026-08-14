import React, { useEffect, useMemo, useRef, useState } from 'react';
// MilkSelection.css is now imported once, eagerly, from App.js instead of
// here -- it's reused (class names only, no import) by ToppingsStation.js
// and FinalCombination.js too (both render the carried-over cup's
// .cup-milk-fill), same "multiple lazy chunks share a CSS file that only
// one of them actually imports" shape that caused MatchaMaking.css/
// OrderReceiptButton.css's own webpack "Conflicting order" build failure
// under Vercel's CI=true (see App.js's own import comment) -- fixed
// proactively here before it manifests as the same failure.
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { useFlipGlide } from '../gameloop/useFlipGlide';
import { getActionFromKeyEvent, shouldDebounceEnter } from '../gameloop/pal';
import { playButtonClick, playLiquidPouring, playIceCubeDrop } from '../gameloop/sfx';
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
import { scoreMixingDrink } from '../gameloop/scoring';

// Where the bowl (whisked matcha, no whisk -- see incomingBowl below) sent
// over from MatchaMaking's "Make Drink" drop-zone comes to rest on this
// screen -- computed inside the component itself now (see
// incomingBowlRestWidth/INCOMING_BOWL_SPOT there) rather than as a fixed
// module constant here, since its position depends on ICE_BOX_BOUNDS
// (derived further down from ICE_BOX_SPOTS/ICE_BOX_SIZE) and its own
// resting size depends on BOTTLE_WIDTH -- both module-level values that
// are only safe to reference from inside a function body given where
// they're textually defined relative to this comment's old spot, not from
// another plain module-level const sitting above them.

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

// ---- Plastic cup: second cup option in the cubby -------------------------
// A second slot in the same shelf cubby as the glass cup, with the exact
// same shelf<->table Enter-toggle, milk/matcha pour targeting, ice
// placement, and send-to-Toppings mechanics -- see activeCup in the
// component below for how one shared set of cup logic (unchanged from
// before this was added) now just applies to whichever cup type is
// currently "in play" instead of always the glass one.
//
// PlasticCup.png was re-saved pre-cropped to its own alpha bounding box
// (294x369), same "trimmed tight to the actual drawing, like GlassCup.png
// already is" treatment -- the file the user added had roughly 57% of its
// width as transparent side padding (the cup art centered in a much wider
// canvas), which would have both squished the cup (its aspect ratio
// wouldn't have matched the box) and made it read much smaller than the
// glass cup if used as-is, since most of that box would have been
// invisible padding rather than actual cup.
//
// Sized to match the glass cup's own HEIGHT at each spot (the more
// noticeable size cue when the two sit side by side on the shelf), with
// width following from the plastic cup's own (narrower) canvas aspect
// ratio instead of being forced to match glass's -- same "match height,
// derive width from the source art's own proportions" formula the milk
// bottles use (BOTTLE_WIDTH above), so the cup isn't stretched or squished
// to fit glass's own width.
const PLASTIC_CUP_CANVAS_ASPECT = 294 / 369; // width/height of the (cropped) PlasticCup.png
const PLASTIC_SHELF_SIZE = {
  width: SHELF_SIZE.height * PLASTIC_CUP_CANVAS_ASPECT * (9 / 16),
  height: SHELF_SIZE.height,
};
const PLASTIC_TABLE_SIZE = {
  width: TABLE_SIZE.height * PLASTIC_CUP_CANVAS_ASPECT * (9 / 16),
  height: TABLE_SIZE.height,
};

// Slot 2 of the cubby -- the cabinet's middle compartment in
// MilkMixingStation.png (the glass cup's own shelf spot sits in slot 1).
// Measured off that art's own divider-line pixel positions the same way
// BOTTLE_KEYS' leftPad/rightPad above were measured off each bottle PNG,
// then centered the plastic cup's own (narrower) shelf width on that
// slot's center. Same top as the glass cup's own shelf spot (both sit on
// the same shelf row). Table spot is centered on the exact same table
// centerline CUP_SPOTS.table uses, just recentered for the plastic cup's
// own narrower width -- and needs no separate top adjustment, since
// PLASTIC_TABLE_SIZE shares the glass table box's own height, so both
// cups' bottoms already land on the same baseline.
const PLASTIC_CUP_SPOTS = {
  shelf: { left: 80.24, top: CUP_SPOTS.shelf.top },
  table: {
    left: CUP_SPOTS.table.left + (TABLE_SIZE.width - PLASTIC_TABLE_SIZE.width) / 2,
    top: CUP_SPOTS.table.top,
  },
};

// ---- Mug: third cup option in the cubby -----------------------------------
// The cabinet's third (rightmost) compartment in MilkMixingStation.png --
// previously empty, now filled the same way slot 2 (plastic) filled the
// cabinet's middle one. Exact same shelf<->table Enter-toggle, milk/
// matcha pour targeting, ice placement, and send-to-Toppings mechanics as
// glass/plastic (all of that is already generic over CUP_TYPES[activeCup],
// see the big comment above it -- adding this third entry there is what
// actually turns it on, no mechanic-level code needed).
//
// MugCup.png was cropped to its own alpha bounding box (357x320) before
// being copied into public/, same "trimmed tight to the actual drawing"
// treatment PlasticCup.png already got -- the file the user added had the
// mug's own artwork sitting well inside a much larger canvas. Its own
// bbox reads WIDER than tall (unlike glass/plastic, both narrow columns)
// since the handle sticks out to the side -- MUG_CUP_CANVAS_ASPECT (>1)
// reflects that real proportion rather than assuming a tall-cup shape.
//
// Sized the same "match height, derive width from the source art's own
// proportions" way PLASTIC_SHELF_SIZE/PLASTIC_TABLE_SIZE are above.
const MUG_CUP_CANVAS_ASPECT = 357 / 320; // width/height of the (cropped) MugCup.png
const MUG_SHELF_SIZE = {
  width: SHELF_SIZE.height * MUG_CUP_CANVAS_ASPECT * (9 / 16),
  height: SHELF_SIZE.height,
};
const MUG_TABLE_SIZE = {
  width: TABLE_SIZE.height * MUG_CUP_CANVAS_ASPECT * (9 / 16),
  height: TABLE_SIZE.height,
};

// Slot 3 of the cubby -- the cabinet's rightmost compartment, measured off
// that art's own divider-line pixel positions the same way PLASTIC_CUP_SPOTS'
// own shelf.left was, then centered the mug's own (wider) shelf width on
// that slot's center. Same top as the other two (all three sit on the same
// shelf row). Table spot follows the exact same "recenter on
// CUP_SPOTS.table's centerline" formula PLASTIC_CUP_SPOTS.table uses --
// MUG_TABLE_SIZE shares the glass/plastic table box's own height, so all
// three cups' bottoms land on the same baseline.
const MUG_CUP_SPOTS = {
  shelf: { left: 88.22, top: CUP_SPOTS.shelf.top },
  table: {
    left: CUP_SPOTS.table.left + (TABLE_SIZE.width - MUG_TABLE_SIZE.width) / 2,
    top: CUP_SPOTS.table.top,
  },
};

// Where the mug's own drinkable BODY actually sits within its full
// rendered box (MUG_SHELF_SIZE/MUG_TABLE_SIZE above) -- unlike glass/
// plastic, which are simple columns that fill almost their entire box
// width, the mug's box also has to make room for its handle sticking out
// to the right (see MUG_CUP_CANVAS_ASPECT's own comment), so the actual
// cup body only occupies its LEFT ~68% of that box, not the whole thing.
// Measured directly off MugCup.png's own alpha channel: at the mug's
// vertical middle, the body's opaque pixels span roughly x 10-254 of its
// own 357-wide canvas (0.028-0.712 as a fraction), with a gap of
// transparency, then the separate handle loop, out to the box's own right
// edge. Passed through to getMilkBoxFor/getIceCupSlotPos below (see
// bodyFrac there) so every fill/ice-cube position gets rescaled into this
// narrower, left-shifted region instead of the full box those functions'
// own fractions assume for glass/plastic -- without this, the milk/matcha/
// syrup/foam/powder fills and ice cubes all rendered too far right and too
// wide, encroaching into the handle's own empty space instead of sitting
// inside the mug's actual opening.
// Widened a bit further out (0.028-0.712 -> 0.01-0.74, per follow-up
// request "widen the base liquid and matcha placement on the mug so that
// it fills it better") -- getMatchaBoxFor derives its own width straight
// from the milk box's width (see that function above), so this one change
// widens both fills together without either needing its own separate
// adjustment. Still comfortably inside the handle's own empty space
// (MUG_CUP_CANVAS_ASPECT's own comment above), just less conservative
// than the original alpha-channel measurement.
// Widened again (0.01-0.74 -> 0-0.79, per follow-up request "widen the
// liquid inside the mug more") -- same reasoning as the step above, still
// well clear of the handle loop (MUG_CUP_CANVAS_ASPECT's own comment), and
// still shared by every downstream box (getMatchaBoxFor, ToppingsStation's
// getFoamBoxFor/getSyrupBoxFor/getPowderLiquidBoxFor/getLeafBoxFor) so this
// one change widens the whole drink column together on every screen it
// appears on (MilkSelection, ToppingsStation, FinalCombination).
const MUG_CUP_BODY_FRAC = { left: 0, right: 0.79 };

// One entry per cup type -- all three sit in the cubby, but only one is ever
// "the" cup actually in play (see activeCup in the component below).
// Bundling each type's own art/positions/sizes here is what lets the
// shelf<->table Enter-toggle, milk/matcha pour targeting, ice placement, and
// send-to-Toppings logic stay written once, generically, keyed off
// whichever type is currently active, rather than duplicated per cup.
// Exported so ToppingsStation.js/FinalCombination.js can look up the right
// cup art/size for whichever type was actually used here (see cupType on
// the object beginSendDrink below hands off to onSendToToppings), instead
// of always assuming glass for the carried-over cup on those screens. Also
// what actually closes the "a mug order can never be matched" scoring gap
// (see gameloop/scoring.js's own scoreMixingDrink) -- that comparison was
// always keyed on CUP_TYPES having a 'mug' entry, it just didn't exist yet.
export const CUP_TYPES = {
  glass: {
    src: './GlassCup.png',
    alt: 'Glass cup',
    shelfSpot: CUP_SPOTS.shelf,
    shelfSize: SHELF_SIZE,
    tableSpot: CUP_SPOTS.table,
    tableSize: TABLE_SIZE,
  },
  plastic: {
    src: './PlasticCup.png',
    alt: 'Plastic cup',
    shelfSpot: PLASTIC_CUP_SPOTS.shelf,
    shelfSize: PLASTIC_SHELF_SIZE,
    tableSpot: PLASTIC_CUP_SPOTS.table,
    tableSize: PLASTIC_TABLE_SIZE,
    // Only the plastic cup needs this -- ICE_CUP_SLOT_FRACTIONS' y values
    // were tuned against the glass cup's own taper (see the comment on
    // getIceCupSlotPos below) and land noticeably too high once rendered
    // against the plastic cup's own art/proportions. This nudges ice cubes
    // down by this fraction of the cup's own height, glass/mug untouched.
    iceYOffsetFrac: 0.05,
    // Per request, plastic cup only -- extends the base liquid's (milk/
    // matcha fill's) own bottom edge further down by this fraction of the
    // cup's own height (see getMilkBoxFor's own bottomExtraFrac param),
    // closing a visible gap between the fill's bottom and the plastic
    // cup's own art's visible floor that CUP_MILK_BOX_FRAC.bottomFrac's
    // shared 0.94 doesn't quite reach for this cup type. Glass/mug
    // untouched (no bottomExtraFrac of their own, so getMilkBoxFor's
    // default of 0 applies). Nudged up a touch further (0.03 -> 0.05) per
    // follow-up request ("just a little further down").
    bottomExtraFrac: 0.05,
  },
  mug: {
    src: './MugCup.png',
    alt: 'Mug',
    shelfSpot: MUG_CUP_SPOTS.shelf,
    shelfSize: MUG_SHELF_SIZE,
    tableSpot: MUG_CUP_SPOTS.table,
    tableSize: MUG_TABLE_SIZE,
    // Only the mug needs this -- see MUG_CUP_BODY_FRAC's own comment above.
    // Left undefined for glass/plastic so getMilkBoxFor/getIceCupSlotPos's
    // own default parameter (the full box, no rescaling) applies instead.
    bodyFrac: MUG_CUP_BODY_FRAC,
    // Ice cubes read too small, too clustered, and sit too high once
    // rendered against the mug's own (much stockier/shorter) proportions --
    // these three only apply to the mug, glass/plastic untouched. See
    // getIceCupSlotPos/getIceCubeSize below for how each is actually used.
    iceYOffsetFrac: 0.01,
    iceSizeScale: 1.15,
    iceSpreadScale: 1.4,
    // Per request, mug only -- widens the liquid (and everything derived
    // from its box: matcha fill, foam, syrup, powder-liquid) on its LEFT
    // side specifically (see getMilkBoxFor's own leftExtraFrac param),
    // leaving the right edge exactly where it already was.
    leftExtraFrac: 0.05,
    // Per request ("lower it a bit"), mug only -- extends the liquid
    // further down rather than shifting it (same bottomExtraFrac mechanism
    // CUP_TYPES.plastic already uses above), stretching the bottom edge
    // down while the top stays put.
    bottomExtraFrac: 0.04,
  },
};

// Display name per cup type, shown as a label above whichever cup currently
// has focus (see focusedCupType/.cup-label below) -- same "selected" ==
// "has the focus halo" idea, same dark-brown/no-glow-of-its-own look, as
// MatchaMaking.js's own TIN_LABELS/.matcha-tin-label and this file's own
// BOTTLE_LABELS/.milk-bottle-label.
const CUP_LABELS = {
  glass: 'glass cup',
  plastic: 'plastic cup',
  mug: 'mug',
};

// Gap between a cup's own top edge and its label above it -- same
// "translate(-50%, -100%) lifts the label fully above this anchor line"
// convention as BOTTLE_LABEL_GAP.
const CUP_LABEL_GAP = 4;

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
// Base four, always available. Strawberry milk (added per request, order 2
// onward only -- see strawberryUnlocked in the component below) sits at the
// end of this list so it lands as the new rightmost bottle once unlocked --
// see layoutBottles below for how that "shifts everything else left, new
// one ends up at the old rightmost edge" effect actually happens.
// leftPad/rightPad measured off StrawberryMilk.png's own alpha bounding box
// (169x325 canvas, bbox (24, 55, 108, 265)) the same way as every other
// bottle here -- turns out to exactly match oat's own bottle silhouette
// bounds (same canvas size, same bbox), hence the identical fractions.
const BOTTLE_KEYS_BASE = [
  { key: 'oat', src: './OatMilk.png', alt: 'Oat milk', leftPad: 24 / 169, rightPad: (169 - 108) / 169 },
  { key: 'dairy', src: './DairyMilk.png', alt: 'Dairy milk', leftPad: 34 / 170, rightPad: (170 - 136) / 170 },
  { key: 'almond', src: './AlmondMilk.png', alt: 'Almond milk', leftPad: 34 / 169, rightPad: (169 - 119) / 169 },
  { key: 'coconut', src: './CoconutWater.png', alt: 'Coconut water', leftPad: 67 / 169, rightPad: (169 - 144) / 169 },
];
const BOTTLE_KEYS_WITH_STRAWBERRY = [
  ...BOTTLE_KEYS_BASE,
  { key: 'strawberry', src: './StrawberryMilk.png', alt: 'Strawberry milk', leftPad: 24 / 169, rightPad: (169 - 108) / 169 },
];
// Sparkling yuzu (order 3 onward -- moved up from order 4 per a later
// request -- see yuzuUnlocked in the component below) sits at the end of
// this list too, same "new one lands as the new rightmost bottle" reasoning
// as strawberry above -- stacks on top of it rather than replacing it, so
// order 3+ gets all six. leftPad/rightPad measured off SparklingYuzu.png's
// own alpha bounding box (169x325 canvas, bbox (67, 53, 144, 264)) the same
// way as every other bottle here -- turns out to exactly match coconut's
// own bounds, hence the identical fractions.
const BOTTLE_KEYS_WITH_YUZU = [
  ...BOTTLE_KEYS_WITH_STRAWBERRY,
  { key: 'yuzu', src: './SparklingYuzu.png', alt: 'Sparkling yuzu', leftPad: 67 / 169, rightPad: (169 - 144) / 169 },
];
// Jasmine tea -- new order-4-and-later bottle, per request, stacking on top
// of yuzu the same way every earlier bottle stacked on the last (nothing
// ever drops off the counter). leftPad/rightPad measured off JasmineTea.png's
// own alpha bounding box (360x693 canvas, bbox (53, 120, 230, 569)) the same
// way as every other bottle here -- its canvas is a different pixel size
// than the original four/five/six (169x325-ish) but a near-identical aspect
// ratio (360/693 = 0.5195 vs 169/325 = 0.52), close enough that reusing the
// same shared BOTTLE_CANVAS_ASPECT-derived box for it reads as the same
// bottle size as its neighbors, same tolerance this project already accepts
// elsewhere (see BANANA_FOAM_ITEM's own canvasAspect comment in
// ToppingsStation.js for a similar "close enough" call).
const BOTTLE_KEYS_WITH_JASMINE = [
  ...BOTTLE_KEYS_WITH_YUZU,
  { key: 'jasmine', src: './JasmineTea.png', alt: 'Jasmine tea', leftPad: 53 / 360, rightPad: (360 - 230) / 360 },
];

// Display name per bottle, shown as a label beneath whichever one currently
// has focus (see focusedBottle/.milk-bottle-label below) -- same
// "selected" == "has the focus halo" idea, and same pastel-pink/no-glow
// look, as MatchaMaking.js's own TIN_LABELS/.matcha-tin-label.
const BOTTLE_LABELS = {
  oat: 'oat milk',
  dairy: 'dairy milk',
  almond: 'almond milk',
  coconut: 'coconut water',
  strawberry: 'strawberry milk',
  yuzu: 'sparkling yuzu',
  jasmine: 'jasmine tea',
};

// Small gap between a bottle's own top edge and its label above it --
// negative on purpose, so the label overlaps down into the top of the
// bottle's own art a little rather than floating clear above it.
const BOTTLE_LABEL_GAP = -3.5;

// Walk left-to-right so each bottle's visible content (box left + leftPad,
// through box left + (1 - rightPad) * BOTTLE_WIDTH) sits exactly
// BOTTLE_VISUAL_GAP past the previous bottle's, then shift the whole row so
// it's centered on BOTTLE_CLUSTER_CENTER -- re-centering around the same
// fixed point is exactly what makes adding a bottle to the end shift every
// bottle left to make room, rather than only growing further right.
// Pulled out into its own function (rather than one inline module-level
// computation, like this used to be) so it can run multiple times below --
// once for the base four, once for all five with strawberry, once for all
// six with sparkling yuzu too -- letting order 1 keep the exact original
// tight four-bottle layout while later orders get progressively wider ones,
// instead of showing an empty gap where a locked bottle would otherwise
// sit. bottleWidth/bottleHeight/gap default to the module constants (every
// tier through strawberry uses them as-is) but can be overridden smaller --
// see BOTTLE_WIDTH_YUZU_TIER/BOTTLE_HEIGHT_YUZU_TIER/BOTTLE_VISUAL_GAP_
// YUZU_TIER below: six bottles at the base size would run the cluster's
// right edge past the container's own right edge (BOTTLE_CLUSTER_CENTER=83
// plus six bottles' worth of width already pushes the *five*-bottle
// strawberry tier to a right edge of ~100.6%, barely-tolerable overflow;
// six pushes it to ~102%), so that tier scales everything down instead,
// same "shrink to fit the same footprint" fix as MatchaMaking's own
// STATIC_ITEMS_WITH_HOJICHA over STATIC_ITEMS_BASE.
function layoutBottles(keys, bottleWidth = BOTTLE_WIDTH, bottleHeight = BOTTLE_HEIGHT, gap = BOTTLE_VISUAL_GAP) {
  const boxLefts = [0];
  for (let i = 1; i < keys.length; i += 1) {
    const prev = keys[i - 1];
    const gapNeeded = (1 - prev.rightPad - keys[i].leftPad) * bottleWidth + gap;
    boxLefts.push(boxLefts[i - 1] + gapNeeded);
  }
  const clusterBoxWidth = boxLefts[boxLefts.length - 1] + bottleWidth - boxLefts[0];
  const clusterStartLeft = BOTTLE_CLUSTER_CENTER - clusterBoxWidth / 2;

  const items = keys.map((item, index) => ({
    key: item.key,
    src: item.src,
    alt: item.alt,
    left: clusterStartLeft + boxLefts[index],
    top: BOTTLE_BOTTOM - bottleHeight,
    width: bottleWidth,
    height: bottleHeight,
  }));

  // Each bottle's counter spot, keyed for lookup -- both the starting
  // position on mount and the "home" a bottle snaps back to on Enter when
  // the pour preconditions aren't met (see handleBottleKeyDown below).
  const home = items.reduce((acc, item) => {
    acc[item.key] = { left: item.left, top: item.top };
    return acc;
  }, {});

  return { items, home };
}

const { items: BOTTLE_ITEMS_BASE, home: BOTTLE_HOME_BASE } = layoutBottles(BOTTLE_KEYS_BASE);
const { items: BOTTLE_ITEMS_WITH_STRAWBERRY, home: BOTTLE_HOME_WITH_STRAWBERRY } = layoutBottles(
  BOTTLE_KEYS_WITH_STRAWBERRY
);
// Scale factor solved so all six bottles' cluster width comes out to 28
// (container %), landing the row at 69-97 -- centered on the same
// BOTTLE_CLUSTER_CENTER=83 every other tier uses, symmetric margin from
// both container edges. width/height/gap all scale together (~0.734x) so
// the row just reads as a slightly smaller, denser version of the same
// layout rather than a differently-proportioned one.
const BOTTLE_YUZU_TIER_SCALE = 0.7338;
const BOTTLE_WIDTH_YUZU_TIER = BOTTLE_WIDTH * BOTTLE_YUZU_TIER_SCALE;
const BOTTLE_HEIGHT_YUZU_TIER = BOTTLE_HEIGHT * BOTTLE_YUZU_TIER_SCALE;
const BOTTLE_VISUAL_GAP_YUZU_TIER = BOTTLE_VISUAL_GAP * BOTTLE_YUZU_TIER_SCALE;
const { items: BOTTLE_ITEMS_WITH_YUZU, home: BOTTLE_HOME_WITH_YUZU } = layoutBottles(
  BOTTLE_KEYS_WITH_YUZU,
  BOTTLE_WIDTH_YUZU_TIER,
  BOTTLE_HEIGHT_YUZU_TIER,
  BOTTLE_VISUAL_GAP_YUZU_TIER
);
// Jasmine tea (order 4+) makes seven bottles -- the yuzu tier's own 0.7338
// scale was solved specifically for six to land the cluster at a 28%-wide
// footprint (69-97, centered on BOTTLE_CLUSTER_CENTER); a seventh bottle at
// that same scale would push the cluster to ~34% wide. Solved the same way
// (clusterBoxWidth scales linearly with width/height/gap, since every term
// in layoutBottles' own gap formula is proportional to bottleWidth) so all
// seven land at that identical 28%-wide footprint instead of growing past
// it -- same "shrink to fit the same footprint" fix as the yuzu tier's own
// comment above, and MatchaMaking's STATIC_ITEMS_WITH_HOJICHA before that.
const BOTTLE_JASMINE_TIER_SCALE = 0.6049;
const BOTTLE_WIDTH_JASMINE_TIER = BOTTLE_WIDTH * BOTTLE_JASMINE_TIER_SCALE;
const BOTTLE_HEIGHT_JASMINE_TIER = BOTTLE_HEIGHT * BOTTLE_JASMINE_TIER_SCALE;
const BOTTLE_VISUAL_GAP_JASMINE_TIER = BOTTLE_VISUAL_GAP * BOTTLE_JASMINE_TIER_SCALE;
const { items: BOTTLE_ITEMS_WITH_JASMINE, home: BOTTLE_HOME_WITH_JASMINE } = layoutBottles(
  BOTTLE_KEYS_WITH_JASMINE,
  BOTTLE_WIDTH_JASMINE_TIER,
  BOTTLE_HEIGHT_JASMINE_TIER,
  BOTTLE_VISUAL_GAP_JASMINE_TIER
);

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

// ---- Milk pour: plain click-and-pour, no minigame --------------------------
// Per request: the balance-the-ball minigame (bar/zone/ball, physics tick,
// and the spill puddles it could trigger) never rendered visibly during the
// pour -- reported as invisible even after hardening its z-index -- so it's
// removed entirely rather than debugged further. Pouring is back to the
// plain "glide to hover spot, tip, fill the cup" sequence every bottle (and
// the matcha bowl) already used for the 'moving' -> 'pouring' legs; there's
// no longer a distinct middle stage or way to "spill" a pour at all. See
// beginPour/the pourStage effect further down for the simplified sequence,
// and scoreMixingDrink in gameloop/scoring.js (no longer passed a
// spillCount) for the scoring side of this same removal.

// How long the finished cup takes to glide into the Send Drink zone, how
// long it then just sits there shrunk before heading off, and how long the
// slide-off itself takes -- same values, and same "carry, hover-shrunk,
// slide off to the right" shape, as MatchaMaking's own BOWL_CARRY_MOVE_MS/
// BOWL_HOVER_MS/BOWL_VANISH_MS, whose .bowl-arrived/.bowl-slide-off CSS
// (MatchaMaking.css, already loaded globally) this reuses directly rather
// than duplicating -- same "reuse rather than risk drifting out of sync"
// reasoning as this file's own reuse of .make-drink-zone/.bowl-vanishing/
// .station-item-wrap elsewhere.
const CUP_SEND_MOVE_MS = 350;
const CUP_SEND_HOVER_MS = 1000;
const CUP_SEND_VANISH_MS = 450;

// Where the milk fill sits inside the cup once poured (see cupMilk/
// beginPour below), as a fraction of the cup's own current box -- tracks the
// cup's live position/size every render (see getMilkBoxFor/cupMilkBox and
// getIceCupSlotPos below), same as MatchaMaking's bowl-water/bowl-powder
// track the mixing bowl. Inset from the cup's own box as a rough
// approximation of the glass's tapered interior -- not a pixel-perfect
// trace of the silhouette, same simplification as the matcha bowl's own
// circular bowl-water/bowl-powder fills.
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
  strawberry: 'rgba(250, 200, 210, 0.92)',
  // Sampled off SparklingYuzu.png's own liquid color (dominant fill ~
  // rgb(240, 184, 8)), same "matches the bottle art" reasoning as every
  // other entry here.
  yuzu: 'rgba(245, 190, 40, 0.92)',
  // Sampled off JasmineTea.png's own liquid color (its lower, below-label
  // portion of the bottle body, away from the pale lavender cap/label --
  // ~rgb(220, 196, 145)), same "matches the bottle art" reasoning as every
  // other entry here.
  jasmine: 'rgba(220, 196, 145, 0.92)',
};

// Generic version of the milk-box math, parameterized on a cup position/
// size -- exported so ToppingsStation.js can compute the same box against
// its own carried-over cup's position/size (INCOMING_DRINK_SPOT/
// INCOMING_DRINK_SIZE there) without duplicating CUP_MILK_BOX_FRAC's actual
// fraction values. This screen's own cupMilkBox (further down) just calls
// this with the cup's own live cupRenderPos/cupRenderSize, recomputed every
// render so the fill tracks the cup wherever it currently is.
//
// bodyFrac (left/right, both 0-1 fractions of cupSize.width) is where the
// cup's own drinkable body actually sits within its full rendered box --
// defaults to the whole box (0-1), correct as-is for glass/plastic, whose
// boxes ARE basically just the body. The mug needs something narrower (see
// MUG_CUP_BODY_FRAC's own comment) since its box also has to fit a handle
// that isn't part of the liquid-holding body at all -- CUP_MILK_BOX_FRAC's
// own leftFrac/rightFrac/etc. below get rescaled into whatever sub-range
// bodyFrac describes instead of always spanning the full box, so every
// downstream box that derives from this one (getMatchaBoxFor, and
// ToppingsStation.js's own getFoamBoxFor/getSyrupBoxFor/
// getPowderLiquidBoxFor/getLeafBoxFor, all of which read this box's own
// left/width rather than the cup's directly) automatically inherits the
// same narrower, left-shifted placement with no changes of their own
// needed.
//
// bottomExtraFrac (0-1, fraction of cupSize.height) pushes the box's own
// bottom edge down past CUP_MILK_BOX_FRAC.bottomFrac's usual 0.94, plastic
// cup only (see CUP_TYPES.plastic.bottomExtraFrac's own comment) -- that
// cup's own art has more visible "floor" below the shared 0.94 line than
// glass/mug do, which read as a gap between the base liquid's own bottom
// edge and the cup's actual visible bottom. Defaults to 0 (no change) for
// every other cup type/caller.
//
// leftExtraFrac (0-1, fraction of bodyWidth) pushes the box's own left edge
// further left past CUP_MILK_BOX_FRAC.leftFrac's usual 0.08 inset, widening
// the visible liquid only on its left side (the right edge, and everything
// derived from this box's own width elsewhere, is untouched) -- mug only
// (see CUP_TYPES.mug.leftExtraFrac's own comment), per request "widen
// liquid in cup on the left side". Defaults to 0 (no change) for every
// other cup type/caller, same shape as bottomExtraFrac above.
export function getMilkBoxFor(cupPos, cupSize, bodyFrac = { left: 0, right: 1 }, bottomExtraFrac = 0, leftExtraFrac = 0) {
  const bodyLeft = cupPos.left + bodyFrac.left * cupSize.width;
  const bodyWidth = (bodyFrac.right - bodyFrac.left) * cupSize.width;
  const leftExtra = leftExtraFrac * bodyWidth;
  return {
    left: bodyLeft + CUP_MILK_BOX_FRAC.leftFrac * bodyWidth - leftExtra,
    top: cupPos.top + CUP_MILK_BOX_FRAC.topFrac * cupSize.height,
    width: (CUP_MILK_BOX_FRAC.rightFrac - CUP_MILK_BOX_FRAC.leftFrac) * bodyWidth + leftExtra,
    height: (CUP_MILK_BOX_FRAC.bottomFrac - CUP_MILK_BOX_FRAC.topFrac + bottomExtraFrac) * cupSize.height,
  };
}

// Converts an absolute box (left/top/width/height, all in container %, same
// units getMilkBoxFor/getMatchaBoxFor/getIceCupSlotPos already return) into
// a box expressed as a percentage of the cup's OWN current box (cupPos/
// cupSize, also container %) instead -- i.e. what that same box's left/top/
// width/height would need to be if it were rendered as a CHILD nested
// inside a wrapper element that's already positioned/sized to cupPos/
// cupSize, rather than as an independent top-level sibling.
//
// Used for the milk fill/matcha fill/placed ice cubes once they're nested
// inside the active cup's own .cup-wrap (see the isActive branch of the
// cup-type map further down) instead of being separately absolutely-
// positioned elements recomputed from cupPos on every render -- nesting
// them means they only ever move because their PARENT wrapper moves
// (whether that's the plain left/top glide to the Send Drink zone, or the
// shrink/slide-off once it's arrived there), the same "one shared parent
// carries the whole group" fix MatchaMaking.js uses for its own bowl +
// whisked-liquid image (see the isBowl branch in MOVABLE_ITEMS.map()
// there) -- rather than each one separately trying to track/animate to
// match the cup's own motion and risking drifting out of sync with it,
// which is exactly the bug this whole thing is fixing.
//
// The math works out to a pure ratio with cupPos's own absolute position
// canceling out entirely (a box's offset FROM the cup's own top-left
// corner, divided by the cup's own size) -- so this doesn't care whether
// the cup is currently on the shelf, the table, or mid-carry, only that
// `box` and `cupPos`/`cupSize` were computed against the SAME live
// cupPos/cupSize this render (which every call site below already does).
export function toCupRelative(box, cupPos, cupSize) {
  return {
    left: ((box.left - cupPos.left) / cupSize.width) * 100,
    top: ((box.top - cupPos.top) / cupSize.height) * 100,
    width: (box.width / cupSize.width) * 100,
    height: (box.height / cupSize.height) * 100,
  };
}

// This used to be a zero-arg wrapper hardcoded to CUP_SPOTS.table/TABLE_SIZE
// (the cup's resting table spot), which meant the milk/matcha fills stayed
// glued to that one spot even once the cup was dragged elsewhere or carried
// off to the Send Drink zone -- confirmed as a real bug (the liquid and ice
// cubes were left behind on the table while the empty glass itself glided
// away). Removed in favor of just calling the already-live-position-aware
// getMilkBoxFor(cupRenderPos, cupRenderSize) directly at each call site
// below, same as MatchaMaking.js recomputes bowlPowderLeft/Top off the
// bowl's own current bowlPos every render instead of a fixed spot.

// Matcha poured on top of the milk/water base -- a second fill the same
// width as the milk box (cupMilkBox), split into two zones so it reads
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

// Explicit fixed adjacency graph for arrow-key movement between the seven
// piled cubes -- same "exact fixed graph, not generic spatial nearest-
// neighbor matching" approach as every other row/column of items in this
// file (bottles, shelf cups, etc.), rather than leaning on
// useFlatFocusNav's own generic spatial fallback, which isn't reliable
// against this pile's ragged bottom edge (left column has 4 cubes, right
// only 3 -- see ICE_BOX_SPOTS above). Left column is indices 0-3 top to
// bottom, right column is indices 4-6 top to bottom, and each left-column
// cube pairs with the right-column cube at the same row (0<->4, 1<->5,
// 2<->6); index 3 (bottom of the taller left column) has no right-column
// partner, and neither column has anything further left/right, so those
// directions are `null` (trap -- keeps focus right where it is). 'gear'/
// 'station' mean "leave the pile entirely" (top row -> the settings gear,
// bottom row -> the ProgressBar's current station dot, matching the nav-
// graph effect's other legs) -- gated by restrictIceVerticalNavRef so the
// first-order ice-placing walkthrough beat (showIceSpotlight) can trap the
// player inside the pile and only allow moving between cubes.
const ICE_ADJACENCY = {
  0: { up: 'gear', down: 1, left: null, right: 4 },
  1: { up: 0, down: 2, left: null, right: 5 },
  2: { up: 1, down: 3, left: null, right: 6 },
  3: { up: 2, down: 'station', left: null, right: null },
  4: { up: 'gear', down: 5, left: 0, right: null },
  5: { up: 4, down: 6, left: 1, right: null },
  6: { up: 5, down: 'station', left: 2, right: null },
};
const ICE_BOX_SIZE = { width: 5.03, height: 9.196 };
// width/height are percentages of the container's own width/height
// respectively (1920x1080 -- see .mixing-stage's aspect-ratio in
// MilkSelection.css), which are NOT the same pixel scale as each other, so
// matching IceCube.png's true on-screen aspect ratio to the ice box's own
// (ICE_BOX_SIZE) takes converting through actual pixels rather than just
// picking width/height percentages that "look" proportionate. This used to
// be { width: 4, height: 4.11 } -- nearly a 1:1 percentage ratio -- which
// in real pixels (4% of 1920 x 4.11% of 1080 = 76.8 x 44.4) came out
// visibly flattened/squished compared to the box's own true ~0.97 (nearly
// square) aspect ratio. These values instead preserve that same true
// aspect ratio while keeping roughly the same on-screen area as before, so
// placed cubes read as a smaller, undistorted version of the box art
// rather than a stretched one.
export const ICE_CUP_SIZE = { width: 3.3, height: 6.05 };

// Scales ICE_CUP_SIZE up/down per cup type -- only the mug sets
// iceSizeScale (its cubes read too small at the glass-tuned base size, see
// CUP_TYPES.mug.iceSizeScale), everything else falls through to the
// default (unscaled) size. Kept as its own helper, rather than inlined at
// each call site, so getIceCupSlotPos's own cubeSize param and the JSX's
// render width/height always agree on the exact same size.
export function getIceCubeSize(cupType) {
  const scale = CUP_TYPES[cupType]?.iceSizeScale || 1;
  if (scale === 1) return ICE_CUP_SIZE;
  return { width: ICE_CUP_SIZE.width * scale, height: ICE_CUP_SIZE.height * scale };
}
// Cluster near the bottom of the glass instead of floating at the rim --
// y values follow the taper of GlassCup.png (verified against a stretched
// preview of the art). Five cubes form a front row along the glass floor;
// the other two sit as a back layer tucked above/behind the outer front
// cubes (rather than spread out to the sides, which is what used to poke
// them slightly outside the glass's tapered walls).
const ICE_CUP_SLOT_FRACTIONS = [
  { x: 0.43, y: 0.715 },
  { x: 0.57, y: 0.715 },
  { x: 0.30, y: 0.756 },
  { x: 0.40, y: 0.789 },
  { x: 0.50, y: 0.80 },
  { x: 0.60, y: 0.789 },
  { x: 0.70, y: 0.766 },
];

// Takes the cup's own *current* position AND size (cupPos/cupSize, passed
// in by both call sites below) rather than hardcoding CUP_SPOTS.table/
// TABLE_SIZE like this used to -- same fix as getMilkBoxFor/getMatchaBoxFor
// above, needed for the same reason: placed ice cubes were staying behind
// on the table once the cup was dragged or carried off to the Send Drink
// zone instead of riding along with it. cupSize is now also required
// (rather than always TABLE_SIZE) so this places cubes correctly against
// whichever cup type is active -- see CUP_TYPES/activeCup in the component.
// ICE_CUP_SLOT_FRACTIONS themselves were only ever tuned against
// GlassCup.png's own taper, so this is a reasonable approximation rather
// than a pixel-perfect trace when the plastic cup is the active one.
//
// bodyFrac -- same parameter, same default, and same reasoning as
// getMilkBoxFor's own above: rescales ICE_CUP_SLOT_FRACTIONS' x fraction
// into the mug's own narrower body region instead of its full box (which
// also has to fit the handle), so ice cubes land inside the mug's actual
// opening instead of drifting into that empty handle space. The y
// fraction itself is left untouched by bodyFrac (only left/right narrow
// the horizontal placement -- there's no equivalent horizontal-only
// squeeze concept vertically).
//
// yOffsetFrac -- same idea as bodyFrac but vertical and additive rather
// than a rescale: ICE_CUP_SLOT_FRACTIONS' y values were only ever tuned
// against the glass cup's own taper (see CUP_TYPES/activeCup in the
// component), so this shifts cubes down by this fraction of the cup's own
// height for whichever cup type needs the correction (currently plastic
// and mug -- see CUP_TYPES.plastic/mug.iceYOffsetFrac). Defaults to 0 (no
// shift), same "reasonable approximation, not pixel-perfect" caveat as
// bodyFrac above.
//
// spreadScale -- pulls/pushes every cube's x fraction toward/away from the
// cluster's own horizontal center (0.5) by this factor, so a >1 value
// spaces cubes further apart without needing a whole second
// ICE_CUP_SLOT_FRACTIONS table. Only the mug currently sets this (its
// cubes read too clustered together at the glass-tuned spacing -- see
// CUP_TYPES.mug.iceSpreadScale); defaults to 1 (no change).
//
// cubeSize -- defaults to ICE_CUP_SIZE, but callers pass a per-cup-type
// scaled size (see getIceCubeSize below) so the returned left/top still
// centers correctly on whatever size the cube will actually render at.
export function getIceCupSlotPos(
  index,
  cupPos,
  cupSize,
  bodyFrac = { left: 0, right: 1 },
  yOffsetFrac = 0,
  spreadScale = 1,
  cubeSize = ICE_CUP_SIZE
) {
  const rawFrac = ICE_CUP_SLOT_FRACTIONS[index % ICE_CUP_SLOT_FRACTIONS.length];
  const frac = { x: 0.5 + (rawFrac.x - 0.5) * spreadScale, y: rawFrac.y };
  const bodyLeft = cupPos.left + bodyFrac.left * cupSize.width;
  const bodyWidth = (bodyFrac.right - bodyFrac.left) * cupSize.width;
  const centerX = bodyLeft + frac.x * bodyWidth;
  const centerY = cupPos.top + (frac.y + yOffsetFrac) * cupSize.height;
  return {
    left: centerX - cubeSize.width / 2,
    top: centerY - cubeSize.height / 2,
  };
}

// Bounding box around every ICE_BOX_SPOTS position, derived automatically
// so it stays correct if the pile's layout changes again later. Used to
// position other elements relative to the ice box (see BOTTLE_BOTTOM/
// bottleHome below).
const ICE_BOX_BOUNDS = {
  left: Math.min(...ICE_BOX_SPOTS.map((s) => s.left)),
  top: Math.min(...ICE_BOX_SPOTS.map((s) => s.top)),
  right: Math.max(...ICE_BOX_SPOTS.map((s) => s.left)) + ICE_BOX_SIZE.width,
  bottom: Math.max(...ICE_BOX_SPOTS.map((s) => s.top)) + ICE_BOX_SIZE.height,
};

// "Send to Toppings" drop-zone -- same idea as MatchaMaking's own "Make
// Drink" zone (MAKE_DRINK_ZONE there), just carrying the finished cup
// forward to the Toppings station instead of the bowl to this one.
// Bottom-right corner, clear of the milk bottle cluster above it
// (BOTTLE_ITEMS work out to roughly left 69.5-96.5, top 45-83 -- see
// BOTTLE_CLUSTER_CENTER/BOTTLE_BOTTOM above) and clear of the ProgressBar
// (bottom-center, same ~77.3%-from-center-at-most reasoning as
// MAKE_DRINK_ZONE's own comment in MatchaMaking.js, since it's the same
// component/width here too). width/height chosen so the marker renders as
// a true square in real on-screen pixels, same "convert through actual
// pixels" reasoning as MAKE_DRINK_ZONE's own updated comment -- 7.3% of
// 1920 (140.2px) is very close to 13% of 1080 (140.4px). left is derived
// to keep the marker's own right edge exactly where it always was
// (78 + 19 = 97) despite the narrower width.
const SEND_DRINK_ZONE = { left: 89.7, top: 85, width: 7.3, height: 13 };

const MilkSelection = ({
  activeStep,
  customerNumber,
  // True only on order 1 of a "training day" run -- see
  // CustomerOrdering.js's own big comment on this same prop. Every bare
  // customerNumber comparison throughout this file now reads
  // isWalkthrough/!isWalkthrough instead, so "i'm trained" can skip the
  // walkthrough while still playing a normal (unlocked, unhinted) order 1.
  isWalkthrough,
  onNavigate,
  onAdvance,
  order,
  incomingBowl,
  onSendToToppings,
  onScored,
}) => {
  const containerRef = useRef(null);
  // PERF: shared FLIP-based glide for the carried-over bowl and the four
  // milk bottles below (see the big comment on gameloop/useFlipGlide.js) --
  // left/top now live on a wrapper div, animated via transform instead of
  // being transitioned directly, same fix as MatchaMaking.js/
  // ToppingsStation.js. registerFlip is a plain ref-callback closure (not a
  // hook), so calling it once per item inside the bottles' .map() below is
  // safe.
  const registerFlip = useFlipGlide();
  // Traps every direction on the Order receipt button during this screen's
  // very first walkthrough beat (showOrderButtonLock, declared much further
  // down, alongside showOrderHint/showStationSpotlight) -- per request, the
  // player shouldn't be able to move anywhere else until they've actually
  // opened the order receipt once. Same full directional lockdown shape as
  // restrictBowlNavRef/restrictSendNavRef below (a single item, no siblings
  // to cycle between). Declared here (rather than only where
  // showOrderButtonLock itself lives) for the same early-registration
  // reason every other ref in this group is -- the nav-graph effect right
  // below has to be registered before useFlatFocusNav, so it needs to read
  // the CURRENT value without any of these flags in its own dependency
  // array. Kept in sync the same "ref declared early, synced late" pattern
  // as every other ref here, by a small effect declared right after
  // showOrderButtonLock itself.
  const restrictOrderNavRef = useRef(false);
  // Traps Up/Down while a shelf cup is focused during the first-order
  // walkthrough's own cup-picking beat (showCupSpotlight, declared much
  // further down) -- per request, the player shouldn't be able to arrow
  // away from the shelf cups at all during that beat, only cycle Left/Right
  // among the three. Declared here (rather than only where showCupSpotlight
  // itself lives) so the nav-graph effect right below -- which has to be
  // registered before useFlatFocusNav for the same ordering reasons as
  // every other leg of that graph -- can read the CURRENT value without
  // needing showCupSpotlight in its own dependency array. Kept in sync
  // every render by a small effect declared right after showCupSpotlight
  // itself, same "ref declared early, synced late" pattern used in
  // MatchaMaking.js for its own restrictTinVerticalNavRef.
  const restrictCupVerticalNavRef = useRef(false);

  // Same idea, for the ice cubes during the first-order walkthrough's own
  // ice-placing beat (showIceSpotlight, declared much further down) -- per
  // request, the player shouldn't be able to arrow away from the ice cube
  // pile at all during that beat, only move between the cubes themselves.
  // Only needs to gate Up/Down (see the ice-cube leg of the nav-graph
  // effect below) since Left/Right can never escape the pile in the first
  // place -- the pile's own explicit adjacency graph has no left target for
  // the left column or right target for the right column. Kept in sync the
  // same "ref declared early, synced late" way as restrictCupVerticalNavRef
  // above, by a small effect declared right after showIceSpotlight itself.
  const restrictIceVerticalNavRef = useRef(false);

  // Same idea again, for the milk/water bottles during the first-order
  // walkthrough's own base-picking beat (showBaseSpotlight, declared much
  // further down) -- per request, the player shouldn't be able to arrow
  // away from the bottle row at all during that beat, only cycle Left/Right
  // among the bottles. Unlike restrictCupVerticalNavRef/
  // restrictIceVerticalNavRef this one also has to gate a *horizontal*
  // escape (Left from the very first bottle normally continues on to the
  // bowl -- see the bottle leg of the nav-graph effect below), not just
  // Up/Down, since Left/Right doesn't only mean "cycle siblings" for
  // bottles the way it does for the shelf cups. Kept in sync the same "ref
  // declared early, synced late" way, by a small effect declared right
  // after showBaseSpotlight itself.
  const restrictBaseNavRef = useRef(false);

  // Same idea again, for the matcha bowl during the first-order
  // walkthrough's own bowl-pouring beat (showBowlSpotlight, declared much
  // further down) -- per request, the player shouldn't be able to arrow
  // away from the bowl at all during that beat. Unlike the other three
  // restrict refs above there's only ever one bowl to land on (no siblings
  // to cycle between), so this is a full directional lockdown -- every
  // arrow press is swallowed outright while it's true -- same
  // "unconditional trap of Up/Down/Left/Right" shape MatchaMaking.js uses
  // for its own single-item locks (the kettle button, the whisk, etc.).
  // Kept in sync the same "ref declared early, synced late" way, by a small
  // effect declared right after showBowlSpotlight itself.
  const restrictBowlNavRef = useRef(false);

  // Same idea again, for the active cup (now sitting on the table) during
  // the first-order walkthrough's own final send-to-Toppings beat
  // (showSendSpotlight, declared much further down) -- per request, the
  // player shouldn't be able to arrow away from the cup at all during that
  // beat. Same full directional lockdown shape as restrictBowlNavRef above
  // -- only one cup to land on at this point, no siblings to cycle between
  // (see the cup leg of the nav-graph effect below, the
  // cupSpotRef.current === 'table' branch). Kept in sync the same "ref
  // declared early, synced late" way, by a small effect declared right
  // after showSendSpotlight itself.
  const restrictSendNavRef = useRef(false);

  // Remembers whichever element focus jumped to Settings FROM, whenever
  // that happens (see every restricted leg of the nav-graph effect below
  // that calls gearButton.focus()) -- read back by that same effect's own
  // "gear -> Down" leg so coming back down from Settings always lands
  // wherever the player actually left from (a shelf cup, an ice cube, a
  // bottle, the order button, or the active cup on the table), not always
  // the bowl (this leg's own original, single hardcoded target from before
  // any of those beats had their own way in). Falls back to the bowl
  // whenever this is empty or no longer points at something real -- see
  // that leg's own comment for when that still happens.
  const preSettingsFocusRef = useRef(null);

  // Strawberry milk (order 2 onward), sparkling yuzu (order 3 onward, moved
  // up from order 4), and jasmine tea (new, order 4 onward) -- every tier
  // stacks on top of the last rather than replacing it, per request. This
  // screen fully unmounts/remounts between customers (App.js only ever
  // renders one page-slide's component at a time), so customerNumber is
  // effectively fixed for this whole mount's lifetime; no need for this to
  // be reactive/memoized, just read once here and used to pick which of the
  // four precomputed layouts (see layoutBottles/BOTTLE_ITEMS_BASE/
  // BOTTLE_ITEMS_WITH_STRAWBERRY/BOTTLE_ITEMS_WITH_YUZU/
  // BOTTLE_ITEMS_WITH_JASMINE above) this particular order gets.
  const strawberryUnlocked = customerNumber >= 2;
  const yuzuUnlocked = customerNumber >= 3;
  const jasmineUnlocked = customerNumber >= 4;
  const bottleItems = jasmineUnlocked
    ? BOTTLE_ITEMS_WITH_JASMINE
    : yuzuUnlocked
    ? BOTTLE_ITEMS_WITH_YUZU
    : strawberryUnlocked
    ? BOTTLE_ITEMS_WITH_STRAWBERRY
    : BOTTLE_ITEMS_BASE;
  const bottleHome = jasmineUnlocked
    ? BOTTLE_HOME_WITH_JASMINE
    : yuzuUnlocked
    ? BOTTLE_HOME_WITH_YUZU
    : strawberryUnlocked
    ? BOTTLE_HOME_WITH_STRAWBERRY
    : BOTTLE_HOME_BASE;

  // This station's own explicit keyboard nav graph, per request -- same
  // "exact fixed graph, not generic spatial nearest-neighbor matching"
  // approach as Matcha Making/Customer Ordering's own graphs. Starting
  // point: station dot Up -> oat milk (the first bottle, .milk-bottle in
  // DOM order matches BOTTLE_ITEMS' oat/dairy/almond/coconut order) --
  // more legs to be added here as the rest of this frame's nav gets
  // worked out.
  //
  // Registered before useFlatFocusNav(containerRef) below for the same
  // reason worked out for the other two frames: useFlatFocusNav's own
  // spatial Up/Down/Left/Right handling calls focus() synchronously within
  // the same event dispatch, so if this effect attached its listener after
  // useFlatFocusNav's, a single keypress could let that generic hook move
  // focus first and then have this handler act again immediately after,
  // skipping a step. Registering this one first guarantees it only ever
  // sees focus as it was *before* any handler for this keypress has run.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Up' && action !== 'Down' && action !== 'Left' && action !== 'Right') return;
      const active = document.activeElement;

      const bottles = containerRef.current
        ? Array.from(containerRef.current.querySelectorAll('.milk-bottle'))
        : [];
      const firstBottle = bottles[0] ?? null;
      const bowl = document.querySelector('.incoming-bowl');
      const iceCubes = containerRef.current
        ? Array.from(containerRef.current.querySelectorAll('.ice-cube'))
        : [];
      // First cube that ISN'T already placed in the cup AND is still
      // actually reachable (canFocus, defined below) -- placed cubes are
      // fully inert (see the big comment on the ice-cube JSX further down)
      // and can no longer take focus at all, and once there's already
      // liquid in the cup (orders 2-5 only -- iceLocked's own big comment
      // near cupHasContents) every remaining cube loses data-focusable/
      // tabIndex too, so "Left from the bowl" has to skip both kinds to
      // land on an actual selectable cube. If nothing qualifies, this is
      // null and the .focus() call below is a no-op -- same "nothing left
      // to land on, so the press just does nothing" trap-at-the-end shape
      // used elsewhere in this graph, rather than incorrectly focusing (and
      // highlighting) an unreachable one.
      const gearButton = document.querySelector('.settings-toggle-button');
      // All three shelf cups (glass, plastic, mug) share the .glass-cup
      // class (see their shared JSX below) -- glass is always first in DOM
      // order (['glass', 'plastic', 'mug'].map), so index 0 is exactly "the
      // glass cup".
      const shelfCups = containerRef.current
        ? Array.from(containerRef.current.querySelectorAll('.glass-cup'))
        : [];
      const firstCup = shelfCups[0] ?? null;
      // Whichever cup type is ACTUALLY in play right now, wherever it
      // currently sits (shelf or table) -- looked up by activeCupRef's own
      // position in the same three-cup DOM order shelfCups above already
      // walks (['glass', 'plastic', 'mug']), same indexing showSendSpotlight's
      // own focus effect further down uses. Read through activeCupRef, NOT
      // the plain activeCup state value -- this handler is registered once
      // with an empty dependency array (see this effect's own comment up
      // top), so activeCup itself would be frozen at that first render
      // (always 'glass', the initial state) -- same "stale closure" fix
      // shape as cupSpotRef/icePlacedRef elsewhere in this file.
      const activeCupEl = shelfCups[['glass', 'plastic', 'mug'].indexOf(activeCupRef.current)] ?? null;
      const orderButton = document.querySelector('.order-receipt-button');

      // Whether `el` is actually reachable right now -- i.e. NOT one of the
      // cups/bottles/ice cubes that's been locked out of navigation after
      // being used (orders 2-5 only, see cupsLocked/baseLocked/iceLocked's
      // own big comment near cupHasContents above). A LIVE DOM read (does
      // THIS element currently carry data-focusable/tabIndex), not any of
      // those three JS booleans directly -- this whole handler is
      // registered once with an empty dependency array (see this effect's
      // own comment up top, on why), so a plain state-derived boolean like
      // cupsLocked would be frozen at that very first render (always false,
      // nothing's locked yet at mount) and any guard built on it would
      // silently never fire. The DOM itself is always current regardless of
      // how stale this closure's own captured variables are -- same
      // "identical bug, identical fix" reasoning Matcha Making's own
      // tinIndex branch guard now documents.
      //
      // resolveFirst picks the first candidate in priority order that's
      // still actually reachable, same "explicit short chain, not a
      // generic spatial fallback" shape (and same reasoning -- see Matcha
      // Making's own resolveFirst comment for the full "unnatural jump"
      // writeup) used throughout this whole project's nav graphs now.
      const canFocus = (el) => !!el && document.contains(el) && !el.disabled && el.tabIndex >= 0;
      const resolveFirst = (...candidates) => candidates.find((el) => canFocus(el)) || null;

      const firstIceCube = iceCubes.find((el, i) => !icePlacedRef.current[i] && canFocus(el)) ?? null;

      // Station dot -> oat milk (falling back to the bowl, never locked, if
      // every bottle's already been locked out -- baseLocked's own big
      // comment above).
      if (active === document.querySelector('.progress-step.current')) {
        if (action === 'Up') {
          e.preventDefault();
          e.stopImmediatePropagation();
          resolveFirst(firstBottle, bowl)?.focus();
        }
        return;
      }

      // Any bottle: Left/Right cycles siblings, same trap-at-the-ends shape
      // as Matcha Making's tins -- swallows the keypress even when there's
      // no sibling that way (nextIndex out of bounds, so bottles[nextIndex]
      // is undefined and .focus() on it is a no-op), so a Right press on
      // the last bottle just does nothing instead of falling through to
      // useFlatFocusNav's generic spatial fallback, which was jumping out
      // to the order button. The one exception is Left from the first
      // bottle (oat) -- rather than trapping that one too, it continues on
      // to the bowl. Up from any of them goes to the first (glass) cup up
      // on the shelf, Down goes back to the station dot. All three escape
      // routes (Left-from-first, Up, Down) are gated behind
      // !restrictBaseNavRef.current -- during the first-order walkthrough's
      // base-picking beat (showBaseSpotlight) that ref is true, so those
      // presses still get swallowed (preventDefault/stopImmediatePropagation
      // already fired below) but leave focus right where it is, trapping
      // the player among the bottles per that beat's own request.
      const bottleIndex = bottles.indexOf(active);
      if (bottleIndex !== -1) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Per request: every bottle shows the halo until the player's first
        // arrow press, then it collapses to just the focused one -- see
        // baseSpotlightMoved's own comment above.
        setBaseSpotlightMoved(true);
        // Belt-and-suspenders once a base has actually been poured (orders
        // 2-5 -- baseLocked's own big comment near cupHasContents): every
        // bottle loses data-focusable/tabIndex the moment it's locked,
        // which is what actually stops fresh D-pad presses from reaching
        // one in the first place, but that alone doesn't blur an
        // ALREADY-focused bottle (removing tabIndex never blurs -- see the
        // identical fix on Matcha Making's own tins). Checked via
        // canFocus(active) itself (a live DOM read), not the baseLocked JS
        // boolean -- see canFocus's own comment above for why. Once
        // locked, this collapses to just the Up/Down legs, no more
        // Left/Right cycling or "continue to the bowl" from Left.
        if (!canFocus(active)) {
          if (action === 'Up') {
            resolveFirst(activeCupEl, orderButton)?.focus();
          } else if (action === 'Down') {
            document.querySelector('.progress-step.current')?.focus();
          }
          return;
        }
        if (action === 'Left' && bottleIndex === 0) {
          if (!restrictBaseNavRef.current) bowl?.focus();
        } else if (action === 'Left' || action === 'Right') {
          const nextIndex = action === 'Right' ? bottleIndex + 1 : bottleIndex - 1;
          bottles[nextIndex]?.focus();
        } else if (action === 'Up') {
          // Per request: still reachable while restricted, straight to
          // Settings instead of the shelf cups (this beat's own point isn't
          // the cups) -- tracked in preSettingsFocusRef so gear's own Down
          // leg sends focus back to this exact bottle.
          if (restrictBaseNavRef.current) {
            preSettingsFocusRef.current = active;
            gearButton?.focus();
          } else if (!isWalkthrough) {
            // Orders 2-5 only -- routes to whichever cup is actually in
            // play (falling back to the glass cup, then the Order button)
            // instead of always the glass one, so this doesn't silently
            // no-op once the player's switched to plastic/mug and that
            // glass cup itself has since been locked out (cupsLocked's own
            // big comment near cupHasContents). The walkthrough
            // (isWalkthrough) keeps its exact original single
            // target below -- untouched.
            resolveFirst(activeCupEl, firstCup, orderButton)?.focus();
          } else {
            firstCup?.focus();
          }
        } else if (action === 'Down') {
          if (!restrictBaseNavRef.current) document.querySelector('.progress-step.current')?.focus();
        }
        return;
      }

      // Bowl: Left -> first ice cube, Up -> settings, Down -> station dot.
      // Right is deliberately left unhandled (nothing sits further right of
      // the bowl in this graph). Fully locked down (every OTHER direction
      // swallowed, none of the branches below run) during the first-order
      // walkthrough's own bowl-pouring beat -- see restrictBowlNavRef's own
      // comment above -- but per request Up specifically still works even
      // then, so the player can always reach Settings from wherever this
      // beat has focus; checked (and, since it always actually moves focus,
      // returned from) BEFORE the restrictBowlNavRef trap below rather than
      // being just another branch inside it.
      if (active === bowl) {
        if (action === 'Up') {
          e.preventDefault();
          e.stopImmediatePropagation();
          preSettingsFocusRef.current = active;
          gearButton?.focus();
          return;
        }
        if (restrictBowlNavRef.current) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        if (action === 'Left') {
          e.preventDefault();
          e.stopImmediatePropagation();
          firstIceCube?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          document.querySelector('.progress-step.current')?.focus();
        }
        return;
      }

      // Any ice cube: moves along ICE_ADJACENCY above -- Up/Down/Left/Right
      // all fully handled (and trapped/swallowed) right here rather than
      // partially falling through to useFlatFocusNav's own generic spatial
      // fallback, so the pile's navigation is airtight regardless of
      // restrictIceVerticalNavRef. The 'station' target only actually moves
      // focus when !restrictIceVerticalNavRef.current -- during the
      // first-order walkthrough's ice-placing beat that ref is true, so that
      // press still gets swallowed (preventDefault/stopImmediatePropagation
      // already fired below) but leaves focus right where it is, trapping
      // the player inside the pile per that beat's own request. The 'gear'
      // target is the one exception, per request: it always moves focus
      // regardless of restrictIceVerticalNavRef, so Up from a top-row cube
      // can always reach Settings even mid-beat -- tracked in
      // preSettingsFocusRef so gear's own Down leg sends focus back to this
      // exact cube. A `null` target (no cube that direction, and not a
      // gear/station edge either) is always just a trap regardless of the
      // ref.
      const iceIndex = iceCubes.indexOf(active);
      if (iceIndex !== -1) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Per request: every still-unplaced cube shows the halo until the
        // player's first arrow press, then it collapses to just the
        // focused one -- see iceSpotlightMoved's own comment above.
        setIceSpotlightMoved(true);
        const dirKey = action.toLowerCase();
        const target = ICE_ADJACENCY[iceIndex]?.[dirKey];
        // Belt-and-suspenders once there's already liquid in the cup
        // (orders 2-5 -- iceLocked's own big comment near cupHasContents):
        // every still-unplaced cube loses data-focusable/tabIndex the
        // moment ice locks, which is what actually stops fresh D-pad
        // presses from reaching one in the first place, but that alone
        // doesn't blur an ALREADY-focused cube (removing tabIndex never
        // blurs -- same reasoning as the bottles' own guard above).
        // Checked via canFocus(active) itself (a live DOM read), not the
        // iceLocked JS boolean -- see canFocus's own comment above for
        // why. Once locked, this collapses to just the 'gear'/'station'
        // escape routes (still both always reachable -- neither target is
        // ever itself one of the locked items), no more moving between
        // cubes.
        if (!canFocus(active)) {
          if (target === 'gear') {
            preSettingsFocusRef.current = active;
            gearButton?.focus();
          } else if (target === 'station') {
            document.querySelector('.progress-step.current')?.focus();
          }
          return;
        }
        if (target === 'gear') {
          preSettingsFocusRef.current = active;
          gearButton?.focus();
        } else if (target === 'station') {
          if (!restrictIceVerticalNavRef.current) document.querySelector('.progress-step.current')?.focus();
        } else if (typeof target === 'number' && !icePlacedRef.current[target]) {
          // Placed cubes are fully inert (no tabIndex/data-focusable -- see
          // the big comment on the ice-cube JSX further down) and can't
          // take focus at all, so a move onto one is just a trap too rather
          // than a no-op .focus() call.
          iceCubes[target]?.focus();
        }
        return;
      }

      // The active cup, still up on the shelf: Left/Right cycles siblings,
      // same trap-at-the-ends shape as the bottles above (DOM order is
      // glass, plastic, mug -- see the ['glass', 'plastic', 'mug'].map
      // further down -- so Left/Right just walk one step either way,
      // nextIndex out of bounds at either end meaning shelfCups[nextIndex]
      // is undefined and .focus() on it a no-op). Up goes to the order
      // button, Down goes to the first bottle.
      //
      // (This used to be a plain "toggle to the other one" --
      // shelfCups[1 - cupIndex] -- back when there were only ever two cups
      // to choose between, which happened to produce the same left-right-
      // both-swap behavior this directional version does for exactly two.
      // Now that there are three, that old formula would only ever swap
      // between indices 0 and 1 and could never reach index 2 (mug) at
      // all, so it's been generalized to the same directional-with-
      // trapped-ends shape every other sibling row in this project already
      // uses.)
      //
      // Once Enter's moved it down to the table (cupSpot, mirrored live
      // into cupSpotRef -- see that ref's own comment above), it's a
      // completely different, single-item context -- there's no sibling
      // to toggle to any more, so Left instead continues the same
      // right-to-left chain the bottles/bowl/ice cubes already form:
      // straight to the bowl, and from there on to the ice cubes exactly
      // like Left from the oat milk bottle already does. It deliberately
      // does *not* fall through to the shelf's own Left/Right toggle
      // behavior any more.
      const cupIndex = shelfCups.indexOf(active);
      if (cupIndex !== -1) {
        if (cupSpotRef.current === 'table') {
          // Up always reaches Settings, per request, even during the
          // first-order walkthrough's own final send-to-Toppings beat --
          // checked (and returned from) before the restrictSendNavRef trap
          // below, same "the one exception" shape as the bowl's own Up leg
          // above.
          if (action === 'Up') {
            e.preventDefault();
            e.stopImmediatePropagation();
            preSettingsFocusRef.current = active;
            gearButton?.focus();
            return;
          }
          // Fully locked down otherwise (every direction swallowed, Left
          // included) during that same beat -- see restrictSendNavRef's own
          // comment above.
          if (restrictSendNavRef.current) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
          }
          if (action === 'Left') {
            e.preventDefault();
            e.stopImmediatePropagation();
            bowl?.focus();
          }
          return;
        }
        if (action === 'Left' || action === 'Right') {
          e.preventDefault();
          e.stopImmediatePropagation();
          const nextIndex = action === 'Right' ? cupIndex + 1 : cupIndex - 1;
          shelfCups[nextIndex]?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!restrictCupVerticalNavRef.current) firstBottle?.focus();
        } else if (action === 'Up') {
          e.preventDefault();
          e.stopImmediatePropagation();
          // Per request: still reachable while restricted, straight to
          // Settings instead of the order button (this beat's own point
          // isn't the receipt) -- tracked in preSettingsFocusRef so gear's
          // own Down leg sends focus back to this exact cup.
          if (restrictCupVerticalNavRef.current) {
            preSettingsFocusRef.current = active;
            gearButton?.focus();
          } else {
            orderButton?.focus();
          }
        }
        return;
      }

      // Order button -> Left goes to settings, Down goes to the first
      // (glass) cup, same reciprocal pair every other frame's own order
      // button/gear share. Left always works, per request, even during
      // this screen's own first walkthrough beat (checked/returned from
      // before the restrictOrderNavRef trap below, same "the one exception"
      // shape used throughout this graph now) -- every other direction
      // stays fully locked down until the player's actually opened the
      // receipt once, same as before.
      if (active === orderButton) {
        if (action === 'Left') {
          e.preventDefault();
          e.stopImmediatePropagation();
          preSettingsFocusRef.current = active;
          gearButton?.focus();
          return;
        }
        if (restrictOrderNavRef.current) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        if (action === 'Down') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!isWalkthrough) {
            // Orders 2-5 only -- routes to whichever cup is actually in
            // play (falling back to the glass cup, then the first bottle)
            // instead of always the glass one, so this doesn't silently
            // no-op once a cup's been confirmed onto the table and the
            // OTHER (inactive) cups have since been locked out
            // (cupsLocked's own big comment near cupHasContents). The
            // walkthrough (isWalkthrough) keeps its exact original
            // single target below -- untouched.
            resolveFirst(activeCupEl, firstCup, firstBottle)?.focus();
          } else {
            firstCup?.focus();
          }
        }
        return;
      }

      // Settings gear -> Down goes back to wherever focus actually came
      // from (see preSettingsFocusRef's own comment above -- every
      // restricted walkthrough beat's own Up leg sets it right before
      // landing here), falling back to the bowl (this leg's original,
      // only-ever target before any of those beats had their own way in)
      // whenever that ref is empty or no longer points at something real.
      // Right always goes back to the order button, same "reciprocal pair"
      // shape as the other frames' own gear legs -- unambiguous regardless
      // of which beat's up, so it doesn't need preSettingsFocusRef at all.
      // Down only actually moves focus while the popover's closed; while
      // open, SettingsPanel's own handler owns Down (moving into the
      // volume controls instead).
      if (active === gearButton) {
        if (action === 'Down' && !document.querySelector('.settings-popover')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const target = preSettingsFocusRef.current;
          // canFocus (not the old "!target.disabled" check) so a target
          // that's since lost data-focusable/tabIndex (orders 2-5, once
          // locked -- cupsLocked/baseLocked/iceLocked's own big comment
          // near cupHasContents) correctly falls through to the bowl
          // instead of silently no-oping on a .focus() call that can no
          // longer land anywhere -- an <img> has no .disabled property at
          // all, so that old check was always true for one of these and
          // never actually caught this case.
          if (canFocus(target)) {
            target.focus();
          } else {
            bowl?.focus();
          }
        } else if (action === 'Right') {
          e.preventDefault();
          e.stopImmediatePropagation();
          orderButton?.focus();
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useFlatFocusNav(containerRef);

  // ---- Carried-over bowl from Matcha Making (see incomingBowl above) -----
  // Just the bowl + whisked-matcha image, no whisk -- reuses the same
  // BOWL_INNER_RIM_* fractions MatchaMaking.js uses for its own
  // whisked-liquid image, just anchored to this screen's own
  // INCOMING_BOWL_SPOT instead of wherever the bowl happened to be dragged
  // on that screen, so the whisked matcha lines up with the bowl's rim
  // here the same way it does there. Renders at incomingBowlRestWidth/
  // Height, shrunk to about one milk bottle's own width (BOTTLE_WIDTH) so
  // it reads as "roughly the size of one of the bottles" sitting alongside
  // them, rather than its old flat 0.6x scale (which read too big and sat
  // up against the back wall/cabinet instead of on the counter) -- and,
  // per request, stays this same size the whole time including while
  // pouring (it used to grow to incomingBowlItem's own true MatchaMaking-
  // counter size mid-pour; see incomingBowlWidth/Height's own comment
  // further down).
  const incomingBowlItem = MOVABLE_ITEMS.find((item) => item.key === 'bowl');
  const incomingBowlRestWidth = BOTTLE_WIDTH;
  const incomingBowlRestHeight = incomingBowlItem.height * (BOTTLE_WIDTH / incomingBowlItem.width);

  // Resting spot: open counter to the right of the ice chest (ICE_BOX_
  // BOUNDS, a module-level constant -- safe to reference here regardless of
  // its own textual position further down in this file, since it's fully
  // evaluated before any component function ever runs), left edge just past
  // the chest's own right edge. Top is based on the bottles' own baseline
  // (BOTTLE_BOTTOM, the fixed line every bottle's base sits on -- see the
  // comment on BOTTLE_BOTTOM near BOTTLE_ITEMS above), then lifted further
  // up by INCOMING_BOWL_LIFT so the bowl sits above that line rather than
  // flush with it, per request. Computed here (rather than as a plain
  // module constant) since it depends on incomingBowlRestHeight just above
  // and on ICE_BOX_BOUNDS/BOTTLE_BOTTOM, both only safely referenceable
  // from inside a function body given where they're defined in this file.
  // Wrapped in useMemo (rather than a plain const, recomputed every render)
  // so it's referentially stable across renders -- its own inputs
  // (incomingBowlRestHeight and the module constants above) never actually
  // change after mount, but without useMemo it'd still be a brand-new
  // object identity every render, which would've either had to be left out
  // of the pour-effect's dependency array below (an exhaustive-deps lint
  // warning that Vercel's production build treats as a hard error, since
  // CI sets process.env.CI=true) or, if added in as-is, would re-run that
  // effect on every render for no reason.
  const INCOMING_BOWL_LIFT = 5;
  const INCOMING_BOWL_SPOT = useMemo(
    () => ({
      left: ICE_BOX_BOUNDS.right + 5,
      top: BOTTLE_BOTTOM - incomingBowlRestHeight - INCOMING_BOWL_LIFT,
    }),
    [incomingBowlRestHeight]
  );

  // The bowl's own live position -- starts (and always snaps back to)
  // INCOMING_BOWL_SPOT, but shifts to the hover-over-cup spot while it's
  // being poured (see beginPour('bowl') below), same live-position pattern
  // as bottlePositions for the milk bottles. Unlike the bottles it isn't
  // left wherever it's dropped -- there's nowhere else meaningful for it to
  // sit, so any drop that doesn't land a pour just snaps it home.
  const [bowlPos, setBowlPos] = useState(INCOMING_BOWL_SPOT);

  // ---- Cup: shelf <-> table, glass or plastic ----------------------------
  // Two cup graphics now sit in the cubby (see CUP_TYPES/PLASTIC_CUP_SPOTS
  // above), but only one is ever "the" cup actually in play at a time --
  // activeCup is which one. Everything below (cupSpot, dragging, milk/
  // matcha, ice, sending) is the exact same single set of cup mechanics
  // this screen always had; it just now looks up CUP_TYPES[activeCup] for
  // positions/sizes instead of the old glass-only constants directly.
  // Whichever cup ISN'T active renders separately (see the render loop
  // below) as a plain "parked at its own shelf spot" item -- grabbing or
  // Enter-confirming it is what makes IT the active one (see
  // handleCupSwitchPointerDown/handleCupSwitchKeyDown further down).
  const [activeCup, setActiveCup] = useState('glass');
  const [cupSpot, setCupSpot] = useState('shelf');
  // Mirrors cupSpot into a ref so the big keyboard-nav effect declared up
  // near the top of this component (which needs to run *before*
  // useFlatFocusNav, see its own comment -- so it's registered with an
  // empty dependency array and never re-subscribes) can still always read
  // the *current* cupSpot instead of whatever it was on that first render.
  // Re-running that effect on every cupSpot change instead would mean
  // removing and re-adding its window listener each time, which would
  // attach it *after* useFlatFocusNav's own already-attached one from then
  // on -- reintroducing the exact double-hop cascade bug this whole nav
  // system has been built around avoiding.
  const cupSpotRef = useRef(cupSpot);
  useEffect(() => {
    cupSpotRef.current = cupSpot;
  }, [cupSpot]);
  // Same "stale closure" reasoning, mirrored for activeCup -- the big
  // keyboard-nav effect's own activeCupEl (which cup type is actually in
  // play right now, used to route Up/Down legs around locked cups on
  // orders 2-5) needs the *current* activeCup, not whatever it was on that
  // handler's first render (always 'glass', the initial state).
  const activeCupRef = useRef(activeCup);
  useEffect(() => {
    activeCupRef.current = activeCup;
  }, [activeCup]);

  // First-visit highlight on the Order receipt button (top-right, see
  // OrderReceiptButton.js/.css) -- the very first thing that flashes here,
  // same "check the order before touching anything else" beat Matcha
  // Making already runs (see showOrderHint there). Keeps flashing through
  // as many opens as the player likes, and only retires once they've
  // opened *and then closed* it -- see the onToggle passed to
  // <OrderReceiptButton> below, which is what flips this to false. That
  // retirement is also the cue for the next beat, cup-picking (showCupSpotlight
  // just below is now gated behind !showOrderHint the same way
  // MatchaMaking's own showTinHint is gated behind its showOrderHint).
  const [showOrderHint, setShowOrderHint] = useState(true);

  // First-order-only walkthrough spotlight, same pattern as MatchaMaking's
  // own showStationSpotlight -- lands on this screen already pink-tinted,
  // exempting only the Order receipt button, and clears on the exact same
  // rising edge that retires showOrderHint above. isWalkthrough
  // keeps this off for the 2nd/3rd rounds, same as every other beat in this
  // walkthrough -- they still get the plain flashing highlight/hint text
  // showOrderHint already drives, just without the pink tint over
  // everything else.
  const showStationSpotlight = isWalkthrough && showOrderHint;

  // First-order-only nav lockdown -- separate, shorter-lived flag from
  // showOrderHint/showStationSpotlight above (which stay up through as many
  // opens as the player likes and only retire once the drawer's been opened
  // AND closed again): this one exists purely to gate restrictOrderNavRef
  // (declared/read far above, before this station's own nav-graph effect --
  // see that ref's own comment) and retires the instant the player's
  // pressed Enter on the Order button ONCE, same rising-edge shape as
  // Matcha Making's own showOrderButtonLock. Set true by the onToggle
  // passed to <OrderReceiptButton> below, on the opening toggle
  // specifically (nowOpen === true) -- unlike showOrderHint's own onToggle
  // branch, which only cares about the closing one.
  const [hasOpenedOrderReceipt, setHasOpenedOrderReceipt] = useState(false);
  const showOrderButtonLock = isWalkthrough && !hasOpenedOrderReceipt;

  // Moves focus onto the Order receipt button the instant showOrderButtonLock
  // turns on -- pairs with suppressInitialFocus on <ProgressBar> further
  // down so the station dot never grabs the walkthrough's very first
  // selection instead, same "the highlighted thing becomes the next thing
  // selected" pattern as Matcha Making's own showOrderButtonLock focus
  // effect. Reaches for the button by class (same as this station's own
  // nav-graph effect above) since OrderReceiptButton doesn't expose a ref
  // up to its parent.
  useEffect(() => {
    if (showOrderButtonLock) {
      document.querySelector('.order-receipt-button')?.focus();
    }
  }, [showOrderButtonLock]);

  // Keeps restrictOrderNavRef (declared/read far above, alongside
  // containerRef, for the same early-registration ordering reasons) in sync
  // with showOrderButtonLock. No dependency array -- re-reads every render,
  // same "cheap and never a render behind" shape as this file's other
  // restrict*NavRef sync effects.
  useEffect(() => {
    restrictOrderNavRef.current = showOrderButtonLock;
  });

  // First-order-only walkthrough beat, continued from Customer Ordering/
  // Matcha Making -- reuses an EXISTING state boundary rather than tracking
  // a separate one-way flag, same "the underlying UI already appears/
  // disappears at precisely the right moment for this to just tag along"
  // reasoning MatchaMaking.js's own showTinSpotlight/showScoopSpotlight/etc
  // give for doing the same: cupSpot is 'shelf' from the moment this screen
  // mounts and switches to 'table' the instant a cup's actually been
  // confirmed (either Enter on the already-active shelf cup, or switching
  // to a different one -- both routes set cupSpot to 'table', see
  // handleCupKeyDown/handleCupSwitchKeyDown above), so "still on the shelf"
  // already means exactly "hasn't picked a cup yet" with no extra state
  // needed. Also gated behind !showOrderHint now (this screen's own new
  // first beat, above) so cup-picking doesn't start until the order's
  // actually been checked -- same "next beat waits for the previous one's
  // retirement" shape as MatchaMaking's own showTinHint.
  const showCupSpotlight = isWalkthrough && !showOrderHint && cupSpot === 'shelf';

  // Moves focus onto the first (glass) shelf cup the instant showCupSpotlight
  // turns on -- pairs with suppressInitialFocus on <ProgressBar> further
  // down so the station dot never grabs the walkthrough's very first
  // selection instead, same "the highlighted thing becomes the next thing
  // selected" pattern as MatchaMaking's own showOrderButtonLock/showTinSpotlight
  // focus effects. Reaches for the cup by class (same '.glass-cup' query
  // this station's own nav-graph effect above uses for firstCup) rather
  // than a dedicated ref, since all three cups share that one class with no
  // ref array of their own.
  useEffect(() => {
    if (showCupSpotlight) {
      containerRef.current?.querySelector('.glass-cup')?.focus();
    }
  }, [showCupSpotlight]);

  // Keeps restrictCupVerticalNavRef (declared/read far above, alongside
  // containerRef, for the same early-registration ordering reasons) in sync
  // with showCupSpotlight. No dependency array -- re-reads every render,
  // same "cheap and never a render behind" shape as MatchaMaking.js's own
  // restrictTinVerticalNavRef sync effect.
  useEffect(() => {
    restrictCupVerticalNavRef.current = showCupSpotlight;
  });

  // Which cup type (if any) currently has the white focus halo -- drives
  // the name label above it (CUP_LABELS/.cup-label), same focus-not-active
  // distinction as focusedBottle/focusedTopping elsewhere: this is about
  // which cup the player's D-pad/pointer is currently on, independent of
  // activeCup (which one is actually in play). The onBlur guard (only
  // clear if this cup type is still the one recorded) avoids a stale clear
  // if focus has already moved to the other cup by the time this one's
  // blur fires.
  const [focusedCupType, setFocusedCupType] = useState(null);

  // ---- Sending the finished cup on to Toppings (see SEND_DRINK_ZONE
  // above) -- same "carry to a corner zone, hover shrunk, then slide off"
  // shape as MatchaMaking's own bowlStage/beginBowlCarry, just for the cup
  // (and everything riding along inside it -- milk fill, matcha fill, any
  // placed ice cubes, all nested inside the active cup's own .cup-wrap, see
  // the isActive branch of the cup-type map further down) here.
  //   'idle'      -- normal, cup behaves exactly as it always has (shelf <->
  //                  table drag/Enter-toggle).
  //   'carrying'  -- confirmed (dropped on the zone, or Enter/Space once
  //                  canSendDrink) -- gliding to the zone's own center.
  //   'hovering'  -- arrived; shrinks down (.bowl-arrived, reused directly
  //                  from MatchaMaking.css, already loaded globally) and
  //                  sits still at the zone for CUP_SEND_HOVER_MS.
  //   'vanishing' -- sliding off to the right (staying shrunk) and fading
  //                  out (.bowl-slide-off, same reuse as above).
  //   'sent'      -- slide's finished; the cup (and everything in it) stops
  //                  rendering entirely, same as the bowl once bowlStage
  //                  reaches 'sent' over on MatchaMaking.
  // Declared up here (rather than down near cupMilk/cupMatcha, where the
  // rest of the sending logic lives) because cupRenderPos just below
  // already needs to read cupSendPos -- a plain render-time reference, not
  // a closure, so it has to come after this declaration textually, not just
  // logically.
  const [cupSendStage, setCupSendStage] = useState('idle');
  // Live position while gliding to/sitting in the Send Drink zone -- same
  // role as bowlPos.
  const [cupSendPos, setCupSendPos] = useState(null);

  const handleCupKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    playButtonClick();
    // Once the cup qualifies to be sent on (canSendDrink), Enter sends it
    // instead of toggling shelf <-> table -- same "the meaningful action
    // takes over from the mundane default" reasoning as the milk bottles'
    // own handleBottleKeyDown. There's no real reason to send a poured cup
    // back to the shelf anyway, so this doesn't give up anything.
    if (canSendDrink) {
      beginSendDrink();
      return;
    }
    // Same rule as handleCupPointerUp's own drag guard just above -- once
    // anything's been placed in the cup, Enter can no longer toggle it back
    // to the shelf. A cup with contents just stays put here (canSendDrink
    // above already handles the "ready to send" case; a partially-filled
    // one, e.g. ice but no milk yet, has nothing else for Enter to do).
    if (cupSpot === 'table' && cupHasContents) return;
    setCupSpot((prev) => (prev === 'shelf' ? 'table' : 'shelf'));
  };

  // ---- Switching which cup type is active --------------------------------
  // Grabbing (or Enter-confirming) whichever cup ISN'T currently active is
  // what makes IT the active one instead -- see the big comment above. Since
  // there's only ever one drink being made at a time, switching always
  // resets whatever's currently in progress (fresh milk/matcha/ice, cup back
  // at its own shelf spot) rather than trying to preserve it -- the cup that
  // was active until just now just becomes the new inactive one, parked at
  // its own shelf spot (see the render loop below).
  const resetCupContents = () => {
    setCupMilk(null);
    setCupMatcha(null);
    setIcePlaced(new Array(ICE_BOX_SPOTS.length).fill(false));
    setCupSendStage('idle');
    setCupSendPos(null);
  };

  // D-pad/keyboard equivalent -- switches to this cup and moves it straight
  // to the table, same "Enter is the select+move-to-table gesture" meaning
  // handleCupKeyDown already gives Enter on a shelved cup.
  const handleCupSwitchKeyDown = (type) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    if (cupSendStage !== 'idle') return;
    // Belt-and-suspenders alongside the inactive cup's own conditional
    // data-focusable below (see cupsLocked's own big comment above) --
    // that's what actually stops a locked cup from being reachable via
    // D-pad in the first place, but this guard covers the (currently
    // impossible, but cheap to guard against) case of Enter still somehow
    // reaching a locked cup's handler.
    if (cupsLocked) return;
    e.preventDefault();
    playButtonClick();
    resetCupContents();
    setActiveCup(type);
    setCupSpot('table');
  };

  const cupRenderPos = cupSendPos || (cupSpot === 'shelf' ? CUP_TYPES[activeCup].shelfSpot : CUP_TYPES[activeCup].tableSpot);
  // Sized by the cup's current spot the whole time -- cupSpot only flips on
  // drop (see handleCupPointerUp/handleCupKeyDown), so grabbing it off the
  // table keeps it at the table size for the full drag instead of snapping
  // down to the shelf size the instant you pick it up (which used to yank
  // it out from under the cursor and made it impossible to drag back to the
  // shelf). It shrinks/grows only at the moment cupSpot actually changes.
  const cupRenderSize = cupSpot === 'table' ? CUP_TYPES[activeCup].tableSize : CUP_TYPES[activeCup].shelfSize;
  // Box the milk fill renders into once poured -- see getMilkBoxFor/
  // CUP_MILK_BOX_FRAC above. Recomputed off the cup's own *current*
  // cupRenderPos/cupRenderSize every render (same as bowlPowderLeft/Top in
  // MatchaMaking.js), not a fixed table spot -- this used to be hardcoded to
  // CUP_SPOTS.table/TABLE_SIZE (via the now-removed getCupMilkBox wrapper),
  // which was confirmed to leave the fills behind on the table once the cup
  // was dragged or carried away. cupMatchaBox is the shallower box the
  // matcha layer renders into on top of it -- see getMatchaBoxFor/
  // CUP_MATCHA_HEIGHT_FRAC above.
  const cupMilkBox = getMilkBoxFor(
    cupRenderPos,
    cupRenderSize,
    CUP_TYPES[activeCup].bodyFrac,
    CUP_TYPES[activeCup].bottomExtraFrac,
    CUP_TYPES[activeCup].leftExtraFrac
  );
  const cupMatchaBox = getMatchaBoxFor(cupMilkBox);

  // ---- Ice cubes: ice box -> cup ----------------------------------------
  // Whether each of the 7 cubes has been placed in the cup yet.
  const [icePlaced, setIcePlaced] = useState(new Array(ICE_BOX_SPOTS.length).fill(false));
  // Mirrors icePlaced into a ref, same "stale closure" reasoning as
  // cupSpotRef above -- the big keyboard-nav effect near the top of this
  // component (registered with an empty dependency array so it never
  // re-subscribes) needs to always read the *current* icePlaced when it
  // picks which ice cube "Left" from the bowl lands on, not whatever it
  // was on that first render (all false).
  const icePlacedRef = useRef(icePlaced);
  useEffect(() => {
    icePlacedRef.current = icePlaced;
  }, [icePlaced]);

  // How many cubes are actually sitting in the cup right now -- read in
  // more than one place below (showIceSpotlight's own retirement,
  // showBaseSpotlight's own start), so worked out once here rather than
  // repeating icePlaced.filter(Boolean).length at each call site.
  const icePlacedCount = icePlaced.filter(Boolean).length;

  // Second first-order-only walkthrough beat on this screen, picking up the
  // instant showCupSpotlight above ends (a cup's been confirmed onto the
  // table) and retiring the instant the player's placed all 3 requested ice
  // cubes -- same "reuse an existing state boundary" reasoning
  // showCupSpotlight itself already documents. generateSpokenOrder in
  // CustomerOrdering.js fixes the spoken ice count at exactly 3 for
  // isWalkthrough specifically so this beat always has the same,
  // predictable amount to teach -- without that, a differently-rolled
  // order would leave this beat waiting on a number the walkthrough itself
  // never actually told the player.
  const showIceSpotlight = isWalkthrough && cupSpot === 'table' && icePlacedCount < 3;

  // Whether the player has actually pressed an arrow key or Enter yet
  // during this beat -- per request, every still-unplaced cube shows the
  // white focus halo (see milk-ice-focus-halo on the ice-cube JSX
  // further down) the instant showIceSpotlight turns on, and collapses down
  // to just the one actually focused cube the moment the player makes their
  // first move (see the ice-cube leg of the nav-graph effect above, and
  // handleIceKeyDown below, both of which flip this true). Reset back to
  // false every time showIceSpotlight itself turns on, so it's ready fresh
  // if this beat were ever to run again.
  const [iceSpotlightMoved, setIceSpotlightMoved] = useState(false);
  useEffect(() => {
    if (showIceSpotlight) setIceSpotlightMoved(false);
  }, [showIceSpotlight]);

  // Moves focus onto the first still-unplaced ice cube the instant
  // showIceSpotlight turns on -- pairs with the exempt styling on the ice
  // cubes themselves (see milk-spotlight-exempt on their own className
  // further down), same "the highlighted thing becomes the next thing
  // selected" pattern as showCupSpotlight's own focus effect above. Reaches
  // for the cube by class (same '.ice-cube' query this station's own
  // nav-graph effect above uses for firstIceCube, minus that effect's own
  // "skip already-placed ones" filter, since every cube's still unplaced
  // the first time this fires) rather than a dedicated ref, since all seven
  // cubes share that one class with no ref array of their own.
  useEffect(() => {
    if (showIceSpotlight) {
      containerRef.current?.querySelector('.ice-cube')?.focus();
    }
  }, [showIceSpotlight]);

  // Keeps restrictIceVerticalNavRef (declared/read far above, alongside
  // containerRef, for the same early-registration ordering reasons) in sync
  // with showIceSpotlight. No dependency array -- re-reads every render,
  // same "cheap and never a render behind" shape as
  // restrictCupVerticalNavRef's own sync effect above.
  useEffect(() => {
    restrictIceVerticalNavRef.current = showIceSpotlight;
  });

  // D-pad / keyboard: select a cube, press Enter to place it in the cup.
  // Only works once the cup is actually on the table. Once a cube's
  // actually placed, this handler no longer gets attached to it at all --
  // a placed cube can no longer be reselected or taken back out, since
  // letting it stay grabbable was stealing the focus landing spot from the
  // rest of this screen's own navigation.
  const handleIceKeyDown = (index) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    if (cupSpot !== 'table') return;
    // Belt-and-suspenders alongside the cube's own conditional
    // data-focusable below (see iceLocked's own big comment above) -- that's
    // what actually stops a locked cube from being reachable via D-pad in
    // the first place, but this guard covers the (currently impossible, but
    // cheap to guard against) case of Enter still somehow reaching a locked
    // cube's handler.
    if (iceLocked) return;
    // Guards against placing a cube once the cup's already mid-send --
    // same "idle only" gate canPourMilk/canSendDrink already use. Without
    // this, a newly-placed cube during 'carrying'/'hovering'/'vanishing'
    // would render nested in the active cup's .cup-wrap (see the isActive
    // branch of the cup-type map) straight away instead of playing its
    // usual "flies from the ice box into the cup" landing transition
    // first (that only plays while the cube renders as a top-level,
    // absolutely-positioned element -- see the big comment on the nested
    // ice cubes' own JSX for why), a harmless but avoidable visual glitch.
    if (cupSendStage !== 'idle') return;
    e.preventDefault();
    // Same "first move collapses the halo down to just the focused one"
    // rule as the nav-graph effect's own ice-cube leg -- Enter counts as a
    // move too.
    setIceSpotlightMoved(true);
    playButtonClick();
    playIceCubeDrop();
    setIcePlaced((prev) => {
      const next = [...prev];
      next[index] = true;
      return next;
    });
    // Once this cube's placed in the cup, the halo shouldn't follow it
    // there -- it stays in the ice box, on whichever cube is next in line
    // (first remaining unplaced one, by index). icePlaced here is still
    // the pre-update snapshot (the setter above hasn't re-rendered yet),
    // so it correctly reflects "everyone except the one just placed".
    const cubes = containerRef.current
      ? Array.from(containerRef.current.querySelectorAll('.ice-cube'))
      : [];
    const nextCube = cubes.find((el, i) => i !== index && !icePlaced[i]);
    nextCube?.focus();
  };

  // ---- Milk/water bottles: select, Enter to pour, or snaps back home -----
  const [bottlePositions, setBottlePositions] = useState(bottleHome);
  // Which bottle (if any) currently has the white focus halo -- drives the
  // name label under it (BOTTLE_LABELS/.milk-bottle-label), same
  // focus-not-confirm distinction as MatchaMaking.js's own focusedTin. The
  // onBlur guard (only clear if this bottle is still the one recorded)
  // avoids a stale clear if focus has already moved to a different bottle
  // by the time this one's blur fires.
  const [focusedBottle, setFocusedBottle] = useState(null);

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
  // Whether the carried-over bowl has actually poured its matcha into the
  // cup yet this visit -- flips true the instant the pour lands (same
  // moment cupMatcha is set below), never resets (local state, so a fresh
  // order re-mounting this screen with a new incomingBowl starts over).
  // Drives the .bowl-whisked-liquid overlay's fade-out (see the JSX further
  // down) so the bowl reads as empty once its contents are actually in the
  // cup, instead of still showing a full pool of matcha sitting in it.
  const [bowlPoured, setBowlPoured] = useState(false);

  // The "liquid pour" Audio instance currently playing for this pour (see
  // playLiquidPouring below) -- held in a ref (not state, nothing here
  // needs to re-render off it) purely so it can be paused/cut short the
  // moment the pour's own BOTTLE_POUR_MS timeout ends, since the clip
  // itself runs longer than a single pour's on-screen duration.
  const pourAudioRef = useRef(null);

  // Bug fix, per request ("keep the bowl the same size when it pours"):
  // this used to grow to its true, full MatchaMaking size
  // (incomingBowlFullWidth/Height) the moment it started its automated
  // glide-to-cup/pour sequence (pouringKey === 'bowl') and shrink back down
  // to its small counter-resting size otherwise -- now it just stays at its
  // counter-resting size (incomingBowlRestWidth/Height) the whole time, pour
  // included. incomingBowlWidth/Height are kept as their own names (rather
  // than inlining incomingBowlRestWidth/Height everywhere below) since
  // several call sites already reference them and the rest/full distinction
  // may come back for a different reason later.
  const incomingBowlWidth = incomingBowlRestWidth;
  const incomingBowlHeight = incomingBowlRestHeight;

  // The cup's own persistent "has milk been poured in" state -- doesn't
  // reset on its own (only a fresh pour re-sets it), same "second pour just
  // restarts this rather than accumulating a bigger fill" caveat as the
  // matcha bowl's own bowlWater back on MatchaMaking. { type: 'oat' |
  // 'dairy' | 'almond' | 'coconut' } | null -- type picks both the fill
  // color (.cup-milk-fill.<type> in CSS) and which liquid was poured in
  // last (a fresh pour of a different bottle just replaces it, same
  // "doesn't accumulate" simplification).
  const [cupMilk, setCupMilk] = useState(null);

  // Whether anything at all has been placed in the active cup yet -- ice,
  // milk, or both. Referenced by handleCupKeyDown/handleCupPointerUp above
  // (same "declared later, already in scope for an earlier-defined handler's
  // closure" pattern this file already uses for canSendDrink below) to block
  // sending a cup with contents back up to the shelf, on both the keyboard
  // (Enter-toggle) and drag paths -- per request, once something's been put
  // in the cup the player shouldn't be able to put it back, for every order,
  // not just the first-order walkthrough.
  const cupHasContents = icePlacedCount > 0 || !!cupMilk;

  // Navigation lockout for used-up items, orders 2-5 only -- same pattern
  // (and same reasoning) as Matcha Making's own tinsLocked/heaterLocked/
  // kettleLocked/whiskLocked: once each of these has done its job, it drops
  // out of the D-pad/tab nav graph entirely instead of staying reachable
  // for no further purpose. Doesn't affect the walkthrough
  // (isWalkthrough) at all -- every flag below is hard-gated on
  // !isWalkthrough, same as every *Locked flag in MatchaMaking.js.
  //   - cupsLocked: the instant a cup's been confirmed onto the table
  //     (cupSpot 'table'). This only actually locks the two OTHER
  //     (inactive) cup types still sitting on the shelf (see the isActive
  //     check on the cup <img>'s own data-focusable below) -- switching to
  //     one of those resets all progress (resetCupContents, see
  //     handleCupSwitchKeyDown), which is exactly the "go back to the
  //     cups" this is meant to prevent. The ACTIVE cup itself stays
  //     reachable the whole time it's on the table -- it's still needed
  //     later to actually send the drink.
  //   - baseLocked: the instant a base has actually been poured (cupMilk
  //     set) -- no more switching liquids once one's already in the cup.
  //   - iceLocked: deliberately NOT the instant a single cube's placed --
  //     per request, the player still needs to navigate among the
  //     remaining cubes to place several in a row. Only locks once a base
  //     has actually been poured (cupMilk set), matching "ice goes in
  //     before the liquid, not after" -- any cubes still sitting in the box
  //     become unreachable once there's already liquid in the cup.
  const cupsLocked = !isWalkthrough && cupSpot === 'table';
  const baseLocked = !isWalkthrough && !!cupMilk;
  const iceLocked = !isWalkthrough && !!cupMilk;

  // Third first-order-only walkthrough beat, picking up the instant
  // showIceSpotlight above ends (all 3 ice cubes placed) and retiring the
  // instant a base is actually poured (cupMilk flips non-null). Same
  // "reuse an existing state boundary" reasoning every other beat on this
  // screen already documents. Declared here, after cupMilk itself, rather
  // than back up alongside showCupSpotlight/showIceSpotlight, since it
  // needs that state in scope.
  const showBaseSpotlight = isWalkthrough && cupSpot === 'table' && icePlacedCount >= 3 && !cupMilk;

  // Same "every item shows the halo until the first move" rule as
  // iceSpotlightMoved above, just for the bottles during this beat -- see
  // milk-bottle-focus-halo on the bottle JSX further down, and the
  // bottle leg of the nav-graph effect/handleBottleKeyDown below, both of
  // which flip this true.
  const [baseSpotlightMoved, setBaseSpotlightMoved] = useState(false);
  useEffect(() => {
    if (showBaseSpotlight) setBaseSpotlightMoved(false);
  }, [showBaseSpotlight]);

  // Moves focus onto the first (oat) milk bottle the instant
  // showBaseSpotlight turns on -- same pairing/reasoning as
  // showIceSpotlight's own focus effect further up. Reaches for the bottle
  // by class (same '.milk-bottle' query this station's own nav-graph effect
  // up top uses for firstBottle) rather than a dedicated ref, since all of
  // them share that one class with no ref array of their own.
  useEffect(() => {
    if (showBaseSpotlight) {
      containerRef.current?.querySelector('.milk-bottle')?.focus();
    }
  }, [showBaseSpotlight]);

  // Keeps restrictBaseNavRef (declared/read far above, alongside
  // containerRef, for the same early-registration ordering reasons) in sync
  // with showBaseSpotlight. No dependency array -- re-reads every render,
  // same "cheap and never a render behind" shape as
  // restrictCupVerticalNavRef/restrictIceVerticalNavRef's own sync effects.
  useEffect(() => {
    restrictBaseNavRef.current = showBaseSpotlight;
  });

  // Bridges the gap between showBaseSpotlight ending (cupMilk flips
  // non-null the instant the pour *starts*, not once it's finished -- see
  // setCupMilk in the pourStage effect above) and showBowlSpotlight
  // picking up below (now deliberately held off until that pour's fully
  // settled, per request) -- without this, the pink tint/exemptions would
  // flicker off for the whole BOTTLE_POUR_MS the bottle's still mid-pour,
  // since neither beat's own flag would be true during that window. Only
  // matters for the base bottle's own pour (pouringKey !== 'bowl' --
  // once bowlPoured is true this is moot, showBowlSpotlight's job is
  // already done by then).
  const showBaseSettling =
    isWalkthrough && cupSpot === 'table' && !!cupMilk && !bowlPoured && pourStage !== 'idle';

  // Fourth first-order-only walkthrough beat, picking up once the base
  // bottle's pour has fully finished -- both cupMilk actually set AND
  // pourStage back to 'idle' (the bottle done animating back to its own
  // spot), not just the instant the pour starts, per request: the bowl
  // shouldn't get focus/its own callout until the bottle's completely
  // done pouring. Retires the instant the matcha bowl's own contents
  // actually land in the cup (bowlPoured flips true, the same moment
  // cupMatcha itself is set -- see that state's own comment further
  // down).
  const showBowlSpotlight =
    isWalkthrough && cupSpot === 'table' && !!cupMilk && !bowlPoured && pourStage === 'idle';

  // Moves focus onto the matcha bowl the instant showBowlSpotlight turns
  // on -- same pairing/reasoning as showBaseSpotlight's own focus effect
  // above. Reaches for the bowl by class (same '.incoming-bowl' query this
  // station's own nav-graph effect up top uses for bowl) rather than a
  // dedicated ref, even though a bowlRef-style ref would also work here --
  // kept consistent with every other beat's own "query by the shared class"
  // approach on this screen.
  useEffect(() => {
    if (showBowlSpotlight) {
      containerRef.current?.querySelector('.incoming-bowl')?.focus();
    }
  }, [showBowlSpotlight]);

  // Keeps restrictBowlNavRef (declared/read far above, alongside
  // containerRef, for the same early-registration ordering reasons) in sync
  // with showBowlSpotlight. No dependency array -- re-reads every render,
  // same "cheap and never a render behind" shape as this screen's other
  // restrict refs' own sync effects.
  useEffect(() => {
    restrictBowlNavRef.current = showBowlSpotlight;
  });

  // Bridges the gap between showBowlSpotlight ending (bowlPoured flips
  // true the instant the matcha pour *starts*, not once it's finished --
  // same setState-at-the-start-of-'pouring' timing as cupMilk/
  // showBaseSettling above) and showSendSpotlight picking up below (now
  // held off until that pour's fully settled, per request) -- same
  // "without this the tint/exemptions would flicker" reasoning as
  // showBaseSettling's own comment.
  const showBowlSettling =
    isWalkthrough &&
    cupSpot === 'table' &&
    !!cupMilk &&
    bowlPoured &&
    cupSendStage !== 'sent' &&
    pourStage !== 'idle';

  // Fifth first-order-only walkthrough beat on this screen, picking up
  // once the matcha pour has fully finished -- both bowlPoured actually
  // set AND pourStage back to 'idle' (the bowl done animating back to its
  // own spot), not just the instant the pour starts, per request: the
  // send step shouldn't get focus/its own callout until the bowl's
  // completely done pouring. Stays up through the WHOLE send sequence
  // from there -- confirming the send (cupSendStage leaving 'idle'), the
  // glide to the zone ('carrying'), and the shrink/fade once it arrives
  // ('vanishing') -- only retiring once the drink's actually gone
  // (cupSendStage reaches 'sent'). Per request, the pink tint needs to
  // stay up for that entire carry rather than dropping the instant the
  // player presses Enter/drops the cup, so the player can still see it
  // (and the send zone, and the cup's own contents) exempted from the
  // tint the whole way there -- see showAdvanceSpotlight further down for
  // the sixth and actually-final beat that takes over once there's
  // nothing left on screen to exempt.
  const showSendSpotlight =
    isWalkthrough &&
    cupSpot === 'table' &&
    !!cupMilk &&
    bowlPoured &&
    cupSendStage !== 'sent' &&
    pourStage === 'idle';

  // Moves focus onto the ACTIVE cup itself the instant showSendSpotlight
  // turns on -- the bowl (focused by the previous beat) stays focused
  // through its own pour since it's the same persistent DOM node just
  // repositioned via inline styles, so without this the halo would simply
  // stay parked on the bowl instead of moving on to the actual next thing
  // to act on. Can't just grab the first '.glass-cup' the way firstCup does
  // elsewhere on this screen -- that's always the glass cup regardless of
  // which type is actually in play, and by this beat the player may well
  // have switched to plastic or the mug -- so this indexes into the same
  // three-cup DOM order (['glass', 'plastic', 'mug'], matching that
  // literal array's own order in the JSX below) by activeCup's own position
  // in it instead. activeCup is listed alongside showSendSpotlight in the
  // dep array (CI's react-hooks/exhaustive-deps treats a missing one as a
  // build-breaking error, not just a lint warning, since warnings are
  // treated as errors in production builds) -- harmless to re-run if
  // activeCup somehow changed after this beat already started, since it
  // just re-focuses the (now-correct) active cup rather than doing anything
  // destructive.
  useEffect(() => {
    if (showSendSpotlight) {
      const cups = containerRef.current
        ? Array.from(containerRef.current.querySelectorAll('.glass-cup'))
        : [];
      cups[['glass', 'plastic', 'mug'].indexOf(activeCup)]?.focus();
    }
  }, [showSendSpotlight, activeCup]);

  // Keeps restrictSendNavRef (declared/read far above, alongside
  // containerRef, for the same early-registration ordering reasons) in sync
  // with showSendSpotlight. No dependency array -- re-reads every render,
  // same "cheap and never a render behind" shape as this screen's other
  // restrict refs' own sync effects.
  useEffect(() => {
    restrictSendNavRef.current = showSendSpotlight;
  });

  // Sixth and actually-final first-order-only walkthrough beat, picking up
  // the instant showSendSpotlight above ends (cupSendStage reaches 'sent'
  // -- the cup, its contents, and the send zone have all stopped rendering
  // by then, see their own conditional returns/render guards further down)
  // and running for the rest of this screen's lifetime (this whole
  // component unmounts once the player actually leaves for Toppings). Same
  // "final beat hands the flashing baton to the current-step dot itself"
  // shape as Matcha Making's own showStationAdvanceSpotlight -- there's
  // nothing left on screen worth pointing at except the ProgressBar, so
  // this exempts that instead (see spotlightExempt on <ProgressBar> further
  // down) and its own new pink callout (milk-progress-callout below) takes
  // over from the bar's old plain-text currentStepHint, same "new
  // pink-styled callout replaces the old text hint for the first order
  // only" treatment every other beat on this screen already uses -- orders
  // 2/3 (!isWalkthrough) never set this and keep that old hint
  // exactly as before.
  const showAdvanceSpotlight = isWalkthrough && cupSendStage === 'sent';

  // Matcha poured on top of the milk -- same shape as cupMilk, just its own
  // state so a fresh milk pour doesn't wipe out matcha already poured (or
  // vice versa). { grade: 'cafe-grade' | 'classic-grade' | 'ceremonial-grade' }
  // | null -- grade picks the fill color (.cup-matcha-fill.<grade> in CSS),
  // carried over from incomingBowl.grade at the moment of the pour.
  const [cupMatcha, setCupMatcha] = useState(null);

  // Preconditions for starting a milk/water pour: cup has to actually be on
  // the table (nothing to pour into otherwise), nothing else can already be
  // mid-pour, and the drink can't already be on its way out. Deliberately
  // NOT gated on any ice actually being in the cup -- some orders call for
  // no ice at all, and requiring at least one cube first made those
  // impossible to make correctly.
  const canPourMilk = cupSpot === 'table' && pourStage === 'idle' && cupSendStage === 'idle';
  // Matcha only pours once there's actually a base to pour it onto -- same
  // "pour the topping after the base" ordering the user asked for -- plus
  // the usual cup-on-table/nothing-else-mid-pour preconditions, an actual
  // bowl to pour from, the bowl not already emptied (see bowlPoured above --
  // it only ever holds one pour's worth), and (same as canPourMilk) the
  // drink not already being sent off.
  const canPourMatcha =
    cupSpot === 'table' &&
    !!cupMilk &&
    pourStage === 'idle' &&
    !!incomingBowl &&
    !bowlPoured &&
    cupSendStage === 'idle';
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
          const item = bottleItems.find((b) => b.key === pouringKey);
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
    // Hovers over whichever cup is actually active's own table spot/size
    // (CUP_TYPES[activeCup]) rather than always the glass cup's -- both
    // milk and matcha need to land in whichever cup the player is actually
    // using.
    const activeTableSpot = CUP_TYPES[activeCup].tableSpot;
    const activeTableSize = CUP_TYPES[activeCup].tableSize;
    if (key === 'bowl') {
      if (!canPourMatcha) return;
      // Bowl no longer grows to its full MatchaMaking size while pouring
      // (see incomingBowlWidth/Height's own comment above -- per request,
      // it now stays at its small counter-resting size the whole time), so
      // the hover position is computed against that same rest size instead
      // of the old full-size anticipation this used to need.
      setBowlPos(
        getBottleHoverPos(activeTableSpot, activeTableSize, {
          width: incomingBowlRestWidth,
          height: incomingBowlRestHeight,
        })
      );
    } else {
      if (!canPourMilk) return;
      const item = bottleItems.find((b) => b.key === key);
      setBottlePositions((prev) => ({
        ...prev,
        [key]: getBottleHoverPos(activeTableSpot, activeTableSize, item),
      }));
    }
    setPouringKey(key);
    setPourStage('moving');
  };

  useEffect(() => {
    if (pourStage === 'moving') {
      // Straight to 'pouring' once the glide finishes -- no minigame stage
      // in between any more (the matcha bowl always worked this way; every
      // milk/water bottle now does too, per request to drop the balance
      // minigame entirely and go back to plain click-and-pour).
      const t = setTimeout(() => setPourStage('pouring'), BOTTLE_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (pourStage === 'pouring') {
      // "liquid pour" SFX -- fires once right as the fill actually
      // lands, covering both this same branch's cases: the matcha bowl
      // (pouringKey === 'bowl') and any milk/water base bottle (oat,
      // dairy, almond, coconut water, ...) poured into the cup below. Cut
      // short (not left to finish on its own) the moment BOTTLE_POUR_MS
      // elapses below, and also on cleanup (e.g. unmounting mid-pour), so
      // it never keeps playing past the pour itself.
      pourAudioRef.current = playLiquidPouring();
      if (pouringKey === 'bowl') {
        setCupMatcha({ grade: incomingBowl?.grade ?? 'classic-grade' });
        // bowlPoured (below) used to flip true right here, the instant the
        // pour lands, which triggered .bowl-whisked-liquid.emptied's fade
        // immediately -- while the bowl was still tilted mid-pour for the
        // rest of BOTTLE_POUR_MS. Moved to the setTimeout below instead, so
        // the whisked-liquid overlay stays fully visible and glued to the
        // bowl (rotating together, per the transform fix on this element's
        // own style block above) for the ENTIRE tilt/hold, and only pops
        // off the instant the pour actually finishes and the bowl untilts
        // -- reads as the matcha leaving the bowl right as the pour ends,
        // not partway through it.
      } else {
        // The fill always renders at its original fixed height (see
        // .cup-milk-fill's own cupMilkGrow keyframe in MilkSelection.css).
        setCupMilk({ type: pouringKey });
      }
      const t = setTimeout(() => {
        pourAudioRef.current?.pause();
        pourAudioRef.current = null;
        if (pouringKey === 'bowl') {
          setBowlPos(INCOMING_BOWL_SPOT);
          // The matcha has now left the bowl and landed in the cup -- pop
          // the whisked-liquid overlay off (see
          // .bowl-whisked-liquid.emptied's bowlLiquidPop animation in
          // MatchaMaking.css) so the bowl reads as empty for the rest of
          // this visit, right as it settles back to upright.
          setBowlPoured(true);
        } else {
          setBottlePositions((prev) => ({ ...prev, [pouringKey]: bottleHome[pouringKey] }));
        }
        setPourStage('idle');
        setPouringKey(null);
      }, BOTTLE_POUR_MS);
      return () => {
        clearTimeout(t);
        pourAudioRef.current?.pause();
        pourAudioRef.current = null;
      };
    }
    return undefined;
  }, [pourStage, pouringKey, incomingBowl, INCOMING_BOWL_SPOT, bottleHome]);

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
    // cupType is included mainly for forward-compatibility (e.g. a future
    // Toppings/Serving screen that renders the actual cup type carried
    // over) -- ToppingsStation.js's own carried-over cup rendering doesn't
    // read it yet and still always shows the glass cup art, a known,
    // deliberately out-of-scope-for-now simplification (this screen's own
    // shelf<->table/pour/send mechanics are what needed to work correctly
    // for both cup types, not what the next screen visually shows).
    // iceCubes: how many cubes were actually placed in the cup (icePlaced
    // itself is a per-slot boolean array; only the count matters on the
    // other side, since ToppingsStation just needs to know how many to
    // draw, not which specific box slots they came from) -- without this,
    // any ice the player placed here was silently vanishing the moment the
    // drink reached Toppings, since nothing in the handoff object carried
    // it over at all.
    onSendToToppings?.({
      milk: cupMilk,
      matcha: cupMatcha,
      cupType: activeCup,
      iceCubes: icePlaced.filter(Boolean).length,
    });
    // Grades this station's own contribution (cup type, ice count, milk/
    // base) against the placed order -- see gameloop/scoring.js's own
    // scoreMixingDrink. Same "read it right at the handoff, the last moment
    // this screen's own state still exists" reasoning as onSendToToppings
    // itself just above.
    onScored?.(
      scoreMixingDrink({
        cupType: activeCup,
        iceCubes: icePlaced.filter(Boolean).length,
        milkType: cupMilk?.type,
        order,
      })
    );
    setCupSendPos({
      left: SEND_DRINK_ZONE.left + SEND_DRINK_ZONE.width / 2 - CUP_TYPES[activeCup].tableSize.width / 2,
      top: SEND_DRINK_ZONE.top + SEND_DRINK_ZONE.height / 2 - CUP_TYPES[activeCup].tableSize.height / 2,
    });
    setCupSendStage('carrying');
  };

  useEffect(() => {
    if (cupSendStage === 'carrying') {
      const t = setTimeout(() => setCupSendStage('hovering'), CUP_SEND_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (cupSendStage === 'hovering') {
      const t = setTimeout(() => setCupSendStage('vanishing'), CUP_SEND_HOVER_MS);
      return () => clearTimeout(t);
    }
    if (cupSendStage === 'vanishing') {
      const t = setTimeout(() => setCupSendStage('sent'), CUP_SEND_VANISH_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [cupSendStage]);

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
    // Belt-and-suspenders alongside the bottles' own conditional
    // data-focusable below (see baseLocked's own big comment above) --
    // that's what actually stops a locked bottle from being reachable via
    // D-pad in the first place, but this guard covers the (currently
    // impossible, but cheap to guard against) case of Enter still somehow
    // reaching a locked bottle's handler.
    if (baseLocked) return;
    e.preventDefault();
    // Same "first move collapses the halo down to just the focused one"
    // rule as the nav-graph effect's own bottle leg -- Enter counts as a
    // move too.
    setBaseSpotlightMoved(true);
    playButtonClick();
    if (canPourMilk) {
      beginPour(item.key);
      return;
    }
    const home = bottleHome[item.key];
    setBottlePositions((prev) => ({ ...prev, [item.key]: { left: home.left, top: home.top } }));
  };

  // ---- Matcha bowl: select and press Enter to pour onto the cup (once
  // there's already a milk/water base). --------------------------------
  const handleBowlKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    if (!canPourMatcha) return;
    e.preventDefault();
    playButtonClick();
    beginPour('bowl');
  };

  return (
    <div className="milk-selection-container" ref={containerRef}>
      <h1 className="sr-only">Milk Mixing Station</h1>

      <div className="milk-selection-content">
        <img
          src="./MilkMixingStation.jpg"
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
            Now interactive -- select and press Enter to pour, same
            glide/tilt/pour/glide-home sequence as the milk bottles (see
            beginPour/bowlPos above), just reusing MatchaMaking.css's own
            .station-item.movable classes (focus glow, .settling) instead of
            .milk-bottle's, since this art was sized for that screen's own
            movable-item treatment. .station-item and .bowl-whisked-liquid
            are both defined in MatchaMaking.css, which is already loaded
            globally since MatchaMaking.js is always imported by App.js --
            reused here rather than duplicated so the look can't drift out
            of sync between the two screens.

            Bug fix: .bowl-whisked-liquid used to be a separate top-level
            sibling here, positioned every render from bowlPos via its own
            incomingRimLeft/Top/Width/Height (container-relative %) -- same
            "separately-dragged layers" bug MatchaMaking.js's own bowl +
            whisked-liquid used to have before THAT screen nested them into
            one wrapper (see the big comment on its own bowl-whisked-liquid
            JSX). The bowl's wrapper here moves via useFlipGlide's
            transform-based glide (registerFlip below), a completely
            different mechanism than .bowl-whisked-liquid's own CSS
            left/top transition -- so during the automated glide-to-cup
            pour sequence the two visibly drifted apart, one easing via a
            transform trick, the other via a plain left/top transition,
            never quite in sync. Nested inside this same .station-item-wrap
            now (left/top/width/height as plain percentages of the
            wrapper's own box, exact same fix shape as MatchaMaking.js's
            own), so it only ever moves because the wrapper does -- the two
            are physically locked together, not just timed to match. */}
        {incomingBowl && (
          <div
            ref={(el) => registerFlip('incoming-bowl', el)}
            className="station-item-wrap"
            style={{
              left: `${bowlPos.left}%`,
              top: `${bowlPos.top}%`,
              width: `${incomingBowlWidth}%`,
              height: `${incomingBowlHeight}%`,
            }}
          >
            <img
              src={incomingBowlItem.src}
              alt="Bowl of whisked matcha. Select it and press Enter to pour it in once there's milk or water in the cup."
              draggable={false}
              data-focusable
              tabIndex={0}
              className={`station-item movable incoming-bowl${
                pouringKey === 'bowl' ? ' settling' : ''
              }${showBowlSpotlight ? ' milk-spotlight-exempt' : ''}`}
              style={{
                ...(pouringKey === 'bowl' ? { transform: `rotate(${BOTTLE_POUR_ROTATE_DEG}deg)` } : {}),
              }}
              onKeyDown={handleBowlKeyDown}
            />
            <img
              src={WHISKED_LIQUID_IMAGES[incomingBowl.grade] ?? WHISKED_LIQUID_IMAGES['classic-grade']}
              alt=""
              aria-hidden="true"
              draggable={false}
              className={`bowl-whisked-liquid${bowlPoured ? ' emptied' : ''}${
                // Bug fix: this overlay wasn't getting exempted from
                // .milk-spotlight-overlay (z-index 25) during
                // showBowlSpotlight the way the bowl image right above it
                // is (see that img's own className) -- .bowl-whisked-liquid
                // itself only carries z-index: 1 (MatchaMaking.css), well
                // below the pink tint, so the matcha fill was invisible
                // (bowl reading as empty) for that entire beat even before
                // any pour. Same fix shape as MatchaMaking.css's own
                // .bowl-whisked-liquid.matcha-spotlight-exempt z-index
                // override for the analogous bug there.
                showBowlSpotlight ? ' milk-spotlight-exempt' : ''
              }`}
              style={{
                // Wrapper-relative percentages now (see this block's own
                // big comment above) instead of incomingRimLeft/Top/Width/
                // Height's old container-relative math -- left/top are
                // still the ellipse's own CENTER point, same centering
                // convention as MatchaMaking.js's own nested version
                // (translate(-50%, -50%), baked into .bowl-whisked-liquid's
                // own growFromCenter animation in MatchaMaking.css).
                left: `${BOWL_INNER_RIM_CENTER.leftFrac * 100}%`,
                top: `${BOWL_INNER_RIM_CENTER.topFrac * 100}%`,
                width: `${BOWL_INNER_RIM_WIDTH_FRAC * 100}%`,
                height: `${BOWL_INNER_RIM_HEIGHT_FRAC * 100}%`,
                // Bug fix: this used to set transform to JUST the tilt
                // (`rotate(...)`, no translate) the instant a pour started,
                // clobbering the translate(-50%, -50%) that centers this
                // element on its own left/top (see this style block's own
                // comment above, and growFromCenter/.bowl-whisked-liquid in
                // MatchaMaking.css, which bake that same translate into
                // every other state this element is ever in). Losing it
                // mid-pour snapped the ellipse from "centered on left/top"
                // to "top-left corner AT left/top" -- a visible jump away
                // from the bowl (and a bogus rotation origin) right as the
                // pour began, reading as the matcha "opening" away from the
                // bowl instead of tilting together with it. Keeping the
                // translate in the same transform as the rotate keeps this
                // rigidly centered on the bowl's own rim through the whole
                // tilt, exactly like every other state.
                ...(pouringKey === 'bowl'
                  ? { transform: `translate(-50%, -50%) rotate(${BOTTLE_POUR_ROTATE_DEG}deg)` }
                  : {}),
              }}
            />
          </div>
        )}
        {/* Three cup graphics -- glass (slot 1), plastic (slot 2), and mug
            (slot 3) of the same shelf cubby, see CUP_TYPES above -- but
            only one <img> per type ever renders, and only one of them is
            ever the fully interactive "cup in play" at a time (isActive,
            from activeCup).
            Keying on the cup type itself (key={type}), not on active/
            inactive role, means grabbing the inactive one and switching to
            it reuses the SAME DOM node across that switch (its props just
            change), rather than unmounting one <img> and mounting another
            -- which matters for keyboard/D-pad users specifically: without
            that, focus would drop back to document.body the instant a
            keyboard-driven switch (handleCupSwitchKeyDown) happened,
            same "why key matters for focus" reasoning documented at
            length in this project's own key-removal fix history.

            The ACTIVE cup keeps every behavior this single cup always had
            (the back/front transparent-sandwich experiment -- GlassCupBack.
            png/GlassCupFront.png -- is still parked in favor of a cheaper
            trick: the milk fill, rendered right below, paints UNDERNEATH
            this image in DOM order and is kept fairly translucent, so the
            cup's own outline/highlight linework still reads on top and the
            liquid looks like it's sitting behind/inside the cup rather than
            painted over it, without needing real alpha-channel art; stops
            rendering entirely once cupSendStage reaches 'sent', same
            "gone once sent" treatment MatchaMaking's own bowl gets; while
            'carrying'/'vanishing' it's still rendered but pointer-events:
            none -- inline, there's no .glass-cup.settling variant -- so it
            can't be grabbed mid-transit, and picks up .bowl-vanishing,
            reused from MatchaMaking.css already loaded globally, for the
            actual shrink/fade once 'vanishing' starts).

            The INACTIVE cup just sits, always fully interactive, at its
            own shelf spot -- Enter-confirming it runs handleCupSwitchKeyDown
            instead of the normal handleCupKeyDown, which is what actually
            performs the switch (see the big comment on activeCup above). */}
        {['glass', 'plastic', 'mug'].map((type) => {
          const cfg = CUP_TYPES[type];
          const isActive = activeCup === type;
          if (isActive && cupSendStage === 'sent') return null;
          const pos = isActive ? cupRenderPos : cfg.shelfSpot;
          const size = isActive ? cupRenderSize : cfg.shelfSize;
          const alt = !isActive
            ? `${cfg.alt}. Select it and press Enter to use this cup instead.`
            : cupSpot === 'shelf'
            ? `${cfg.alt}. Select it and press Enter to move it to the table.`
            : canSendDrink
            ? `${cfg.alt} with the finished drink. Select it and press Enter to send it to Toppings.`
            : `${cfg.alt}. Select it and press Enter.`;
          // Only ever true for the active cup, and only once it's actually
          // heading to Toppings -- 'carrying'/'hovering'/'vanishing', not
          // 'idle' (normal shelf/table cup, still fully interactive) or
          // 'sent' (already returned null above).
          const sending = isActive && cupSendStage !== 'idle';
          // Shrinks the cup (see .bowl-arrived, reused directly from
          // MatchaMaking.css) the instant it arrives at the Send Drink
          // zone, and keeps it shrunk through the slide-off that follows --
          // same `arrived`/`leaving` split, same reasoning, as isBowl's own
          // flags in MatchaMaking.js's MOVABLE_ITEMS.map().
          const arrived = isActive && (cupSendStage === 'hovering' || cupSendStage === 'vanishing');
          const leavingCup = isActive && cupSendStage === 'vanishing';
          return (
            // Every cup (active or not) always gets this SAME wrapper+img
            // shape, unconditionally -- switching which cup is active (see
            // handleCupSwitchKeyDown) has to keep reusing the same DOM node
            // for a given type's own <img> (see the big comment above on
            // why key={type} matters for keyboard focus), so the shape
            // can't differ between "idle" and "sending" or between active/
            // inactive, only the props/children inside it can.
            //
            // The milk fill/matcha fill/any placed ice cubes are nested
            // INSIDE this wrapper (below, active cup only) rather than
            // rendered as separate top-level siblings positioned from
            // cupRenderPos on every render -- that older setup gave each
            // one its own left/top recompute (and, for the send sequence,
            // its own copy of the shrink/fade treatment) that only ever
            // approximated the cup's own motion, the same "separately-
            // dragged layers" bug MatchaMaking.js's bowl + whisked-liquid
            // image used to have (see the isBowl branch in that file's
            // MOVABLE_ITEMS.map() for the full writeup) before they were
            // merged into one wrapper there. Nesting these here means they
            // only ever move because this wrapper moves, whether that's
            // the plain left/top glide to the zone or the shrink/slide-off
            // once it's arrived -- physically locked together, not just
            // separately timed to match.
            //
            // bowl-arrived/bowl-slide-off (reused directly from
            // MatchaMaking.css, already loaded globally -- same "reuse
            // rather than duplicate and risk drifting out of sync"
            // reasoning as this file's own .make-drink-zone/.bowl-vanishing/
            // .station-item-wrap reuse elsewhere) live on THIS wrapper, not
            // on the cup <img>/fills/ice cubes individually, for the same
            // "one shared parent transform carries the whole group" reason.
            //
            // z-index: 27 while `sending` -- same bug/fix as MatchaMaking's
            // own isBowl && settling: .bowl-arrived's scale() transform
            // starts a new local stacking context on this wrapper the
            // instant it applies, which needs an explicit z-index to still
            // clear .make-drink-zone (z-index 5, or 26 while its own
            // .milk-spotlight-exempt is up) at the page level -- and even
            // before .bowl-arrived applies (still 'carrying'), the cup
            // needs to already be clearing that zone marker as it glides
            // in, not just once it's shrunk. 27 beats the marker's every
            // tier outright, same value MatchaMaking uses for its own bowl.
            <div
              key={type}
              className={`cup-wrap${arrived ? ' bowl-arrived' : ''}${leavingCup ? ' bowl-slide-off' : ''}`}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${size.width}%`,
                height: `${size.height}%`,
                ...(sending ? { zIndex: 27 } : {}),
              }}
            >
              <img
                src={cfg.src}
                alt={alt}
                className={`glass-cup${
                  // Explicit, always-on version of the same white glow
                  // :focus-visible already gives every other selectable item
                  // (see .glass-cup:focus-visible in MilkSelection.css) --
                  // added per request/report that the auto-focused shelf cup
                  // wasn't showing it during this walkthrough beat.
                  // :focus-visible is a browser heuristic keyed on "was the
                  // last interaction keyboard-like," and the effect that
                  // auto-focuses the first cup the instant showCupSpotlight
                  // turns on can land right after a mouse-driven interaction
                  // on the previous screen, which some browsers don't count
                  // as keyboard-like -- so the ring silently never appeared
                  // until the player's first actual keypress. This class,
                  // tied to focusedCupType instead, isn't subject to that
                  // heuristic at all.
                  showCupSpotlight && focusedCupType === type ? ' milk-cup-focus-halo' : ''
                }${
                  // showCupSpotlight exempts all three (still deciding which
                  // cup to use); showIceSpotlight/showBaseSpotlight/
                  // showBaseSettling/showBowlSpotlight/showBowlSettling/
                  // showSendSpotlight only ever need the ACTIVE one exempt
                  // (the cup itself, now that it's confirmed) -- the other
                  // two are back to being ordinary spares sitting on the
                  // shelf and should tint like everything else. Still needed
                  // here (not just the wrapper's own z-index: 27 above) for
                  // the beats that can happen while cupSendStage is still
                  // 'idle' (showBowlSpotlight/showBowlSettling, during the
                  // matcha pour -- the wrapper has no elevated z-index of
                  // its own yet at that point).
                  showCupSpotlight ||
                  (isActive &&
                    (showIceSpotlight ||
                      showBaseSpotlight ||
                      showBaseSettling ||
                      showBowlSpotlight ||
                      showBowlSettling ||
                      showSendSpotlight))
                    ? ' milk-spotlight-exempt'
                    : ''
                }`}
                // Once a cup's confirmed onto the table (orders 2-5 only --
                // cupsLocked's own big comment above), the two OTHER
                // (inactive) cup types lose data-focusable/tabIndex
                // entirely, same "remove from useFlatFocusNav's live-
                // queried candidate list, and make the hardcoded nav
                // graph's own direct .focus() calls to it silently no-op"
                // reasoning as Matcha Making's own tins/kettle/whisk. The
                // ACTIVE cup is never affected by this -- it stays fully
                // focusable the whole time it's on the table.
                {...(!isActive && cupsLocked ? {} : { 'data-focusable': true, tabIndex: 0 })}
                draggable={false}
                style={{
                  ...(sending ? { pointerEvents: 'none' } : {}),
                }}
                onKeyDown={isActive ? handleCupKeyDown : handleCupSwitchKeyDown(type)}
                onFocus={() => setFocusedCupType(type)}
                onBlur={() => setFocusedCupType((prev) => (prev === type ? null : prev))}
              />
              {/* The milk fill itself -- see the big comment on
                  CUP_MILK_BOX_FRAC/cupMilk above for why this is a plain
                  colored shape rather than a swapped-in image. Rendered
                  here (only for the active cup), after the <img> above, so
                  DOM/paint order puts it on top of the cup art the same way
                  it always painted on top of the ice cubes underneath --
                  once there's enough milk in the cup the ice should read as
                  submerged/half-hidden in the liquid rather than floating
                  on top of it. pointer-events: none on .cup-milk-fill (see
                  the CSS) means this doesn't block dragging a cube back out
                  even while it's stacked on top visually. Only shown while
                  the cup's actually on the table and hasn't fully vanished
                  yet -- cupMilk itself doesn't get cleared when the cup
                  goes back to the shelf, but there'd be nothing sensible to
                  anchor the fill to up there (CUP_MILK_BOX_FRAC is only
                  ever computed off the active cup's own table spot, via
                  cupRenderPos/cupRenderSize). toCupRelative converts
                  cupMilkBox's own absolute (container-%) box into a
                  percentage of THIS wrapper's box instead, so it rides
                  along automatically with wherever the wrapper currently
                  is -- see that function's own big comment above for why.
                  No bowl-arrived/bowl-slide-off of its own needed anymore
                  (unlike before this was nested) -- the wrapper's own
                  shrink/slide-off already carries this along as part of
                  the same rigid unit. */}
              {isActive && cupMilk && cupSpot === 'table' && cupSendStage !== 'sent' && (
                <div
                  className={`cup-milk-fill ${cupMilk.type}${
                    showBowlSpotlight || showBowlSettling || showSendSpotlight ? ' milk-spotlight-exempt' : ''
                  }`}
                  aria-hidden="true"
                  style={(() => {
                    const rel = toCupRelative(cupMilkBox, cupRenderPos, cupRenderSize);
                    return {
                      left: `${rel.left}%`,
                      top: `${rel.top}%`,
                      width: `${rel.width}%`,
                      height: `${rel.height}%`,
                      // No --milk-fill-scale set here anymore -- the fill
                      // always renders at its original fixed height
                      // (cupMilkGrow's own default --milk-fill-scale of 1
                      // in MilkSelection.css).
                    };
                  })()}
                />
              )}
              {/* Matcha poured on top of the milk -- see the big comment on
                  CUP_MATCHA_RAISE_FRAC/getMatchaBoxFor above for the box,
                  and cupMatcha above for the state. Rendered right after
                  the milk fill so it paints on top of it (same "on top of
                  everything underneath" DOM-order reasoning as the milk
                  fill itself), using the milk fill's own left/top/width so
                  its taper lines up, just a shorter height. Same
                  toCupRelative/wrapper-carries-the-shrink-and-slide
                  reasoning as the milk fill above. */}
              {isActive && cupMatcha && cupSpot === 'table' && cupSendStage !== 'sent' && (
                <div
                  className={`cup-matcha-fill ${cupMatcha.grade}${
                    showBowlSettling || showSendSpotlight ? ' milk-spotlight-exempt' : ''
                  }`}
                  aria-hidden="true"
                  style={(() => {
                    const rel = toCupRelative(cupMatchaBox, cupRenderPos, cupRenderSize);
                    return {
                      left: `${rel.left}%`,
                      top: `${rel.top}%`,
                      width: `${rel.width}%`,
                      height: `${rel.height}%`,
                    };
                  })()}
                />
              )}
              {/* Placed ice cubes -- ONLY once the cup's actually being
                  sent (cupSendStage !== 'idle'/'sent'), nested here so they
                  ride along with the rest of the drink through the carry/
                  hover/slide-off. While cupSendStage is still 'idle', placed
                  cubes keep rendering the OLD way instead (see the
                  ICE_BOX_SPOTS.map() further down) -- that version is what
                  plays the "flies from the ice box into the cup" landing
                  transition the first time a cube gets placed (a plain
                  .ice-cube left/top CSS transition, which needs the cube to
                  stay a top-level, absolutely-positioned element to animate
                  across those two very different coordinate systems; it
                  can't animate into a wrapper-relative percentage the way
                  a plain "already sitting still" cube can). Since ice can
                  only ever get placed while cupSendStage is still 'idle'
                  (nothing re-enables placing once a send is underway), by
                  the time cupSendStage leaves 'idle' every placed cube has
                  long since finished that landing flight and is just
                  sitting still at the cup's current (table) position --
                  exactly where this nested version also renders it, so the
                  handoff from the old top-level element to this new nested
                  one is visually seamless, no jump. */}
              {isActive &&
                cupSendStage !== 'idle' &&
                cupSendStage !== 'sent' &&
                ICE_BOX_SPOTS.map((boxSpot, index) => {
                  if (!icePlaced[index]) return null;
                  const cubeSize = getIceCubeSize(activeCup);
                  const abs = getIceCupSlotPos(
                    index,
                    cupRenderPos,
                    cupRenderSize,
                    CUP_TYPES[activeCup].bodyFrac,
                    CUP_TYPES[activeCup].iceYOffsetFrac,
                    CUP_TYPES[activeCup].iceSpreadScale,
                    cubeSize
                  );
                  const rel = toCupRelative(
                    { left: abs.left, top: abs.top, width: cubeSize.width, height: cubeSize.height },
                    cupRenderPos,
                    cupRenderSize
                  );
                  return (
                    <img
                      key={index}
                      src="./IceCube.png"
                      alt=""
                      aria-hidden="true"
                      // showSendSpotlight is the only walkthrough beat that
                      // can still be up once cupSendStage has actually left
                      // 'idle' (see its own comment above -- it stays up
                      // through the whole carry/hover/vanish sequence), so
                      // it's the only exempt condition that matters here --
                      // but it still has to be applied: this nested cube is
                      // a DIFFERENT element from the top-level placed cube
                      // below (see the big comment above), which DOES carry
                      // milk-spotlight-exempt during showSendSpotlight. Without
                      // it here too, every placed cube silently lost its
                      // exemption the instant the send sequence began and got
                      // washed out under the pink walkthrough tint (z-index 25)
                      // for the rest of the carry -- reading as the cubes just
                      // vanishing mid-shrink -- even though the cup and its
                      // milk/matcha fills right alongside it stayed correctly
                      // exempt the whole time.
                      className={`ice-cube placed${showSendSpotlight ? ' milk-spotlight-exempt' : ''}`}
                      draggable={false}
                      style={{
                        left: `${rel.left}%`,
                        top: `${rel.top}%`,
                        width: `${rel.width}%`,
                        height: `${rel.height}%`,
                      }}
                    />
                  );
                })}
            </div>
          );
        })}
        {/* Name label above whichever cup currently has the white focus
            halo (see focusedCupType above) -- "glass cup"/"plastic cup"/
            "mug". Uses that same cup's own live pos/size (recomputed the same way
            the loop above works them out) so it tracks correctly whether
            the focused cup is sitting on the shelf, on the table, or
            mid-drag. Suppressed once the cup's actually on the table
            (cupSpot === 'table') -- per request, no need to keep naming it
            once it's been placed there; this only ever matters for the
            active cup regaining focus later (e.g. showSendSpotlight's own
            effect refocusing it to send the drink), since a shelf cup
            can't be focusedCupType while a different one is already
            active on the table. */}
        {['glass', 'plastic', 'mug']
          .filter((type) => type === focusedCupType && !(type === activeCup && cupSpot === 'table'))
          .map((type) => {
            const cfg = CUP_TYPES[type];
            const isActive = activeCup === type;
            const pos = isActive ? cupRenderPos : cfg.shelfSpot;
            const size = isActive ? cupRenderSize : cfg.shelfSize;
            return (
              <p
                key={type}
                className="cup-label"
                aria-hidden="true"
                style={{
                  left: `${pos.left + size.width / 2}%`,
                  top: `${pos.top - CUP_LABEL_GAP}%`,
                }}
              >
                {CUP_LABELS[type].replace(' ', '\n')}
              </p>
            );
          })}
        {ICE_BOX_SPOTS.map((boxSpot, index) => {
          const placed = icePlaced[index];
          // Once the cup's actually being sent (cupSendStage leaves
          // 'idle'), any cube that was placed in the cup switches over to
          // rendering nested inside the active cup's own .cup-wrap instead
          // (see the isActive branch of the cup-type map further up) --
          // this covers 'carrying'/'hovering'/'vanishing'/'sent' alike, so
          // there's exactly one rendering of a given placed cube at any
          // moment, never both. An unplaced cube still sitting in the box
          // is unaffected either way.
          if (placed && cupSendStage !== 'idle') return null;
          const pos = placed
            ? getIceCupSlotPos(
                index,
                cupRenderPos,
                cupRenderSize,
                CUP_TYPES[activeCup].bodyFrac,
                CUP_TYPES[activeCup].iceYOffsetFrac,
                CUP_TYPES[activeCup].iceSpreadScale,
                getIceCubeSize(activeCup)
              )
            : boxSpot;
          const size = placed ? getIceCubeSize(activeCup) : ICE_BOX_SIZE;
          return (
            <img
              key={index}
              src="./IceCube.png"
              alt={placed ? '' : 'Ice cube. Select it and press Enter to place it in the cup.'}
              aria-hidden={placed || undefined}
              className={`ice-cube${placed ? ' placed' : ''}${
                // Per request: every still-unplaced cube gets the white
                // focus halo the instant showIceSpotlight turns on, until
                // the player's first arrow/Enter press (iceSpotlightMoved --
                // see its own comment above), at which point this drops
                // away and the normal single-cube :focus-visible halo (see
                // .ice-cube:focus-visible in MilkSelection.css) takes back
                // over on its own.
                showIceSpotlight && !iceSpotlightMoved && !placed ? ' milk-ice-focus-halo' : ''
              }${
                // showIceSpotlight exempts every cube (still being placed);
                // showBaseSpotlight/showBaseSettling/showBowlSpotlight/
                // showBowlSettling/showSendSpotlight only ever need the
                // ones actually IN the cup exempt -- the rest still
                // sitting in the box are back to being ordinary unplaced
                // cubes and should tint like everything else.
                showIceSpotlight ||
                ((showBaseSpotlight || showBaseSettling || showBowlSpotlight || showBowlSettling || showSendSpotlight) &&
                  placed)
                  ? ' milk-spotlight-exempt'
                  : ''
              }`}
              // Once a cube's placed in the cup, it becomes fully inert to
              // the player and can never be focused at all -- no tabIndex
              // (so it's outside native Tab order AND can't be
              // programmatically .focus()'d -- an <img> with no tabIndex
              // isn't a focusable element, period), no data-focusable (so
              // useFlatFocusNav's generic spatial fallback skips it too), no
              // pointer/drag handlers, and pointer-events: none in the CSS
              // (.ice-cube.placed) so it can't even be clicked. It used to
              // stay grabbable so it could be dragged back out, but that sat
              // right on top of/next to the cup and kept "stealing" the
              // landing spot/focus highlight on presses that weren't
              // explicitly wired elsewhere -- per request, a placed cube's
              // ice decision is now final and it's a plain decorative image
              // from that point on. The one spot that used to rely on being
              // able to focus the front-of-the-pile cube programmatically
              // (firstIceCube, in the Bowl's own Left handler above) now
              // skips placed cubes and looks for the first still-unplaced
              // one instead, so nothing in this file needs to focus a
              // placed cube anymore. Cubes still in the ice box are
              // unaffected either way.
              // Once there's already liquid in the cup (orders 2-5 only --
              // iceLocked's own big comment above), any cube still sitting
              // in the box loses data-focusable/tabIndex too, same
              // reasoning as a placed cube's own removal just below --
              // there's nothing left for the player to do with the ice box
              // at that point.
              {...(placed || iceLocked ? {} : { 'data-focusable': true, tabIndex: 0 })}
              draggable={false}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${size.width}%`,
                height: `${size.height}%`,
              }}
              {...(placed
                ? {}
                : {
                    onKeyDown: handleIceKeyDown(index),
                  })}
            />
          );
        })}
        {/* The milk fill and matcha fill used to render here as separate
            top-level siblings, positioned from cupRenderPos on every
            render -- they're now nested inside the active cup's own
            .cup-wrap instead (see the isActive branch of the cup-type map
            further up), so they ride the same wrapper the cup <img> itself
            moves by rather than approximating its position/motion
            independently. See the big comment on that JSX for the full
            reasoning. */}
        {bottleItems.map((item) => {
          const pos = bottlePositions[item.key];
          // All four bottles share the same pour sequence now -- settling/
          // pouring are both just "is this the one bottle currently mid-
          // pour" (pouringKey), since pourStage only ever tracks one bottle
          // at a time.
          const isPouring = pouringKey === item.key;
          const settling = isPouring;
          const pouring = isPouring;
          return (
            <div
              key={item.key}
              ref={(el) => registerFlip(item.key, el)}
              className="station-item-wrap"
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${item.width}%`,
                height: `${item.height}%`,
              }}
            >
              <img
                src={item.src}
                alt={`${item.alt}. Select it and press Enter to pour some in once the cup has ice in it.`}
                className={`milk-bottle${settling ? ' settling' : ''}${
                  // Per request: every bottle gets the white focus halo the
                  // instant showBaseSpotlight turns on, until the player's
                  // first arrow/Enter press (baseSpotlightMoved -- see its own
                  // comment above), at which point this drops away and the
                  // normal single-bottle :focus-visible halo (see
                  // .milk-bottle:focus-visible in MilkSelection.css) takes
                  // back over on its own. Excluded while actually pouring
                  // (isPouring), same "don't halo the one mid-animation"
                  // reasoning as the ice cubes excluding placed ones.
                  showBaseSpotlight && !baseSpotlightMoved && !isPouring ? ' milk-bottle-focus-halo' : ''
                }${
                  showBaseSpotlight ? ' milk-spotlight-exempt' : ''
                }`}
                // Once a base has actually been poured (orders 2-5 only --
                // baseLocked's own big comment above), every bottle loses
                // data-focusable/tabIndex, same "remove from useFlatFocusNav's
                // live-queried candidate list, and make the hardcoded nav
                // graph's own direct .focus() calls to it silently no-op"
                // reasoning as Matcha Making's own tins/kettle/whisk.
                {...(baseLocked ? {} : { 'data-focusable': true, tabIndex: 0 })}
                draggable={false}
                style={{
                  ...(pouring ? { transform: `rotate(${BOTTLE_POUR_ROTATE_DEG}deg)` } : {}),
                }}
                onKeyDown={handleBottleKeyDown(item)}
                onFocus={() => setFocusedBottle(item.key)}
                onBlur={() => setFocusedBottle((prev) => (prev === item.key ? null : prev))}
              />
            </div>
          );
        })}
        {/* Name label above whichever bottle currently has the white focus
            halo (see focusedBottle above) -- e.g. "Oat Milk", "Dairy Milk".
            Tracks the bottle's own live position (pos, same as the image
            above) rather than its home spot. top is anchored at the
            bottle's own top edge minus the gap; .milk-bottle-label's own
            translate(-50%, -100%) is what actually lifts the label fully
            above that anchor line regardless of the label's own text
            height. */}
        {bottleItems.filter((item) => item.key === focusedBottle).map((item) => {
          const pos = bottlePositions[item.key];
          return (
            <p
              key={item.key}
              className="milk-bottle-label"
              aria-hidden="true"
              style={{
                left: `${pos.left + item.width / 2}%`,
                top: `${pos.top - BOTTLE_LABEL_GAP}%`,
              }}
            >
              {BOTTLE_LABELS[item.key].replace(' ', '\n')}
            </p>
          );
        })}
        {/* Falling-liquid pour effect -- see the big comment on
            pourLeft/pourTop/pourHeight/pourColor above. Reuses
            MatchaMaking.css's .spoon-pour/.spoon-pour-grain-N (its
            z-index: 20 is what keeps it visibly on top of the cup image's
            own drop-shadow stacking context, same reasoning as there).
            Only shown during the actual 'pouring' stage, not 'moving' --
            same as the kettle's falling water only appearing once it's
            arrived and tilted, not while it's still gliding into place.
            Used to be scoped to pouringKey === 'bowl' only, back when the
            milk/water base's own pour had a separate balance minigame
            (bar+ball) that was its whole visual -- that minigame's been
            removed entirely per request (reported as never rendering
            visibly, see MilkSelection.css's own removal comment on
            .milk-mix-bar), so every pour is back to this same plain stream,
            same as the matcha bowl always used. Exempted from the
            walkthrough tint during showBaseSpotlight (before the base
            bottle's own pour starts), showBaseSettling (the base bottle's
            pour itself, now that showBowlSpotlight no longer picks up
            until it's finished -- see that flag's own comment above),
            showBowlSpotlight (before the matcha's own pour starts), and
            showBowlSettling (the matcha pour itself, same reasoning as
            showBaseSettling -- showSendSpotlight no longer picks up until
            it's finished either) -- this stream's z-index (20) sits below
            .milk-spotlight-overlay's (25), so without this it'd paint
            invisibly under the pink tint during the first order's own
            walkthrough for any of the pours. */}
        {pourStage === 'pouring' && (
          <div
            className={`spoon-pour${
              showBaseSpotlight || showBaseSettling || showBowlSpotlight || showBowlSettling
                ? ' milk-spotlight-exempt'
                : ''
            }`}
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
            poured and, per request (matching the same fix on MatchaMaking's
            own zone), just STAYS on screen from then on -- through
            'carrying'/'hovering'/'vanishing'/'sent', all the way to this
            customer's own visit ending -- rather than unmounting the
            instant the cup heads there. Deliberately NOT gated on
            canSendDrink itself (which requires cupSendStage === 'idle') --
            that condition is only for whether Enter/a drop actually SENDS
            the cup right now, not for whether this marker should still be
            visible; showSendSpotlight below (which already spans the whole
            send sequence, only excluding 'sent') is what makes it lose its
            .milk-spotlight-exempt class at exactly the point the
            walkthrough's own next beat/label (showAdvanceSpotlight) picks
            up, so the pink tint (first order only) simply paints over it
            then -- covered, not removed. Not itself focusable -- it's a drop
            target the *cup* gets sent to via its own Enter press (see
            handleCupKeyDown above), same "the marker just marks a zone"
            pattern as the ice box/cup zones elsewhere on this screen. Just
            a plain gray square with a thick arrow pointing at it -- no
            text, no animation (see .make-drink-zone's own comment in
            MatchaMaking.css). */}
        {cupSpot === 'table' && !!cupMilk && pourStage === 'idle' && (
          <div
            className={`make-drink-zone${showSendSpotlight ? ' milk-spotlight-exempt' : ''}`}
            aria-hidden="true"
            style={{
              left: `${SEND_DRINK_ZONE.left}%`,
              top: `${SEND_DRINK_ZONE.top}%`,
              width: `${SEND_DRINK_ZONE.width}%`,
              height: `${SEND_DRINK_ZONE.height}%`,
            }}
          >
            <svg className="make-drink-zone-arrow" viewBox="0 0 60 40" preserveAspectRatio="none">
              <polygon points="0,12 32,12 32,2 58,20 32,38 32,28 0,28" />
            </svg>
          </div>
        )}

        <OrderReceiptButton
          order={order}
          spotlightExempt={showStationSpotlight}
          onToggle={(nowOpen) => {
            // Only the *closing* toggle (nowOpen === false) retires
            // showOrderHint/showStationSpotlight -- the opening one fires
            // first and shouldn't, since the player hasn't closed it back
            // up yet. Same split as MatchaMaking's own onToggle.
            if (!nowOpen) setShowOrderHint(false);
            // The *opening* toggle, on the other hand, is exactly what
            // retires showOrderButtonLock -- see that flag's own comment
            // above for why it's a separate, shorter-lived flag from
            // showOrderHint. Only ever needs to flip true once (never reset
            // back).
            if (nowOpen) setHasOpenedOrderReceipt(true);
          }}
        />
        {/* First-order-only walkthrough callout -- label + arrow sitting to
            the LEFT of the Order button, arrow pointing right at it, same
            "arrow at the edge closest to the target, text beside it" shape
            as .matcha-order-callout in MatchaMaking.css (also sits beside
            its target with a sideways-pointing arrow rather than above/
            below it) -- reusing the exact same right/top position since
            it's the same widget in the same top-right corner on every
            screen. Gone the instant showStationSpotlight ends (the button's
            actually been opened and closed once). */}
        {showStationSpotlight && (
          <div className="milk-order-callout">
            <p className="milk-order-callout-text">check cup type, ice amount, and drink base</p>
            <svg
              className="milk-order-callout-arrow"
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
          // Final highlight beat for this station: once the drink's fully
          // sent off (cupSendStage 'sent'), there's nothing left to do here,
          // so the current-step dot flashes as the "ok to move on" signal --
          // same opt-in highlightCurrentStep/currentStepHint props
          // MatchaMaking uses for its own matching beat.
          highlightCurrentStep={cupSendStage === 'sent'}
          // Suppressed while showAdvanceSpotlight is up -- the new callout
          // below (milk-progress-callout) takes over this job for the first
          // order specifically. Also now suppressed for orders 2+ entirely,
          // per request -- walkthrough-only label.
          currentStepHint={
            isWalkthrough && !showAdvanceSpotlight
              ? 'use your right arrow key to move on to the toppings station.'
              : null
          }
          // Suppressed while showOrderButtonLock or showCupSpotlight is up
          // so the current-step dot's own autoFocus doesn't grab the
          // walkthrough's very first selection out from under the Order
          // button's/cup's own focus effects -- same pairing as Customer
          // Ordering/Matcha Making's own suppressInitialFocus.
          suppressInitialFocus={showOrderButtonLock || showCupSpotlight}
          // Exempts the whole bar from the walkthrough spotlight once
          // showAdvanceSpotlight is up -- the sixth beat's own target, once
          // there's nothing else left on screen to point at (see that
          // flag's own comment above).
          spotlightExempt={showAdvanceSpotlight}
        />
        {/* First-order-only walkthrough callout -- label + arrow sitting to
            the LEFT of the cup shelf, arrow pointing right at it, same
            "arrow at the edge closest to the target, text beside it" shape
            as .matcha-order-callout/.matcha-scoop-callout in
            MatchaMaking.css (both also sit beside their target with a
            sideways-pointing arrow rather than above/below it). Positioned
            off CUP_SPOTS.shelf's own left/top+height (see the milk-cup-
            callout comment in MilkSelection.css for the actual numbers) so
            it stays put regardless of which cup type happens to render
            first. Gone the instant showCupSpotlight ends (a cup's actually
            been confirmed onto the table). */}
        {showCupSpotlight && (
          <div className="milk-cup-callout">
            <p className="milk-cup-callout-text">use the arrows and select right cup</p>
            <svg
              className="milk-cup-callout-arrow"
              viewBox="0 0 40 24"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="38,12 2,2 2,22" />
            </svg>
          </div>
        )}
        {/* Second first-order-only walkthrough callout -- see
            showIceSpotlight above. Text above, arrow below pointing down at
            the ice box (same "text first, arrow last" shape as
            .matcha-tin-callout in MatchaMaking.css, whose own target also
            sits below it). Centered over the ice box's own two-column
            cluster (ICE_BOX_SPOTS: left 7.18/12.93, each ICE_BOX_SIZE.width
            5.03 wide, so 12.57 -- rounded to 12.6 -- centers over the
            midpoint of both columns), sitting just clear of the box's own
            top edge (73.30) -- eyeballed the same way every other exact
            position in this project is, may need a small nudge once
            actually seen against the live render. Gone the instant
            showIceSpotlight ends (all 3 requested cubes actually placed in
            the cup). */}
        {showIceSpotlight && (
          <div className="milk-ice-callout">
            <p className="milk-ice-callout-text">place the right number of ice cubes in the cup</p>
            <svg
              className="milk-ice-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {/* Third first-order-only walkthrough callout -- see
            showBaseSpotlight above. Column layout, arrow above pointing up
            at the bottle row, text below -- moved below the bottle cluster
            with the arrow flipped to point up at it, per request (was
            text above/arrow below pointing down, positioned above the
            cluster). BOTTLE_ITEMS_BASE's own computed left/top+height in
            MilkSelection.js works out to roughly left 69.5-96.5, top
            45-83, so left: 75% still centers over that span and top: 87%
            clears its own bottom edge -- eyeballed the same way every
            other exact position in this project is, may need a small
            nudge once actually seen against the live render. Gone the
            instant showBaseSpotlight ends (a base is actually poured). */}
        {showBaseSpotlight && (
          <div className="milk-base-callout">
            <svg
              className="milk-base-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,2 22,36 2,36" />
            </svg>
            <p className="milk-base-callout-text">use the arrows and select the right drink base</p>
          </div>
        )}
        {/* Fourth first-order-only walkthrough callout -- see
            showBowlSpotlight above. Text above, arrow below pointing down
            at the bowl (same "text first, arrow last" shape as
            .milk-ice-callout/.matcha-tin-callout above). Positioned above
            the bowl's own resting spot (INCOMING_BOWL_SPOT works out to
            roughly left 23, top 57, width/height ~11.1/21.2 -- see that
            constant's own comment further up -- so left: 28.5 centers over
            its horizontal midpoint, top: 44 sits well clear of its own top
            edge) -- eyeballed the same way every other exact position in
            this project is, may need a small nudge once actually seen
            against the live render. Gone the instant showBowlSpotlight ends
            (the matcha's actually landed in the cup). */}
        {showBowlSpotlight && (
          <div className="milk-bowl-callout">
            <p className="milk-bowl-callout-text">add the matcha mix</p>
            <svg
              className="milk-bowl-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {/* Fifth and final first-order-only walkthrough callout -- see
            showSendSpotlight above. Text above, arrow below pointing down
            at the cup, same "text first, arrow last" shape as
            .milk-ice-callout/.milk-bowl-callout above. Positioned above the
            cup's own table spot (CUP_SPOTS.table: left 40.30, top 40.10,
            TABLE_SIZE.width 19.40 -- so left: 50 centers over its
            horizontal midpoint, same for every cup type since plastic/mug's
            own table spots are each re-centered around that same midpoint
            -- top: 26 sits well clear of its own top edge) -- eyeballed the
            same way every other exact position in this project is, may
            need a small nudge once actually seen against the live render.
            Gone the instant showSendSpotlight ends (the drink's actually
            on its way to Toppings). */}
        {showSendSpotlight && (
          <div className="milk-send-callout">
            <p className="milk-send-callout-text">select the drink to take it to the next station</p>
            <svg
              className="milk-send-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {/* Sixth and final beat of the walkthrough: once the drink has
            actually been sent (cupSendStage === 'sent', i.e. the carry/
            vanish animation has finished and we're one keypress away from
            Toppings), the pink tint is still up (see showSendSpotlight's
            own condition above, now extended through 'carrying'/'vanishing'
            so there's no gap in the tint between beats) but there's nothing
            left on THIS screen to point at -- the actual next action is the
            right-arrow key itself, so this callout points down at the
            ProgressBar/station dots (which spotlightExempt has punched a
            hole through the tint for, see the ProgressBar call above)
            instead of at any one element on the counter. Replaces the old
            plain-text currentStepHint (now suppressed via the
            showAdvanceSpotlight ? null : ... ternary above) with this same
            pink-callout treatment so the whole walkthrough stays visually
            consistent right up to the screen transition. */}
        {showAdvanceSpotlight && (
          <div className="milk-progress-callout">
            <p className="milk-progress-callout-text">use the right arrow to move to the next station</p>
            <svg
              className="milk-progress-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
        {/* First-order-only walkthrough spotlight -- covers every beat on
            this screen's walkthrough (showStationSpotlight, then
            showCupSpotlight, then showIceSpotlight, then showBaseSpotlight,
            then showBaseSettling (bridges the base bottle's own pour --
            see that flag's own comment above), then showBowlSpotlight,
            then showBowlSettling (same bridging role for the matcha
            pour), then showSendSpotlight, then showAdvanceSpotlight -- same
            layered-onto-one-overlay shape
            Matcha Making uses for its own longer walkthrough). Same flat,
            full-screen pink tint (no SVG mask, no holes, just a div with a
            higher-z-index element punched through it) as every other
            spotlight overlay in this project -- see
            .matcha-spotlight-overlay in MatchaMaking.css for the shared
            reasoning. Rendered LAST (after ProgressBar and all seven
            callouts above, not before) so it actually paints over
            everything else on this screen by default -- only whichever
            elements the active beat exempts (the Order receipt widget via
            spotlightExempt on <OrderReceiptButton> for the first beat, then
            milk-spotlight-exempt on the cup/ice cube/bottle/milk-fill/
            matcha-fill/bowl/send-zone classNames above, and spotlightExempt
            on the ProgressBar call for the final beat) punch through it via
            a higher z-index. pointer-events: none so it never blocks input
            while it's up. */}
        {(showStationSpotlight ||
          showCupSpotlight ||
          showIceSpotlight ||
          showBaseSpotlight ||
          showBaseSettling ||
          showBowlSpotlight ||
          showBowlSettling ||
          showSendSpotlight ||
          showAdvanceSpotlight) && <div className="milk-spotlight-overlay" aria-hidden="true" />}
      </div>
    </div>
  );
};

export default MilkSelection;
