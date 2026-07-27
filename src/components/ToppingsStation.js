import React, { useRef } from 'react';
import './ToppingsStation.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import ProgressBar from './ProgressBar';
import OrderReceiptButton from './OrderReceiptButton';

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
const TOPPING_ROW_BOTTOM = 64; // the powder pair's bottom edge lands here, "on the table"
const EDGE_MARGIN = 5; // gap from the left/right edges of the frame
// The powder pair sits VERY close together internally -- much tighter than
// PAIR_GAP. FOAM_PAIR's spacing was already confirmed good, so it keeps
// the wider PAIR_GAP.
const TIGHT_PAIR_GAP = 0.15;
// The syrup pair needs to be even closer together than TIGHT_PAIR_GAP, per
// request.
const SYRUP_PAIR_GAP = 0.05;
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

const ToppingsStation = ({ activeStep, customerNumber, onNavigate, onAdvance }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

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
            the glow around for now. */}
        {TOPPING_ITEMS.map((item) => (
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
        <OrderReceiptButton />
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
