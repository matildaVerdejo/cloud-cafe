import React, { useEffect, useRef, useState } from 'react';
import './CustomerOrdering.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import ProgressBar from './ProgressBar';

// Possible customer orders -- one is picked at random each time this screen
// mounts (i.e. each time a new customer shows up: game start, or looping
// back after finishing a drink). Only the mint matcha line is live for now
// while the character/order-variation system (Annie first, 5-7 characters
// eventually) is being built out -- the guava and coconut lines were
// placeholders and are removed rather than left dead in the array.
const ORDERS = ['Hello, may I have an iced mint matcha latte?'];

function pickRandomOrder() {
  return ORDERS[Math.floor(Math.random() * ORDERS.length)];
}

const CustomerOrdering = ({ activeStep, customerNumber, onNavigate, onAdvance }) => {
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
        {/* Positioned over the blank speech bubble in the art. */}
        <p className="order-text">{order.slice(0, visibleChars)}</p>
        {/* Positioned over the blank hanging receipt paper in the art.
            Annie's first order variation -- once more characters/variations
            exist, this becomes a lookup keyed by whichever character/order
            is active instead of a single hardcoded image. */}
        <img
          src="./AnnieOrder1.png"
          alt="Order receipt: 2 tsp matcha, glass cup, 3 ice cubes, oat milk, mint syrup, 1 mint leaf"
          className="order-receipt"
        />
        <ProgressBar
          activeStep={activeStep}
          customerNumber={customerNumber}
          onNavigate={onNavigate}
          onAdvance={onAdvance}
        />
      </div>
    </div>
  );
};

export default CustomerOrdering;
