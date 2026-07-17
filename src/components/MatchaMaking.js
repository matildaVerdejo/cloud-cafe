import React, { useRef } from 'react';
import './MatchaMaking.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';

const MatchaMaking = ({ onBack, onComplete }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  return (
    <div className="matcha-making-container" ref={containerRef}>
      <h1 className="sr-only">Matcha Base Station</h1>

      <div className="matcha-making-content">
        <img
          src="./MatchaBaseStation.png"
          alt="Matcha base station with kettle, bowl, whisk, and matcha tins"
          className="matcha-making-art"
        />
        <button
          type="button"
          className="matcha-back-button"
          data-focusable
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          className="mix-drink-button"
          data-focusable
          autoFocus
          onClick={onComplete}
        >
          Mix Drink
        </button>
      </div>
    </div>
  );
};

export default MatchaMaking;
