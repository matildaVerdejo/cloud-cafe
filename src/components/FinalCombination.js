import React, { useRef } from 'react';
import './FinalCombination.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import ProgressBar from './ProgressBar';
import { getMilkBoxFor, getMatchaBoxFor, TABLE_SIZE } from './MilkSelection';
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
// served). Same size it displayed at over there (TABLE_SIZE, imported
// directly rather than guessing a scaled-down copy -- same "reuse the
// exact same size" reasoning ToppingsStation.js itself uses for its own
// carried-over cup).
//
// FINAL_DRINK_SPOT is an eyeballed measurement of the plate in Serving.png
// (1394x768 art, see .serving-art in FinalCombination.css): the plate's
// flat serving surface (its top face, above the thicker rim/side wall
// beneath it, not the outer edge of the rim itself) spans roughly image
// x 215-1055, y 505-640. PLATE_CENTER_X is that span's own horizontal
// midpoint (as a % of the image's width, which maps 1:1 to this container's
// own width since object-fit: contain scales this wider-than-16:9 image to
// exactly 100% width -- see .serving-art). PLATE_SURFACE_Y is that span's
// own vertical midpoint, converted from %-of-image to %-of-container via
// the same (16/9)/(1394/768) ratio .score-receipt's own comment uses,
// since the image itself only fills ~97.96% of the container's height
// (object-fit: contain leaves a small letterbox at the bottom, anchored
// there by object-position: top). FINAL_DRINK_SPOT.top is then backed out
// from PLATE_SURFACE_Y so the cup's own BOTTOM edge (not its vertical
// center -- there's a lot of empty glass headroom above the liquid in this
// art, same as every other screen) lands on the plate's surface, rather
// than the cup floating with its middle pinned there. Very likely needs
// real tuning once actually seen against the live render, same caveat as
// every other eyeballed box in this project.
const FINAL_DRINK_SIZE = TABLE_SIZE;
const PLATE_CENTER_X = 45.6;
const PLATE_SURFACE_Y_IMAGE_PCT = 74.5;
const IMAGE_TO_CONTAINER_HEIGHT_SCALE = 16 / 9 / (1394 / 768);
const PLATE_SURFACE_Y = PLATE_SURFACE_Y_IMAGE_PCT * IMAGE_TO_CONTAINER_HEIGHT_SCALE;
const FINAL_DRINK_SPOT = {
  left: PLATE_CENTER_X - FINAL_DRINK_SIZE.width / 2,
  top: PLATE_SURFACE_Y - FINAL_DRINK_SIZE.height,
};

// Per-section score for the completed order, shown as a "+N" badge over
// each of the 6 cells on the receipt image (matcha / cup / ice / milk /
// mint syrup / mint leaf), plus a total out of 100 underneath.
//
// PLACEHOLDER SCORING: only Milk Selection currently tracks real player
// choices (cup placement, ice count) -- Matcha Making and Toppings are
// still static/decorative and there's no milk-type picker yet, so there's
// no real accuracy data to grade most sections against. Every section is
// full marks for now. `points` is the max for that section (weighted so
// the two flavor-defining choices, matcha amount and milk type, are worth
// a bit more than the presentation/garnish sections); `earned` is what the
// player actually scored -- swap that to real per-station results once
// those stations track player choices. The UI already reads earned/points
// per section plus the summed total, so nothing here will need to change
// shape when that happens, only the `earned` values.
//
// top/right are % positions of each badge within .score-receipt, anchored
// to the top-right corner of that section's cell on the 836x1089 order
// image (see AnnieOrder1.png) with a small inset margin.
const SCORE_SECTIONS = [
  { key: 'matcha', label: 'Matcha', points: 20, earned: 20, top: 20.82, right: 8.82 },
  { key: 'cup', label: 'Cup', points: 15, earned: 15, top: 40.48, right: 53.79 },
  { key: 'ice', label: 'Ice', points: 15, earned: 15, top: 40.48, right: 8.82 },
  { key: 'milk', label: 'Milk', points: 20, earned: 20, top: 60.4, right: 8.82 },
  { key: 'mint-syrup', label: 'Mint syrup', points: 15, earned: 15, top: 79.96, right: 53.67 },
  { key: 'mint-leaf', label: 'Mint leaf', points: 15, earned: 15, top: 79.96, right: 8.82 },
];

const TOTAL_POSSIBLE = SCORE_SECTIONS.reduce((sum, section) => sum + section.points, 0);
const totalEarned = SCORE_SECTIONS.reduce((sum, section) => sum + section.earned, 0);

const FinalCombination = ({ activeStep, customerNumber, onNavigate, onAdvance, incomingDrink }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  // ---- Carried-over drink from Toppings Station (see incomingDrink above)
  // Same box math that screen uses for its own carried-over cup, just
  // computed against this screen's own fixed FINAL_DRINK_SPOT/
  // FINAL_DRINK_SIZE instead of ToppingsStation's own (draggable)
  // incomingDrinkRenderPos/INCOMING_DRINK_SIZE -- the drink doesn't move
  // once it's arrived here, so there's no render-position state to thread
  // through the way that screen needs for its own drag/carry. incomingDrink
  // shape is whatever ToppingsStation's beginSendToFinal hands off: milk/
  // matcha are the same { type }/{ grade } shapes Milk Selection's own
  // cupMilk/cupMatcha use, foam/syrup/powder are that screen's own cupFoam/
  // cupSyrup/cupPowder shapes ({ key } | null each).
  const incomingMilkBox = incomingDrink?.milk ? getMilkBoxFor(FINAL_DRINK_SPOT, FINAL_DRINK_SIZE) : null;
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
              src="./GlassCup.png"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="final-drink-cup"
              style={{
                left: `${FINAL_DRINK_SPOT.left}%`,
                top: `${FINAL_DRINK_SPOT.top}%`,
                width: `${FINAL_DRINK_SIZE.width}%`,
                height: `${FINAL_DRINK_SIZE.height}%`,
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

        {/* Positioned over the blank hanging receipt paper in the art. The
            box is sized to the order image's own aspect ratio (836:1089) so
            object-fit: contain renders it with no letterboxing -- that's
            what lets the score badges below use the same top/right
            percentage coordinate space as the receipt image itself. */}
        <div className="score-receipt">
          <img
            src="./AnnieOrder1.png"
            alt="Completed order receipt with per-section score"
            className="score-receipt-img"
          />
          {SCORE_SECTIONS.map((section) => (
            <span
              key={section.key}
              className="score-badge"
              style={{ top: `${section.top}%`, right: `${section.right}%` }}
            >
              +{section.earned}
            </span>
          ))}
        </div>

        <div className="score-total">
          Total: {totalEarned}/{TOTAL_POSSIBLE}
        </div>

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

export default FinalCombination;
