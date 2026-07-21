import React, { useRef } from 'react';
import './MatchaMaking.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import ProgressBar from './ProgressBar';

const MatchaMaking = ({ activeStep, customerNumber, onNavigate, onAdvance }) => {
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

export default MatchaMaking;
