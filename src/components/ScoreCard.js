import React, { useState } from 'react';
import './ScoreCard.css';

// Replaces the old hardcoded AnnieOrder1.png receipt + per-section badge
// overlay on FinalCombination -- see that file's own removed SCORE_SECTIONS
// comment for the placeholder this grew out of. Every section there was
// always full marks (there was no real per-station accuracy data yet); the
// four sections below are the real thing, computed station-by-station as
// the player actually plays (see gameloop/scoring.js's own big comment for
// where/when each one is captured) and threaded down here as props.
//
// Surface reads just like the old receipt did -- one row per category, its
// own percent -- but each row is now a real button: Enter/click toggles a
// detail list open directly beneath it (same single-thing-open-at-a-time
// drawer idea CustomerOrdering.js's own order-form dropdowns and
// OrderReceiptButton.js's own drawer already use), showing exactly what was
// asked for vs. what actually happened for every check in that category.
const CATEGORIES = [
  { key: 'order-taking', label: 'Order Taking' },
  { key: 'matcha-making', label: 'Matcha Making' },
  { key: 'mixing-drink', label: 'Mixing Drink' },
  { key: 'toppings', label: 'Toppings' },
];

const ScoreCard = ({ orderTakingScore, matchaScore, mixingScore, toppingsScore }) => {
  const scoresByKey = {
    'order-taking': orderTakingScore,
    'matcha-making': matchaScore,
    'mixing-drink': mixingScore,
    toppings: toppingsScore,
  };

  // Only one category's detail list open at a time -- same pattern as
  // CustomerOrdering's own openControl for its five order-form dropdowns.
  const [openKey, setOpenKey] = useState(null);
  const toggle = (key) => setOpenKey((prev) => (prev === key ? null : key));

  // Total is the plain average of whichever categories are actually scored
  // yet -- every one of them should be, by the time this screen is ever
  // reached (each is captured at the station that produces it, well before
  // Serving), but this stays defensive rather than assuming all four are
  // non-null, the same "don't assume, read the real state" caution the rest
  // of this codebase already takes with e.g. incomingDrink.
  const scoredPercents = CATEGORIES.map((cat) => scoresByKey[cat.key]?.percent).filter(
    (p) => typeof p === 'number'
  );
  const total =
    scoredPercents.length > 0
      ? Math.round(scoredPercents.reduce((sum, p) => sum + p, 0) / scoredPercents.length)
      : null;

  return (
    <div className="score-card">
      <h2 className="score-card-title">Order Score</h2>
      <div className="score-card-rows">
        {CATEGORIES.map((cat) => {
          const result = scoresByKey[cat.key];
          const isOpen = openKey === cat.key && !!result;
          return (
            <div key={cat.key} className="score-card-row-wrap">
              <button
                type="button"
                className={`score-card-row${isOpen ? ' open' : ''}`}
                data-focusable
                aria-expanded={isOpen}
                disabled={!result}
                onClick={() => toggle(cat.key)}
              >
                <span className="score-card-row-label">{cat.label}</span>
                <span className="score-card-row-percent">{result ? `${result.percent}%` : '—'}</span>
              </button>
              {isOpen && (
                <ul className="score-card-detail-list">
                  {result.checks.map((check) => (
                    <li
                      key={check.key}
                      className={`score-card-detail-item ${check.correct ? 'correct' : 'incorrect'}`}
                    >
                      <span className="score-card-detail-icon" aria-hidden="true">
                        {check.correct ? '✓' : '✗'}
                      </span>
                      <span className="score-card-detail-text">
                        <span className="score-card-detail-label">{check.label}:</span> {check.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <div className="score-card-total">Total: {total !== null ? `${total}/100` : '—'}</div>
    </div>
  );
};

export default ScoreCard;
