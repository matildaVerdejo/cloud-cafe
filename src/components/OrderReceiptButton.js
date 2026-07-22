import React, { useState } from 'react';
import './OrderReceiptButton.css';

// Lets the player peek at the current order without leaving whichever
// station they're on. Sits top-right on the three "working" screens
// (Matcha Making, Milk Selection, Toppings) -- Customer Ordering doesn't
// need it since the receipt is already pinned to the wall there, and
// Main/Serving aren't mid-order screens.
//
// Hardcoded to Annie's order 1 for now, the same asset CustomerOrdering.js
// shows -- once more characters/order variations exist, both this and
// CustomerOrdering.js should read the active order from shared session
// state instead of a fixed image src.
const OrderReceiptButton = () => {
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
        <img
          src="./AnnieOrder1.png"
          alt="Current order receipt"
          className="order-receipt-drawer-img"
        />
      </div>
    </div>
  );
};

export default OrderReceiptButton;
