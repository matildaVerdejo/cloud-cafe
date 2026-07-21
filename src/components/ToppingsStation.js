import React, { useRef } from 'react';
import './ToppingsStation.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import ProgressBar from './ProgressBar';

const ToppingsStation = ({ activeStep, customerNumber, onNavigate, onAdvance }) => {
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

export default ToppingsStation;
