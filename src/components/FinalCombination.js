import React, { useRef } from 'react';
import './FinalCombination.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import ProgressBar from './ProgressBar';
import ScoreCard from './ScoreCard';
import { getMilkBoxFor, getMatchaBoxFor, CUP_TYPES } from './MilkSelection';
import {
  getSyrupBoxFor,
  getFoamBoxFor,
  getFoamCapBoxFor,
  getPowderLiquidBoxFor,
  getFleckPositions,
  POWDER_FLECK_OFFSETS_ELLIPSE,
  POWDER_FLECK_OFFSETS_LIQUID,
} from './ToppingsStation';

// Where the finished drink (see incomingDrink below), carried over from
// ToppingsStation's own "Send to Serving" drop-zone, comes to rest on top
// of the empty plate in Serving.png -- purely decorative here (no drag/
// Enter interaction; there's nothing left to do with the drink once it's
// served).
//
// PLATE_CENTER_X/PLATE_SURFACE_Y are an eyeballed measurement of the plate
// in Serving.png (1394x768 art, see .serving-art in FinalCombination.css):
// the plate's flat serving surface (its top face, above the thicker rim/
// side wall beneath it, not the outer edge of the rim itself) spans
// roughly image x 215-1055, y 505-640. PLATE_CENTER_X is that span's own
// horizontal midpoint (as a % of the image's width, which maps 1:1 to this
// container's own width since object-fit: contain scales this
// wider-than-16:9 image to exactly 100% width -- see .serving-art).
// PLATE_SURFACE_Y is that span's own vertical midpoint, converted from
// %-of-image to %-of-container via the same (16/9)/(1394/768) ratio
// .score-receipt's own comment uses, since the image itself only fills
// ~97.96% of the container's height (object-fit: contain leaves a small
// letterbox at the bottom, anchored there by object-position: top). Very
// likely needs real tuning once actually seen against the live render,
// same caveat as every other eyeballed box in this project.
//
// The actual drink SIZE (and therefore FINAL_DRINK_SPOT, which depends on
// it) can't be a fixed module constant anymore now that Milk Selection has
// two cup types (glass/plastic) of different widths -- see
// finalDrinkSize/finalDrinkSpot in the component below, computed from
// incomingDrink.cupType via the CUP_TYPES map imported from
// MilkSelection.js, same "read the real cup type instead of always
// assuming glass" fix ToppingsStation.js's own incomingCupType/
// incomingDrinkSize got.
const PLATE_CENTER_X = 45.6;
const PLATE_SURFACE_Y_IMAGE_PCT = 74.5;
const IMAGE_TO_CONTAINER_HEIGHT_SCALE = 16 / 9 / (1394 / 768);
const PLATE_SURFACE_Y = PLATE_SURFACE_Y_IMAGE_PCT * IMAGE_TO_CONTAINER_HEIGHT_SCALE;

