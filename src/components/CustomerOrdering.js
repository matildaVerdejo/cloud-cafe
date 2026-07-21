import React, { useEffect, useRef, useState } from 'react';
import './CustomerOrdering.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';

// Possible customer orders -- one is picked at random each time this screen
// mounts (i.e. each time a new customer shows up: game start, or looping
// back after finishing a drink). Add more lines here later; nothing else
// needs to change.
const ORDERS = [
  'Hello, may I have an iced mint matcha latte?',
  'Hi there, may I have an iced guava matcha latte?',
  'Hey! Could I get a coconut matcha cloud?',
];

function pickRandomOrder() {
  return ORDERS[Math.floor(Math.random() * ORDERS.length)];
}

const CustomerOrdering = ({ onOrderStart, onBack }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);
  // Lazy initializer -- picked once when the screen mounts, not re-rolled
  // on every re-render.
  const [order] = useState(pickRandomOrder);

  // Typewriter effect: reveal one more character every TYPE_INTERVAL_MS so
  // the bubble looks like the customer is actually talking. Runs once per
  // mount (tied to `order`, which itself only changes on remount).
  const [visibleChars, setVisibleChars] = useState(0);
  useEffect(() => {
    setVisibleChars(0);
    const TYPE_INTERVAL_MS = 50;
    const intervalId = setInterval(() => {
      setVisibleChars((prev) => {
        if (prev >= order.length) {
          clearInterval(intervalId);
          return prev;
        }
        return prev + 1;
      });
    }, TYPE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [order]);

  return (
    <div className="ordering-container" ref={containerRef}>
      <h1 className="sr-only">Customer Ordering</h1>

      <div className="ordering-content">
        <img
          src="./CustomerOrdering.png"
          alt="A customer waiting at the Cloud Cafe counter"
          className="ordering-art"
        />
        {/* Positioned over the blank speech bubble in the art. The menu
            board on the right is still left blank on purpose. */}
        <p className="order-text">{order.slice(0, visibleChars)}</p>
        <button
          type="button"
          className="ordering-back-button"
          data-focusable
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          className="start-order-button"
          data-focusable
          autoFocus
          onClick={onOrderStart}
        >
          Start Order
        </button>
      </div>
    </div>
  );
};

export default CustomerOrdering;
