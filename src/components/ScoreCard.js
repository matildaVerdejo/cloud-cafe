import React, { useEffect, useState } from 'react';
import './ScoreCard.css';
import { computeOverallScore } from '../gameloop/scoring';
import { ORDERS_PER_SESSION } from './ProgressBar';
import { playButtonClick, playButtonClickOff } from '../gameloop/sfx';

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
  { key: 'order-taking', label: 'order taking' },
  { key: 'matcha-making', label: 'matcha making' },
  { key: 'mixing-drink', label: 'mixing drink' },
  { key: 'toppings', label: 'toppings' },
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

// The moment the total pill itself finishes counting up -- exported so
// FinalCombination.js can time its own celebration overlay (see
// CelebrationOverlay.js) to appear right as the reveal actually finishes,
// instead of guessing at a hardcoded delay that could drift out of sync
// with these two constants above. Mirrors the exact delay/duration math the
// total's own useCountUp call below uses.
export const SCORE_REVEAL_TOTAL_MS = CATEGORIES.length * REVEAL_STAGGER_MS + REVEAL_DURATION_MS;

// How long the total pill's own background/border/color transition (see
// .score-card-total's own `transition` in ScoreCard.css) takes to settle
// once its tier color actually switches on. Exported alongside
// SCORE_COLOR_REVEAL_MS/STICKER_REVEAL_DELAY_MS below so FinalCombination.js
// can time the reaction sticker's own slam-in to happen only once the color
// change has visibly finished, not mid-transition.
const SCORE_COLOR_TRANSITION_MS = 300;

// The moment the total pill switches from its neutral default look to its
// actual tier color (fail/mid/good) -- see the colorRevealed state below.
// Deliberately the same instant the total finishes counting up
// (SCORE_REVEAL_TOTAL_MS) rather than colored from the very start, so
// "the score section changes color" reads as a real, noticeable beat in
// the reveal sequence instead of something that was already true the whole
// time the numbers were still counting up.
export const SCORE_COLOR_REVEAL_MS = SCORE_REVEAL_TOTAL_MS;

// When FinalCombination.js should let the reaction sticker slam onto the
// screen -- after the total pill's color has actually finished changing
// (SCORE_COLOR_REVEAL_MS + the transition's own duration), plus a small
// beat so the two feel like separate, sequential events rather than
// happening in the same instant.
export const STICKER_REVEAL_DELAY_MS = SCORE_COLOR_REVEAL_MS + SCORE_COLOR_TRANSITION_MS + 200;

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

