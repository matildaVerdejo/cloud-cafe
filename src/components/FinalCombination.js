import React, { useRef } from 'react';
import './FinalCombination.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import ProgressBar from './ProgressBar';

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

const FinalCombination = ({ activeStep, customerNumber, onNavigate, onAdvance }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  return (
    <div className="final-combination-container" ref={containerRef}>
      <h1 className="sr-only">Serving</h1>

      <div className="final-combination-content">
        <img
          src="./Serving.png"
          alt="Serving counter with an empty plate, ready to serve the finished drink"
          className="serving-art"
        />

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
