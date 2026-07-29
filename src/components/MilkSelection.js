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
const TABLE_SIZE = { width: 19.40, height: 37.16 }; // same aspect ratio, 3x

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

function getCupMilkBox() {
  const cup = CUP_SPOTS.table;
  return {
    left: cup.left + CUP_MILK_BOX_FRAC.leftFrac * TABLE_SIZE.width,
    top: cup.top + CUP_MILK_BOX_FRAC.topFrac * TABLE_SIZE.height,
    width: (CUP_MILK_BOX_FRAC.rightFrac - CUP_MILK_BOX_FRAC.leftFrac) * TABLE_SIZE.width,
    height: (CUP_MILK_BOX_FRAC.bottomFrac - CUP_MILK_BOX_FRAC.topFrac) * TABLE_SIZE.height,
  };
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

const MilkSelection = ({ activeStep, customerNumber, onNavigate, onAdvance, order, incomingBowl }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  // ---- Carried-over bowl from Matcha Making (see incomingBowl above) -----
  // Just the bowl + whisked-matcha image, no whisk -- reuses the same
  // BOWL_INNER_RIM_* fractions MatchaMaking.js uses for its own
  // whisked-liquid image, just anchored to this screen's own
  // INCOMING_BOWL_SPOT instead of wherever the bowl happened to be dragged
  // on that screen, so the whisked matcha lines up with the bowl's rim
  // here the same way it does there.
  const incomingBowlItem = MOVABLE_ITEMS.find((item) => item.key === 'bowl');
  const incomingRimLeft = INCOMING_BOWL_SPOT.left + BOWL_INNER_RIM_CENTER.leftFrac * incomingBowlItem.width;
  const incomingRimTop = INCOMING_BOWL_SPOT.top + BOWL_INNER_RIM_CENTER.topFrac * incomingBowlItem.height;
  const incomingRimWidth = BOWL_INNER_RIM_WIDTH_FRAC * incomingBowlItem.width;
  const incomingRimHeight = BOWL_INNER_RIM_HEIGHT_FRAC * incomingBowlItem.height;

  // ---- Glass cup: shelf <-> table --------------------------------------
  const [cupSpot, setCupSpot] = useState('shelf');
  const [cupDragPos, setCupDragPos] = useState(null);
  const cupDragStartRef = useRef({ pointerX: 0, pointerY: 0, cupLeft: 0, cupTop: 0 });

  const handleCupPointerDown = (e) => {
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
    const midpoint = (CUP_SPOTS.shelf.top + CUP_SPOTS.table.top) / 2;
    setCupSpot(cupDragPos.top > midpoint ? 'table' : 'shelf');
    setCupDragPos(null);
  };

  const handleCupKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    setCupSpot((prev) => (prev === 'shelf' ? 'table' : 'shelf'));
  };

  const cupRenderPos = cupDragPos || CUP_SPOTS[cupSpot];
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
  // in MatchaMaking.js.
  const cupMilkBox = getCupMilkBox();

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

  // ---- Pouring a bottle into the cup (see the big comment on
  // BOTTLE_HOVER_GAP/getBottleHoverPos above) -------------------------------
  //   'idle'     -- normal, every bottle sits wherever it was left, freely
  //                 draggable.
  //   'moving'   -- confirmed (dropped on the cup, or Enter/Space) --
  //                 gliding to the hover-over-cup spot and tilting. No
  //                 longer draggable.
  //   'pouring'  -- arrived; cupMilk is set (the fill appears) and it holds
  //                 the tilt for BOTTLE_POUR_MS before gliding back home and
  //                 returning to 'idle' on its own -- reusable, same as the
  //                 kettle, not a one-time-use item like the matcha spoon.
  // Only one bottle can be mid-pour at a time (there's only one cup) --
  // pouringKey tracks which one, alongside the shared pourStage above.
  const [pourStage, setPourStage] = useState('idle');
  const [pouringKey, setPouringKey] = useState(null); // 'oat' | 'dairy' | 'almond' | 'coconut' | null
  // The cup's own persistent "has milk been poured in" state -- doesn't
  // reset on its own (only a fresh pour re-sets it), same "second pour just
  // restarts this rather than accumulating a bigger fill" caveat as the
  // matcha bowl's bowlWater. { type: 'oat' | 'dairy' | 'almond' | 'coconut' }
  // | null -- type picks both the fill color (.cup-milk-fill.<type> in CSS)
  // and which liquid was poured in last (a fresh pour of a different bottle
  // just replaces it, same "doesn't accumulate" simplification).
  const [cupMilk, setCupMilk] = useState(null);

  // Preconditions for starting a pour: cup has to actually be on the table
  // (nothing to pour into otherwise), at least one ice cube already has to
  // be in it, and no other bottle can already be mid-pour.
  const canPourAny = cupSpot === 'table' && icePlaced.some(Boolean) && pourStage === 'idle';

  // ---- Falling-liquid pour effect -----------------------------------------
  // Reuses the exact same .spoon-pour/.spoon-pour-grain-N visual machinery
  // MatchaMaking.js built for the falling matcha powder and falling kettle
  // water (that stylesheet is already loaded globally -- see the comment on
  // the carried-over bowl/whisked-liquid images above for why). Anchored to
  // whichever bottle is currently pouring (pouringKey) at its own current
  // position (bottlePositions[pouringKey] -- during 'moving'/'pouring'
  // that's the hover-over-cup spot getBottleHoverPos put it at, same
  // live-position reasoning as the kettle's own kettlePourLeft/
  // kettlePourTop) rather than a measured spout offset, since there's no
  // pinned spout pixel for this art (see the getBottleHoverPos comment
  // above) -- horizontally centered on the bottle, vertically from its
  // bottom edge. Falls down to the milk fill's own top edge (cupMilkBox.top)
  // so the stream reads as landing right where the liquid appears, the same
  // "falls to the target fill's top" shape as bowlWaterTop/bowlPowderTop in
  // MatchaMaking.js. All fall back to harmless zero/oat defaults when
  // nothing's pouring -- guarded by pourStage/pouringKey in the JSX below so
  // they're never actually rendered in that state.
  const pouringItem = pouringKey ? BOTTLE_ITEMS.find((b) => b.key === pouringKey) : null;
  const pouringPos = pouringKey ? bottlePositions[pouringKey] : null;
  const pourLeft = pouringItem && pouringPos ? pouringPos.left + pouringItem.width / 2 : 0;
  const pourTop = pouringItem && pouringPos ? pouringPos.top + pouringItem.height : 0;
  const pourHeight = pouringPos ? Math.max(cupMilkBox.top - pourTop, 1) : 0;
  const pourColor = MILK_STREAM_COLORS[pouringKey] ?? MILK_STREAM_COLORS.oat;

  const beginPour = (key) => {
    if (!canPourAny) return;
    const item = BOTTLE_ITEMS.find((b) => b.key === key);
    setBottlePositions((prev) => ({
      ...prev,
      [key]: getBottleHoverPos(CUP_SPOTS.table, TABLE_SIZE, item),
    }));
    setPouringKey(key);
    setPourStage('moving');
  };

  useEffect(() => {
    if (pourStage === 'moving') {
      const t = setTimeout(() => setPourStage('pouring'), BOTTLE_MOVE_MS);
      return () => clearTimeout(t);
    }
    if (pourStage === 'pouring') {
      setCupMilk({ type: pouringKey });
      const t = setTimeout(() => {
        setBottlePositions((prev) => ({ ...prev, [pouringKey]: BOTTLE_HOME[pouringKey] }));
        setPourStage('idle');
        setPouringKey(null);
      }, BOTTLE_POUR_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [pourStage, pouringKey]);

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
    if (canPourAny && isOverCup(bottleDrag.left, bottleDrag.top, cupSpot)) {
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
  // are met (see canPourAny above), Enter pours whichever bottle is
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
    if (canPourAny) {
      beginPour(item.key);
      return;
    }
    const home = BOTTLE_HOME[item.key];
    setBottlePositions((prev) => ({ ...prev, [item.key]: { left: home.left, top: home.top } }));
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
            Purely decorative (aria-hidden, no data-focusable/tabIndex) --
            nothing to drag/select here yet, this just shows the
            drink-in-progress carried over rather than disappearing.
            .station-item and .bowl-whisked-liquid are both defined in
            MatchaMaking.css, which is already loaded globally since
            MatchaMaking.js is always imported by App.js -- reused here
            rather than duplicated so the look can't drift out of sync
            between the two screens. */}
        {incomingBowl && (
          <>
            <img
              src={incomingBowlItem.src}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="station-item"
              style={{
                left: `${INCOMING_BOWL_SPOT.left}%`,
                top: `${INCOMING_BOWL_SPOT.top}%`,
                width: `${incomingBowlItem.width}%`,
                height: `${incomingBowlItem.height}%`,
              }}
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
            painted over it, without needing real alpha-channel art. */}
        <img
          src="./GlassCup.png"
          alt={
            cupSpot === 'shelf'
              ? 'Glass cup. Drag from the shelf to the table, or select it and press Enter.'
              : 'Glass cup. Drag it back up to the shelf, or select it and press Enter.'
          }
          className={`glass-cup${cupDragPos ? ' dragging' : ''}`}
          data-focusable
          tabIndex={0}
          draggable={false}
          style={{
            left: `${cupRenderPos.left}%`,
            top: `${cupRenderPos.top}%`,
            width: `${cupRenderSize.width}%`,
            height: `${cupRenderSize.height}%`,
          }}
          onPointerDown={handleCupPointerDown}
          onPointerMove={handleCupPointerMove}
          onPointerUp={handleCupPointerUp}
          onKeyDown={handleCupKeyDown}
        />
        {ICE_BOX_SPOTS.map((boxSpot, index) => {
          const placed = icePlaced[index];
          const dragging = iceDrag?.index === index;
          const pos = dragging ? iceDrag : placed ? getIceCupSlotPos(index) : boxSpot;
          const size = placed ? ICE_CUP_SIZE : ICE_BOX_SIZE;
          return (
            <img
              key={index}
              src="./IceCube.png"
              alt={placed ? 'Ice cube in the cup. Drag it back to the ice box, or select it and press Enter.' : 'Ice cube. Drag it into the cup, or select it and press Enter.'}
              className={`ice-cube${dragging ? ' dragging' : ''}${placed ? ' placed' : ''}`}
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
            visually. Only shown while the cup's actually on the table --
            cupMilk itself doesn't get cleared when the cup goes back to the
            shelf, but there'd be nothing sensible to anchor the fill to up
            there (CUP_MILK_BOX_FRAC is only ever computed off
            CUP_SPOTS.table). */}
        {cupMilk && cupSpot === 'table' && (
          <div
            className={`cup-milk-fill ${cupMilk.type}`}
            aria-hidden="true"
            style={{
              left: `${cupMilkBox.left}%`,
              top: `${cupMilkBox.top}%`,
              width: `${cupMilkBox.width}%`,
              height: `${cupMilkBox.height}%`,
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

export default MilkSelection;
