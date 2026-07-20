import React, { useRef } from 'react';
import './FinalCombination.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';

const FinalCombination = ({ onBack, onComplete }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  return (
    <div className="final-combination-container" ref={containerRef}>
      <h1 className="sr-only">Serving</h1>

      <div className="final-combination-content">
        <img
          src="./Serving.png"
          alt="Serving counter with an empty plate, ready to serve the finished drink"
          className="serving-art"
        />
        <button type="button" className="serving-back-button" data-focusable autoFocus onClick={onBack}>
          Back
        </button>
        <button type="button" className="serve-drink-button" data-focusable onClick={onComplete}>
          Serve Drink
        </button>
      </div>
    </div>
  );
};

export default FinalCombination;
