import React, { useEffect, useState } from 'react';
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

// How long each row's own count-up/fill-in animation takes to settle on its
// final value, once it actually starts (see REVEAL_STAGGER_MS below for the
// delay between one row starting and the next). Slower than the original
// pass (900ms) and eased in-out rather than out-only -- ease-out alone
// reaches ~88% of the target by the halfway point, which read as an
// almost-instant jump followed by barely-visible creeping rather than a
// number that visibly counts upward; ease-in-out keeps the growth
// perceptible all the way through instead of front-loading it.
const REVEAL_DURATION_MS = 2400;

// Gap between one row starting its own reveal and the next one starting --
// per request, the four sections (and the total after them) should reveal
// one at a time rather than all counting up together. Rows that haven't
// started yet sit dimmed (see .score-card-row-wrap.pending in ScoreCard.css)
// so it's clear more are still coming.
const REVEAL_STAGGER_MS = 750;

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// Counts up from 0 to `target` over `duration`ms, starting only after
// `delay`ms have passed -- the delay is what lets ScoreCard below stagger
// each row (and the total) into a one-at-a-time reveal instead of every
// number counting up in unison. Returns both the live animated value and
// whether this instance has actually started yet, so the caller can dim
// anything still waiting its turn (see ScoreCardRow's own `started` use).
// Re-runs whenever target/delay change, which in practice only ever happens
// once per row -- every score is already final by the time ScoreCard ever
// mounts (see gameloop/scoring.js's own big comment for why), so this is
// purely a one-shot reveal effect, not a live-updating counter.
function useCountUp(target, { duration = REVEAL_DURATION_MS, delay = 0 } = {}) {
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (typeof target !== 'number') {
      setValue(0);
      setStarted(false);
      return undefined;
    }
    let rafId;
    const beginAnimating = () => {
      setStarted(true);
      const startTime = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        setValue(Math.round(target * easeInOutQuad(t)));
        if (t < 1) rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    };
    const timeoutId = setTimeout(beginAnimating, delay);
    return () => {
      clearTimeout(timeoutId);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [target, duration, delay]);
  return { value, started };
}

// One category row -- pulled out of the main .map() below so useCountUp (a
// real hook) gets its own component instance to attach to, one per row,
// instead of being called in a loop inside ScoreCard itself (which the
// rules of hooks don't allow). Owns its own staggered reveal animation: the
// percent text counts up from 0 once its own delay elapses, and a
// light-green fill bar grows from the left edge in lockstep (same animated
// value driving both, see score-card-row-fill below), like a thermometer
// settling on its reading -- dimmed (.pending, see ScoreCard.css) until
// then so it's visually clear it hasn't been revealed yet. Detail-list
// open/close state stays lifted in the parent (openKey/toggle) since only
// one row's detail list can ever be open at a time.
function ScoreCardRow({ cat, result, delay, isOpen, onToggle }) {
  const targetPercent = result ? result.percent : 0;
  const { value: animatedPercent, started } = useCountUp(targetPercent, { delay });
  return (
    <div className={`score-card-row-wrap${started ? '' : ' pending'}`}>
      <button
        type="button"
        className={`score-card-row${isOpen ? ' open' : ''}`}
        data-focusable
        aria-expanded={isOpen}
        disabled={!result}
        onClick={onToggle}
      >
        {/* Purely decorative -- the row's own percent text (below) already
            carries the same number for screen readers, this is just the
            visual "thermometer" layer sitting behind it. */}
        <span className="score-card-row-fill" aria-hidden="true" style={{ width: `${animatedPercent}%` }} />
        <span className="score-card-row-label">{cat.label}</span>
        <span className="score-card-row-percent">{result ? `${animatedPercent}%` : '—'}</span>
      </button>
      {isOpen && (
        <ul className="score-card-detail-list">
          {result.checks.map((check) => (
            <li key={check.key} className={`score-card-detail-item ${check.correct ? 'correct' : 'incorrect'}`}>
              <span className="score-card-detail-icon" aria-hidden="true">
                {check.correct ? '✓' : '✗'}
              </span>
              <span className="score-card-detail-text">
                <span className="score-card-detail-label">
                  {check.label}
                  {check.correct ? '' : ':'}
                </span>
                {/* Correct checks are just the label + green check -- no
                    detail sentence, per request: a right answer doesn't
                    need explaining, only a wrong one does (see
                    gameloop/scoring.js for how each check's own `detail`
                    string is built). */}
                {!check.correct && ` ${check.detail}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ScoreCard = ({ customerNumber, characterName, orderTakingScore, matchaScore, mixingScore, toppingsScore }) => {
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
  // Starts only once every row above it has finished its own staggered
  // reveal (CATEGORIES.length full row slots' worth of delay), so the total
  // reads as the last domino in the same one-at-a-time sequence rather than
  // counting up alongside the rows.
  const { value: animatedTotal } = useCountUp(total, { delay: CATEGORIES.length * REVEAL_STAGGER_MS });
  // Grades the total itself into one of three tiers -- failing (<60),
  // middling (60-79), good (80+) -- same "common letter-grade-ish cutoffs"
  // reasoning most percent-based grading uses, since nothing in this project
  // defines an official passing threshold. Colors the score-card-total pill
  // accordingly (see .score-card-total--fail/--mid/--good in ScoreCard.css)
  // -- still the same pastel palette the rest of this card uses, just a
  // reddish/yellowish/greenish tint depending on the tier, instead of always
  // the same green/brown regardless of how the round actually went. null
  // (nothing scored yet) intentionally gets no tier -- see the plain
  // '#8a7a6a'-bordered default rule in the CSS for that case.
  const scoreTier = total === null ? null : total < 60 ? 'fail' : total < 80 ? 'mid' : 'good';

  // Zero-padded "0N/03" badge -- replaces the old plain-gray "Order N of 3"
  // line per request, moved into the card's own upper-right corner instead
  // of sitting as its own line above the title. ORDERS_PER_SESSION isn't
  // threaded down this far (App.js keeps it a local constant), so "03" is
  // hardcoded the same way ProgressBar.js's own copy already is.
  const orderBadge = customerNumber != null ? `0${customerNumber}/03` : null;

  return (
    <div className="score-card">
      {orderBadge && <p className="score-card-order-badge">{orderBadge}</p>}
      {/* "<Name>'s order" instead of the old generic "Order Score" -- names
          whichever of the three customer characters (see
          CUSTOMER_CHARACTER_NAME in FinalCombination.js) this round's order
          actually belonged to. Falls back to the old generic wording if
          characterName somehow isn't available (e.g. an order placed before
          this field existed, or genuinely missing state) rather than
          rendering "null's order". */}
      <h2 className="score-card-title">{characterName ? `${characterName}'s order` : 'Order Score'}</h2>
      <div className="score-card-rows">
        {CATEGORIES.map((cat, index) => (
          <ScoreCardRow
            key={cat.key}
            cat={cat}
            result={scoresByKey[cat.key]}
            delay={index * REVEAL_STAGGER_MS}
            isOpen={openKey === cat.key && !!scoresByKey[cat.key]}
            onToggle={() => toggle(cat.key)}
          />
        ))}
      </div>
      <div className={`score-card-total${scoreTier ? ` score-card-total--${scoreTier}` : ''}`}>
        Score: {total !== null ? `${animatedTotal}/100` : '—'}
      </div>
    </div>
  );
};

export default ScoreCard;
