import React, { useRef, useState } from 'react';
// OrderReceiptButton.css is now imported once, eagerly, from App.js instead
// of here -- this component is itself imported from three separate
// lazy-loaded screens (MatchaMaking.js, MilkSelection.js, ToppingsStation.js),
// and importing its CSS locally meant webpack had to reconcile its order
// against MatchaMaking.css across every combination of those chunks, which
// it couldn't -- a "Conflicting order" webpack warning that Vercel's
// CI=true escalates into a hard build failure. See App.js's own import
// comment for the full explanation.
import { playButtonClick, playButtonClickOff } from '../gameloop/sfx';

// Label lookups for the raw values CustomerOrdering.js stores in its order
// object (see the option lists at the top of that file) -- kept as small
// standalone maps here rather than importing CustomerOrdering's arrays so
// this component doesn't depend on another screen's internals for a handful
// of fixed strings.
const GRADE_LABELS = { cafe: 'cafe', classic: 'classic', ceremonial: 'ceremonial', hojicha: 'hojicha' };
const CUP_LABELS = { glass: 'glass', mug: 'mug', plastic: 'plastic' };
const BASE_LABELS = {
  dairy: 'dairy milk',
  oat: 'oat milk',
  almond: 'almond milk',
  coconut: 'coconut water',
  strawberry: 'strawberry milk',
  yuzu: 'sparkling yuzu',
  jasmine: 'jasmine tea',
};
const TOPPING_LABELS = {
  'guava-syrup': 'guava syrup',
  'mint-syrup': 'mint syrup',
  'honey-syrup': 'honey syrup',
  'reg-foam': 'reg foam',
  'matcha-foam': 'matcha foam',
  'guava-powder': 'guava powder',
  'matcha-powder': 'matcha powder',
  'mint-leaves': 'mint leaves',
  'banana-foam': 'banana foam',
  'mango-syrup': 'mango syrup',
  'choco-powder': 'choco powder',
  'lavender-syrup': 'lavender syrup',
  'strawberry-foam': 'strawberry foam',
  'banana-chips': 'banana chips',
  'peach-syrup': 'peach syrup',
  'blueberry-foam': 'blueberry foam',
  'cherry-blossoms': 'cherry blossoms',
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
const OrderReceiptButton = ({
  order,
  highlight = false,
  hintText = null,
  hintTextOpen = null,
  onToggle,
  // Opt-in, only ever passed true by MatchaMaking's own showStationSpotlight
  // (the first-order-only walkthrough spotlight continued from Customer
  // Ordering) -- adds the .matcha-spotlight-exempt modifier (defined in
  // MatchaMaking.css, but a plain global class like every other className in
  // this project, so it applies here too even though this component doesn't
  // import that stylesheet itself) so this widget's own z-index clears that
  // screen's .matcha-spotlight-overlay and reads through the pink tint
  // untinted. Milk Selection/Toppings never pass this and render exactly as
  // before.
  spotlightExempt = false,
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  // Used to move focus onto this button the moment highlight turned on
  // (same "the highlighted thing becomes the next thing selected" idea
  // used elsewhere, e.g. .order-place-button/ProgressBar's current-step
  // dot in CustomerOrdering.js) -- removed per request once the station
  // screens got their own explicit, deterministic keyboard nav graphs
  // (see the big keydown effect near the top of MatchaMaking.js, and
  // eventually Milk Selection/Toppings too): those graphs all start from
  // ProgressBar's own current-step dot on mount, and this effect used to
  // steal focus away from that onto this button instead, the moment
  // `highlight` was already true at mount (MatchaMaking's own
  // showOrderHint starts as true). The visual flash/hint text themselves
  // (highlight/hintText/hintTextOpen below) are untouched -- only the
  // auto-focus was the problem.

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
    <div className={`order-receipt-widget${spotlightExempt ? ' matcha-spotlight-exempt' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`order-receipt-button${highlight ? ' highlight' : ''}`}
        data-focusable
        aria-expanded={open}
        aria-label={open ? 'Hide order receipt' : 'Show order receipt'}
        onClick={handleClick}
      >
        order
      </button>
      <div className={`order-receipt-drawer${open ? ' open' : ''}`}>
        {order ? (
          <div className="order-receipt-card">
            <p className="order-receipt-line">
              <span className="order-receipt-label">matcha</span>
              {GRADE_LABELS[order.matchaGrade]} &middot; {order.teaspoons} tsp
            </p>
            <p className="order-receipt-line">
              <span className="order-receipt-label">cup</span>
              {CUP_LABELS[order.cupType]} &middot; {order.iceCubes} ice
            </p>
            <p className="order-receipt-line">
              <span className="order-receipt-label">base</span>
              {BASE_LABELS[order.baseMilk]}
            </p>
            <p className="order-receipt-line">
              <span className="order-receipt-label">toppings</span>
              {order.toppings.length > 0
                ? order.toppings.map((value) => TOPPING_LABELS[value]).join(', ')
                : 'none'}
            </p>
          </div>
        ) : (
          <p className="order-receipt-empty">no order placed yet.</p>
        )}
      </div>
      {highlight && (open ? hintTextOpen : hintText) && (
        <p className="order-receipt-hint">{open ? hintTextOpen : hintText}</p>
      )}
    </div>
  );
};

export default OrderReceiptButton;
