import React, { useRef } from 'react';
import './ToppingsStation.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';

const ToppingsStation = ({ onBack, onComplete }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  return (
    <div className="toppings-container" ref={containerRef}>
      <h1 className="sr-only">Toppings Station</h1>

      <div className="toppings-content">
        <img
          src="./ToppingsStation.png"
          alt="Toppings station with syrup bottles, shaker jars, and a bowl of mint leaves"
          className="toppings-art"
        />
        <button
          type="button"
          className="toppings-back-button"
          data-focusable
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          className="finish-drink-button"
          data-focusable
          autoFocus
          onClick={onComplete}
        >
          Finish Drink
        </button>
      </div>
    </div>
  );
};

export default ToppingsStation;
