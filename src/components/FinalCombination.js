import React, { useRef, useState } from 'react';
import './FinalCombination.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';

const FinalCombination = ({ selectedMilk, onBack, onComplete }) => {
  const [showConfetti, setShowConfetti] = useState(false);
  const [showCombination, setShowCombination] = useState(false);
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  const handleCombine = () => {
    setShowCombination(true);
    setTimeout(() => {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
    }, 2000);
  };

  const handleFinish = () => {
    onComplete();
  };

  return (
    <div className="final-combination-container" ref={containerRef}>
      <div className="final-combination-content">
        <header className="final-header">
          <h1 className="final-title">Create Your Matcha Latte</h1>
          <p className="final-subtitle">Combine your ingredients to create the perfect matcha latte</p>
        </header>
        
        <div className="ingredients-summary">
          <div className="matcha-summary">
            <h3>Base: Whisked Matcha</h3>
            <img src="./Wisked.png" alt="Whisked Matcha" className="summary-image" />
          </div>
          <div className="milk-summary">
            <h3>Milk: {selectedMilk}</h3>
            <img src={`./${selectedMilk.toLowerCase()}.png`} alt={selectedMilk} className="summary-image" />
          </div>
        </div>


        <div className="final-matcha-container">
          <div className="final-matcha-glass">
            <img src="./MatchaGlass.png" alt="Final Matcha Latte" className="final-matcha-glass-image" />
            {showCombination && (
              <div className="combination-effects">
                <div className="milk-pour"></div>
                <div className="steam-effect"></div>
              </div>
            )}
          </div>
        </div>

        <div className="navigation-buttons">
          <button className="back-button" data-focusable onClick={onBack}>
            Back to Milk Selection
          </button>
          <button className="combine-button" data-focusable autoFocus onClick={handleCombine}>
            Create Matcha Latte
          </button>
          {showCombination && (
            <button className="finish-button" data-focusable onClick={handleFinish}>
              Finish & Start Over
            </button>
          )}
        </div>

        {showConfetti && (
          <div className="confetti-container">
            <div className="confetti"></div>
            <div className="confetti"></div>
            <div className="confetti"></div>
            <div className="confetti"></div>
            <div className="confetti"></div>
            <div className="confetti"></div>
            <div className="confetti"></div>
            <div className="confetti"></div>
            <div className="confetti"></div>
            <div className="confetti"></div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FinalCombination;
