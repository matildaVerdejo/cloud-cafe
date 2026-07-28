import React, { useEffect, useRef } from 'react';
import './ProgressBar.css';
import { getActionFromKeyEvent } from '../gameloop/pal';

// Single source of truth for step order/labels -- App.js imports this same
// list (as STEP_KEYS) for its own navigation logic, so the bar and the
// state machine can never drift out of sync.
export const PROGRESS_STEPS = [
  { key: 'ordering', label: 'Take Order' },
  { key: 'matcha-making', label: 'Matcha' },
  { key: 'milk-selection', label: 'Milk' },
  { key: 'toppings', label: 'Toppings' },
  { key: 'final-combination', label: 'Serve' },
];

// Replaces the old per-screen Back/forward buttons. Sits bottom-center on
// every screen except Main. Steps before the current one are shown done
// (checkmark); clicking any of those, or any step ahead, jumps straight
// there via onNavigate. Clicking the CURRENT step is the "I'm done here"
// action -- it calls onAdvance, which moves to the next step (or, from the
// last step, completes the order and starts the next customer / returns to
// the main menu after the 3rd). Once focus is on the bar, Left/Right do the
// same two things directly (see the effect below) -- no need to arrow over
// to a specific dot and press Enter first.
const ProgressBar = ({
  activeStep,
  customerNumber,
  onNavigate,
  onAdvance,
  // Optional fourth-beat highlight, opt-in per screen (currently only
  // CustomerOrdering passes these, right after an order is placed --
  // every other screen leaves both undefined/falsy and gets the exact
  // same bar as before). When on, the current step's own dot flashes (see
  // .progress-step.station-highlight in ProgressBar.css) and, if
  // currentStepHint is given, a label pops in above the bar.
  highlightCurrentStep = false,
  currentStepHint = null,
}) => {
  const activeIndex = PROGRESS_STEPS.findIndex((step) => step.key === activeStep);
  const barRef = useRef(null);
  const currentStepRef = useRef(null);

  // Left/Right now jump straight between frames once focus is already
  // somewhere on this bar (any step's circle) -- replaces the old
  // "arrow-focus the circle, then press Enter" two-step with one press.
  // Scoped to the bar itself (barRef.contains(document.activeElement)) so
  // every other screen's own Left/Right spatial navigation (Grade vs
  // Teaspoon dropdown, Cup vs Ice, etc, via useFlatFocusNav) is completely
  // unaffected -- this only ever fires once focus has actually landed on
  // one of these dots, same as before.
  //
  // Right reuses onAdvance (not onNavigate) even for the non-last steps,
  // since the two are functionally identical there anyway (both just move
  // to the next STEP_KEYS entry -- see handleAdvance in App.js) and
  // onAdvance is the one that also handles session completion once you're
  // on the last step (Serve). Left calls onNavigate to the previous step
  // directly -- there's no "un-advance" side effect to run going backward,
  // same as clicking an earlier dot today. Neither wraps: Left does
  // nothing at the first step; Right at the last step still completes the
  // order via onAdvance, exactly like clicking the Serve dot already did.
  //
  // stopImmediatePropagation matters here: this effect (a child of
  // whichever screen renders <ProgressBar>) mounts and attaches its
  // window listener before that screen's own useFlatFocusNav effect does
  // (React commits child effects before parent effects), so this handler
  // always runs first for a given keydown and can stop useFlatFocusNav
  // from also nudging focus around for the same Left/Right press.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Left' && action !== 'Right') return;
      const bar = barRef.current;
      if (!bar || !bar.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (action === 'Right') {
        onAdvance();
      } else if (activeIndex > 0) {
        onNavigate(PROGRESS_STEPS[activeIndex - 1].key);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, onAdvance, onNavigate]);

  // Moves focus onto the current step's dot the moment highlightCurrentStep
  // turns on -- same "the highlighted thing becomes the next thing
  // selected" idea as .order-place-button's autoFocus in CustomerOrdering.js,
  // and it's what actually makes the accompanying hint's "use your right
  // arrow key" instructions work immediately (the Left/Right handler above
  // only fires once focus is already somewhere on this bar). Keyed on
  // highlightCurrentStep specifically (not e.g. activeIndex) so this only
  // steals focus on the rising edge, not on every re-render while it's on.
  useEffect(() => {
    if (highlightCurrentStep) {
      currentStepRef.current?.focus();
    }
  }, [highlightCurrentStep]);

  return (
    <div className="progress-bar-wrap">
      {highlightCurrentStep && currentStepHint && <p className="progress-station-hint">{currentStepHint}</p>}
      <div className="progress-bar" ref={barRef}>
        <span className="progress-order-count">
          Order {customerNumber} of 3
        </span>
        <div className="progress-steps">
          {/* Connector track behind the dots: fills green from the first dot
              up to wherever the customer currently is, so at a glance you can
              see how much of the order is done without reading each dot.
              Inset by the dot radius on each side in CSS so it starts/ends at
              the outer dots' centers rather than the row's outer edge. */}
          <div
            className="progress-track"
            style={{
              '--progress-fill': `${(activeIndex / (PROGRESS_STEPS.length - 1)) * 100}%`,
            }}
          />
          {PROGRESS_STEPS.map((step, index) => {
            const isCurrent = index === activeIndex;
            const isDone = index < activeIndex;
            return (
              <button
                key={step.key}
                ref={isCurrent ? currentStepRef : undefined}
                type="button"
                className={`progress-step${isCurrent ? ' current' : ''}${isDone ? ' done' : ''}${
                  highlightCurrentStep && isCurrent ? ' station-highlight' : ''
                }`}
                data-focusable
                autoFocus={isCurrent}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => (isCurrent ? onAdvance() : onNavigate(step.key))}
              >
                <span className="progress-step-dot">{isDone ? '✓' : index + 1}</span>
                <span className="progress-step-label">{step.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ProgressBar;
