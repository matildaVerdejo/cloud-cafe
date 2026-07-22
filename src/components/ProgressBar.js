import React from 'react';
import './ProgressBar.css';

// Single source of truth for step order/labels -- App.js imports this same
// list (as STEP_KEYS) for its own navigation logic, so the bar and the
// state machine can never drift out of sync.
export const PROGRESS_STEPS = [
  { key: 'ordering', label: 'Order' },
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
// the main menu after the 3rd).
const ProgressBar = ({ activeStep, customerNumber, onNavigate, onAdvance }) => {
  const activeIndex = PROGRESS_STEPS.findIndex((step) => step.key === activeStep);

  return (
    <div className="progress-bar">
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
              type="button"
              className={`progress-step${isCurrent ? ' current' : ''}${isDone ? ' done' : ''}`}
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
  );
};

export default ProgressBar;
