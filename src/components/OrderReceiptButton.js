import React, { useEffect, useRef, useState } from 'react';
import './OrderReceiptButton.css';
import { playButtonClick, playButtonClickOff } from '../gameloop/sfx';

// Label lookups for the raw values CustomerOrdering.js stores in its order
// object (see the option lists at the top of that file) -- kept as small
// standalone maps here rather than importing CustomerOrdering's arrays so
// this component doesn't depend on another screen's internals for a handful
// of fixed strings.
const GRADE_LABELS = { cafe: 'Cafe', classic: 'Classic', ceremonial: 'Ceremonial' };
const CUP_LABELS = { glass: 'Glass', mug: 'Mug', plastic: 'Plastic' };
const BASE_LABELS = {
  dairy: 'Dairy milk',
  oat: 'Oat milk',
  almond: 'Almond milk',
  coconut: 'Coconut water',
};
const TOPPING_LABELS = {
  'guava-syrup': 'Guava syrup',
  'mint-syrup': 'Mint syrup',
  'reg-foam': 'Reg cold foam',
  'matcha-foam': 'Matcha cold foam',
  'guava-powder': 'Guava powder',
  'matcha-powder': 'Matcha powder',
  'mint-leaves': 'Mint leaves',
};

// Lets the player peek at the current order without leaving whichever
// station they're on. Sits top-right on the three "working" screens
// (Matcha Making, Milk Selection, Toppings) -- Customer Ordering doesn't
// need it since that's where the order is built in the first place, and
// Main/Serving aren't mid-order screens.
//
// Renders the actual order the player built via CustomerOrdering's "Place
// Order" step (lifted up through App.js's currentOrder state, passed down
// here as the order prop) instead of the old hardcoded AnnieOrder1.png
// receipt image -- every order can look different now that the
// order-builder exists. order is null until the player has placed one.
// highlight/hintText/hintTextOpen/onToggle are all optional and opt-in per
// screen (same pattern as ProgressBar's highlightCurrentStep/
// currentStepHint) -- currently only MatchaMaking passes them, the first
// time a player lands on that station each round, to point out this button
// and the fact that Enter opens (and closes) it from wherever focus already
// is. Milk Selection/Toppings leave them undefined/falsy and render exactly
// as before. hintText is shown while closed, hintTextOpen while open --
// the flashing itself keeps going regardless of open/closed, only the
// wording swaps to match what Enter would do next.
const OrderReceiptButton = ({ order, highlight = false, hintText = null, hintTextOpen = null, onToggle }) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  // Moves focus onto this button the moment highlight turns on, same
  // "the highlighted thing becomes the next thing selected" idea used
  // elsewhere (.order-place-button/ProgressBar's current-step dot in
  // CustomerOrdering.js) -- and what makes the accompanying hint's
  // "use your Enter key" instruction actually true immediately, since
  // Enter only opens this via its own native on-focused-button behavior.
  useEffect(() => {
    if (highlight) {
      buttonRef.current?.focus();
    }
  }, [highlight]);

  // onToggle fires for both a click AND a native Enter/Space activation
  // (both route through this one onClick) -- callers can use this to react
  // to the button being used (MatchaMaking currently doesn't hook anything
  // to it; the highlight/hint intentionally keep going regardless, see the
  // hintText/hintTextOpen swap below, rather than retiring on first use).
  const handleClick = () => {
    // `open` (component state, read here rather than inside the setOpen
    // updater below) is the drawer's state *before* this click -- true
    // means the click is about to close it (the "off" clip), false means
    // it's about to open (the regular click). Deliberately not done inside
    // the setOpen(prev => ...) updater itself: React.StrictMode
    // intentionally double-invokes updater functions in dev to surface
    // impure ones, which would double-play whichever clip fired if the
    // side effect lived in there. See playButtonClickOff's own doc comment
    // in sfx.js.
    if (open) {
      playButtonClickOff();
    } else {
      playButtonClick();
    }
    setOpen((prev) => {
      const next = !prev;
      onToggle?.(next);
      return next;
    });
  };

  return (
    <div className="order-receipt-widget">
      <button
        ref={buttonRef}
        type="button"
        className={`order-receipt-button${highlight ? ' highlight' : ''}`}
        data-focusable
        aria-expanded={open}
        aria-label={open ? 'Hide order receipt' : 'Show order receipt'}
        onClick={handleClick}
      >
        Order
      </button>
      <div className={`order-receipt-drawer${open ? ' open' : ''}`}>
        {order ? (
          <div className="order-receipt-card">
            <p className="order-receipt-line">
              <span className="order-receipt-label">Matcha</span>
              {GRADE_LABELS[order.matchaGrade]} &middot; {order.teaspoons} tsp
            </p>
            <p className="order-receipt-line">
              <span className="order-receipt-label">Cup</span>
              {CUP_LABELS[order.cupType]} &middot; {order.iceCubes} ice
            </p>
            <p className="order-receipt-line">
              <span className="order-receipt-label">Base</span>
              {BASE_LABELS[order.baseMilk]}
            </p>
            <p className="order-receipt-line">
              <span className="order-receipt-label">Toppings</span>
              {order.toppings.length > 0
                ? order.toppings.map((value) => TOPPING_LABELS[value]).join(', ')
                : 'None'}
            </p>
          </div>
        ) : (
          <p className="order-receipt-empty">No order placed yet.</p>
        )}
      </div>
      {highlight && (open ? hintTextOpen : hintText) && (
        <p className="order-receipt-hint">{open ? hintTextOpen : hintText}</p>
      )}
    </div>
  );
};

export default OrderReceiptButton;