const ScoreCard = ({
  customerNumber,
  characterName,
  orderTakingScore,
  matchaScore,
  mixingScore,
  toppingsScore,
  // Optional, opt-in -- only ever passed by FinalCombination.js's own
  // first-order-only walkthrough (see hasOpenedScoreSection there), fired
  // the first time (and every time) a row actually opens. Lets that screen
  // know the player has found their way into a section without this
  // component needing to know anything about walkthroughs itself -- same
  // "child fires a plain callback, parent owns the tutorial state" shape
  // OrderReceiptButton.js's own onToggle already uses.
  onSectionOpen,
  // Optional, opt-in -- also only ever passed by FinalCombination.js's own
  // walkthrough. This card doesn't otherwise take a className prop (nothing
  // else has ever needed to reach into its own root div from outside), so
  // these are two dedicated booleans instead: exempt punches the card
  // through the per-screen pink tint (see .score-card.final-spotlight-
  // exempt in ScoreCard.css), highlight makes it flash white during the
  // walkthrough's own first beat (see .score-card.score-card-highlight
  // there too). Both default to false so every other, non-walkthrough
  // render of this card (orders 2+) is completely unaffected.
  exempt = false,
  highlight = false,
}) => {
  const scoresByKey = {
    'order-taking': orderTakingScore,
    'matcha-making': matchaScore,
    'mixing-drink': mixingScore,
    toppings: toppingsScore,
  };

  // Only one category's detail list open at a time -- same pattern as
  // CustomerOrdering's own openControl for its five order-form dropdowns.
  const [openKey, setOpenKey] = useState(null);
  // Plays the "on" click when a section is opening (including switching
  // straight from one open row to another), the "off" click when the
  // already-open row is being closed -- same "read the *current* state
  // before flipping it, not from inside the setState updater" pattern
  // OrderReceiptButton.js's own handleClick uses, for the same reason:
  // React 18 StrictMode's dev-only double-invoke of updater functions would
  // double-play whichever clip fired if the sound lived inside the
  // setOpenKey callback instead.
  const toggle = (key) => {
    if (openKey === key) {
      playButtonClickOff();
    } else {
      playButtonClick();
      // Only fired on an actual OPEN (not the close branch above) -- per
      // request, FinalCombination's own second walkthrough beat should
      // start once the player has "clicked to see" a section, not merely
      // interacted with the card at all.
      onSectionOpen?.();
    }
    setOpenKey((prev) => (prev === key ? null : key));
  };

  // Total/tier both come from the shared computeOverallScore helper (see
  // gameloop/scoring.js) rather than being recomputed inline here -- that's
  // the exact same average FinalCombination.js's own celebration-overlay
  // check uses (see CATEGORIES.length * REVEAL_STAGGER_MS above), so the
  // two can never drift out of sync with each other. Colors the
  // score-card-total pill by tier (see .score-card-total--fail/--mid/--good
  // in ScoreCard.css) -- still the same pastel palette the rest of this
  // card uses, just a reddish/yellowish/greenish tint depending on how the
  // round actually went, instead of always the same green/brown. null
  // (nothing scored yet) intentionally gets no tier -- see the plain
  // '#8a7a6a'-bordered default rule in the CSS for that case.
  const { total, tier: scoreTier } = computeOverallScore({
    orderTakingScore,
    matchaScore,
    mixingScore,
    toppingsScore,
  });
  // Starts only once every row above it has finished its own staggered
  // reveal (CATEGORIES.length full row slots' worth of delay), so the total
  // reads as the last domino in the same one-at-a-time sequence rather than
  // counting up alongside the rows.
  const { value: animatedTotal } = useCountUp(total, { delay: CATEGORIES.length * REVEAL_STAGGER_MS });
  // The total pill's tier color only actually switches on at
  // SCORE_COLOR_REVEAL_MS (see that constant's own comment above) -- before
  // then it sits in its plain neutral default look (no --fail/--mid/--good
  // class), same as while nothing's scored yet. Lets .score-card-total's
  // own CSS transition carry the color change as a real, visible beat
  // instead of it just being true from the very first paint.
  const [colorRevealed, setColorRevealed] = useState(false);
  useEffect(() => {
    setColorRevealed(false);
    if (!scoreTier) return undefined;
    const timeoutId = setTimeout(() => setColorRevealed(true), SCORE_COLOR_REVEAL_MS);
    return () => clearTimeout(timeoutId);
  }, [scoreTier]);

  // Zero-padded "0N/0M" badge -- replaces the old plain-gray "Order N of M"
  // line per request, moved into the card's own upper-right corner instead
  // of sitting as its own line above the title. ORDERS_PER_SESSION now comes
  // from ProgressBar.js (see that file's own comment) rather than being
  // hardcoded here, so this can't drift from the bar's own "Order N of M"
  // text or App.js's session-length logic.
  const orderBadge = customerNumber != null ? `0${customerNumber}/0${ORDERS_PER_SESSION}` : null;

  return (
    <div className={`score-card${exempt ? ' final-spotlight-exempt' : ''}${highlight ? ' score-card-highlight' : ''}`}>
      {orderBadge && <p className="score-card-order-badge">{orderBadge}</p>}
      {/* "<Name>'s order" instead of the old generic "Order Score" -- names
          whichever of the three customer characters (see
          CUSTOMER_CHARACTER_NAME in FinalCombination.js) this round's order
          actually belonged to. Falls back to the old generic wording if
          characterName somehow isn't available (e.g. an order placed before
          this field existed, or genuinely missing state) rather than
          rendering "null's order". */}
      <h2 className="score-card-title">{characterName ? `${characterName}'s order` : 'order score'}</h2>
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
      <div className={`score-card-total${colorRevealed && scoreTier ? ` score-card-total--${scoreTier}` : ''}`}>
        score: {total !== null ? `${animatedTotal}/100` : '—'}
      </div>
    </div>
  );
};

export default ScoreCard;
