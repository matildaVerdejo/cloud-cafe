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

  // Only needs an actual drink to pour onto and nothing else already
  // mid-pour -- unlike Milk Selection's own bottles/bowl there's no ice/
  // base precondition here, since the drink arriving from that screen is
  // already whatever it's going to be by the time it gets here.
  const canPourSyrup = !!incomingDrink && pourStage === 'idle';

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

  return (
    <div className="toppings-container" ref={containerRef}>
      <h1 className="sr-only">Toppings Station</h1>

      <div className="toppings-content">
        <img src={TOPPINGS_BACKGROUND_SRC} alt="Toppings station counter" className="toppings-art" />
        {/* Selectable (D-pad/click-focusable, same white shape-hugging glow
            as MatchaMaking's matcha tins -- see .station-item.selectable in
            ToppingsStation.css) but not draggable and no selection
            behavior wired up yet -- this is purely the "place them on the
            counter" step requested; picking one still just moves focus/
            the glow around for now. Excludes guava-syrup/mint-syrup, which
            get their own fully interactive render below instead. */}
        {TOPPING_ITEMS.filter((item) => item.key !== 'guava-syrup' && item.key !== 'mint-syrup').map((item) => (
          <img
            key={item.key}
            src={item.src}
            alt={item.alt}
            className="station-item selectable"
            data-focusable
            tabIndex={0}
            draggable={false}
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              width: `${item.width}%`,
              height: `${item.height}%`,
            }}
          />
        ))}
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
