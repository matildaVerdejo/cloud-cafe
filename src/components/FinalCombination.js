import React, { useRef } from 'react';
import './FinalCombination.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import ProgressBar from './ProgressBar';

const FinalCombination = ({ activeStep, customerNumber, onNavigate, onAdvance }) => {
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

export default FinalCombination;
