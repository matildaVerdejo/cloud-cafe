import React, { useState } from 'react';
import './OrderReceiptButton.css';

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
const OrderReceiptButton = ({ order }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="order-receipt-widget">
      <button
        type="button"
        className="order-receipt-button"
        data-focusable
        aria-expanded={open}
        aria-label={open ? 'Hide order receipt' : 'Show order receipt'}
        onClick={() => setOpen((prev) => !prev)}
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
    </div>
  );
};

export default OrderReceiptButton;