const FinalCombination = ({
  activeStep,
  customerNumber,
  onNavigate,
  onAdvance,
  incomingDrink,
  // Whether there's actually a next order this session (App.js's own
  // customerNumber < ORDERS_PER_SESSION) -- true for the first two of
  // three orders, false for the last one (which instead returns to the
  // main menu, unchanged). Drives the "Start order N" button below and
  // disables the ProgressBar's own Right-arrow/current-dot "advance"
  // gesture while true, so starting a new round is only ever done through
  // that dedicated button -- see its own comment further down.
  hasNextOrder = false,
  // Per-category score results (see ScoreCard.js and gameloop/scoring.js) --
  // each null until the station that produces it hands it off, same "lifted
  // through App.js state, threaded down as a prop" shape incomingDrink
  // itself already uses.
  orderTakingScore,
  matchaScore,
  mixingScore,
  toppingsScore,
}) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  // ---- Carried-over drink from Toppings Station (see incomingDrink above)
  // Which cup type this actually is -- ToppingsStation's own
  // beginSendToFinal forwards cupType straight through from what Milk
  // Selection originally set, same "read the real type instead of always
  // assuming glass" fix as that screen's own incomingCupType. Defaults to
  // 'glass' if it's ever missing (incomingDrink is null before the
  // player's first order this round).
  const finalCupType = incomingDrink?.cupType ?? 'glass';
  const finalDrinkSize = CUP_TYPES[finalCupType].tableSize;
  // FINAL_DRINK_SPOT.top is backed out from PLATE_SURFACE_Y so the cup's
  // own BOTTOM edge (not its vertical center -- there's a lot of empty
  // glass headroom above the liquid in this art, same as every other
  // screen) lands on the plate's surface, rather than the cup floating
  // with its middle pinned there -- see the big comment on
  // PLATE_CENTER_X/PLATE_SURFACE_Y above. Computed here (rather than as a
  // fixed module constant) since it depends on finalDrinkSize, which
  // varies by cup type.
  const finalDrinkSpot = {
    left: PLATE_CENTER_X - finalDrinkSize.width / 2,
    top: PLATE_SURFACE_Y - finalDrinkSize.height,
  };

  // Same box math ToppingsStation.js uses for its own carried-over cup,
  // just computed against this screen's own fixed finalDrinkSpot/
  // finalDrinkSize instead of that screen's own (draggable)
  // incomingDrinkRenderPos/incomingDrinkSize -- the drink doesn't move
  // once it's arrived here, so there's no render-position state to thread
  // through the way that screen needs for its own drag/carry. incomingDrink
  // shape is whatever ToppingsStation's beginSendToFinal hands off: milk/
  // matcha are the same { type }/{ grade } shapes Milk Selection's own
  // cupMilk/cupMatcha use, foam/syrup/powder are that screen's own cupFoam/
  // cupSyrup/cupPowder shapes ({ key } | null each), and cupType is which
  // cup this all needs to render inside of.
  const incomingMilkBox = incomingDrink?.milk ? getMilkBoxFor(finalDrinkSpot, finalDrinkSize) : null;
  const incomingMatchaBox = incomingDrink?.matcha && incomingMilkBox ? getMatchaBoxFor(incomingMilkBox) : null;
  const incomingSyrupBox = incomingDrink?.syrup && incomingMilkBox ? getSyrupBoxFor(incomingMilkBox) : null;
  const incomingTopBox = incomingMatchaBox || incomingMilkBox;
  const incomingFoamBox = incomingDrink?.foam && incomingTopBox ? getFoamBoxFor(incomingTopBox) : null;
  const incomingFoamCapBox = incomingFoamBox ? getFoamCapBoxFor(incomingFoamBox) : null;
  const incomingPowderLiquidBox =
    incomingDrink?.powder && incomingTopBox && incomingMilkBox
      ? getPowderLiquidBoxFor(incomingTopBox, incomingMilkBox)
      : null;
  // Same "settle on the foam's own top ellipse if there's foam to catch it,
  // otherwise scatter through the whole liquid column instead" choice as
  // ToppingsStation.js's own powderLandingBox/powderFleckOffsets.
  const powderLandingBox =
    incomingDrink?.powder && incomingDrink?.foam && incomingFoamCapBox ? incomingFoamCapBox : incomingPowderLiquidBox;
  const powderFleckOffsets =
    incomingDrink?.foam && incomingFoamCapBox ? POWDER_FLECK_OFFSETS_ELLIPSE : POWDER_FLECK_OFFSETS_LIQUID;
  const powderFleckPositions =
    incomingDrink?.powder && powderLandingBox ? getFleckPositions(powderLandingBox, powderFleckOffsets) : [];

  return (
    <div className="final-combination-container" ref={containerRef}>
      <h1 className="sr-only">Serving</h1>

      <div className="final-combination-content">
        <img
          src="./Serving.png"
          alt="Serving counter with an empty plate, ready to serve the finished drink"
          className="serving-art"
        />

        {/* The finished drink, carried over from Toppings Station and set
            down on the plate -- purely decorative (aria-hidden, no drag/
            Enter interaction, same treatment ToppingsStation's own
            carried-over cup had before that screen's own drink became
            draggable), just displaying the drink exactly as it was built.
            Reuses MilkSelection.css's .cup-milk-fill/.cup-matcha-fill and
            ToppingsStation.css's .cup-foam-fill/.cup-foam-cap/
            .cup-syrup-fill/.cup-powder-fleck classes directly -- all
            already loaded globally, since App.js imports every screen's
            component (and therefore every screen's CSS) up front
            regardless of which page is actually showing, same reasoning
            ToppingsStation.js itself uses for reusing MilkSelection.css's
            classes. */}
        {incomingDrink && (
          <>
            <img
              src={CUP_TYPES[finalCupType].src}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="final-drink-cup"
              style={{
                left: `${finalDrinkSpot.left}%`,
                top: `${finalDrinkSpot.top}%`,
                width: `${finalDrinkSize.width}%`,
                height: `${finalDrinkSize.height}%`,
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
            {incomingDrink.foam && incomingFoamBox && (
              <div
                className={`cup-foam-fill ${incomingDrink.foam.key}`}
                aria-hidden="true"
                style={{
                  left: `${incomingFoamBox.left}%`,
                  top: `${incomingFoamBox.top}%`,
                  width: `${incomingFoamBox.width}%`,
                  height: `${incomingFoamBox.height}%`,
                }}
              />
            )}
            {incomingDrink.foam && incomingFoamCapBox && (
              <div
                className={`cup-foam-cap ${incomingDrink.foam.key}`}
                aria-hidden="true"
                style={{
                  left: `${incomingFoamCapBox.left}%`,
                  top: `${incomingFoamCapBox.top}%`,
                  width: `${incomingFoamCapBox.width}%`,
                  height: `${incomingFoamCapBox.height}%`,
                }}
              />
            )}
            {incomingDrink.syrup && incomingSyrupBox && (
              <div
                className={`cup-syrup-fill ${incomingDrink.syrup.key}`}
                aria-hidden="true"
                style={{
                  left: `${incomingSyrupBox.left}%`,
                  top: `${incomingSyrupBox.top}%`,
                  width: `${incomingSyrupBox.width}%`,
                  height: `${incomingSyrupBox.height}%`,
                }}
              />
            )}
            {incomingDrink.powder &&
              powderFleckPositions.map((pos, index) => (
                <span
                  key={index}
                  className={`cup-powder-fleck ${incomingDrink.powder.key}`}
                  aria-hidden="true"
                  style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                />
              ))}
          </>
        )}

        {/* Replaces the old hardcoded AnnieOrder1.png receipt + per-section
            badge overlay -- see ScoreCard.js's own comment for the
            placeholder this grew out of. Real per-station accuracy now,
            computed as the player actually plays (gameloop/scoring.js) and
            threaded down through App.js the same way incomingDrink is. */}
        <ScoreCard
          customerNumber={customerNumber}
          orderTakingScore={orderTakingScore}
          matchaScore={matchaScore}
          mixingScore={mixingScore}
          toppingsScore={toppingsScore}
        />

        <ProgressBar
          activeStep={activeStep}
          customerNumber={customerNumber}
          onNavigate={onNavigate}
          onAdvance={onAdvance}
          disableAdvance={hasNextOrder}
        />

        {/* Starting the next order used to happen via this same
            ProgressBar (Right-arrow or clicking the current/Serve dot,
            same "I'm done here" gesture every other station's own advance
            uses) -- per request, that's now this dedicated button instead
            (disableAdvance above turns the bar's own version of it off
            while this is showing), since jumping into a whole new round
            through the exact same widget the player was just blocked from
            stepping backward through read as confusing. onAdvance itself
            is unchanged -- App.js's handleAdvance already does everything
            needed (resets the order/bowl/drink state, bumps
            customerNumber, sends the player back to 'ordering'); this
            button just calls the very same handler from a clearer,
            explicit spot instead of through the bar. Only rendered when
            there's actually a next order (hasNextOrder) -- the final
            (3rd) order's own completion still returns to the main menu
            via the bar as before. */}
        {hasNextOrder && (
          <button
            type="button"
            className="start-next-order-button"
            data-focusable
            tabIndex={0}
            onClick={onAdvance}
          >
            Start order {customerNumber + 1}
          </button>
        )}
      </div>
    </div>
  );
};

export default FinalCombination;
