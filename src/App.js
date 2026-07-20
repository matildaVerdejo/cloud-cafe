import React, { useEffect, useRef, useState } from 'react';
import './App.css';
import MainPage from './components/MainPage';
import CustomerOrdering from './components/CustomerOrdering';
import MatchaMaking from './components/MatchaMaking';
import MilkSelection from './components/MilkSelection';
import ToppingsStation from './components/ToppingsStation';
import FinalCombination from './components/FinalCombination';
import GameLoopAPIDebugOverlay from './gameloop/GameLoopAPIDebugOverlay';
import { getActionFromKeyEvent } from './gameloop/pal';
import {
  initGameLoopBridge,
  sendAppReady,
  sendClose,
  sendAdOpportunity,
  onAdMessage,
  hasSentAppReady,
} from './gameloop/bridge';

function App() {
  const [currentPage, setCurrentPage] = useState('main');
  const [selectedMilk, setSelectedMilk] = useState(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [adPlaying, setAdPlaying] = useState(false);
  // currentPage is read inside a window-level keydown listener that is
  // attached once; keep a ref so the handler always sees the latest value
  // without re-attaching the listener on every navigation.
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  // ---- GameLoop V1 bridge setup -------------------------------------------
  useEffect(() => {
    initGameLoopBridge();
    // MainPage is the first screen and is already painted by the time this
    // effect runs, so this satisfies "appReady once first presentable UI is
    // shown" without a separate splash step.
    sendAppReady();

    const unsubscribe = onAdMessage((message) => {
      if (message === 'ads.started' || message === 'ads.inProgress') {
        setAdPlaying(true);
      } else if (message === 'ads.completed' || message === 'ads.skipped') {
        setAdPlaying(false);
      }
    });
    return unsubscribe;
  }, []);

  // ---- Lifecycle: suspend on hidden/backgrounded, resume on visible ------
  useEffect(() => {
    const handleVisibility = () => {
      document.body.classList.toggle('gl-suspended', document.hidden);
    };
    const handlePageHide = () => {
      document.body.classList.add('gl-suspended');
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  // ---- Back key policy (single PAL-driven path) ---------------------------
  // Top-level menu (main, or the exit-confirm dialog on top of it) routes to
  // exit UX then close. Every other screen's Back retraces the existing
  // "Back to ..." button behavior (equivalent to a pause/menu step-back for
  // this step-based game).
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Back') return;
      // Escape hatch: before appReady fires, Back should not trap the user.
      if (!hasSentAppReady()) {
        sendClose();
        return;
      }
      e.preventDefault();
      if (showExitConfirm) {
        setShowExitConfirm(false); // Back cancels the confirm dialog
        return;
      }
      switch (currentPageRef.current) {
        case 'main':
          setShowExitConfirm(true);
          break;
        case 'ordering':
          handleBackToMain();
          break;
        case 'matcha-making':
          handleBackToOrdering();
          break;
        case 'milk-selection':
          handleBackToMatcha();
          break;
        case 'toppings':
          handleBackToMilk();
          break;
        case 'final-combination':
          handleBackToToppings();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExitConfirm]);

  const handlePlayClick = () => {
    setCurrentPage('ordering');
  };

  const handleOrderStart = () => {
    setCurrentPage('matcha-making');
  };

  const handleMatchaComplete = () => {
    setCurrentPage('milk-selection');
  };

  const handleMilkSelected = (milkType) => {
    setSelectedMilk(milkType);
    setCurrentPage('final-combination');
  };

  const handleAddToppings = () => {
    setCurrentPage('toppings');
  };

  const handleToppingsComplete = () => {
    setCurrentPage('final-combination');
  };

  const handleBackToMain = () => {
    setCurrentPage('main');
    setSelectedMilk(null);
    sendAdOpportunity('MENU_RETURN');
  };

  const handleBackToOrdering = () => {
    setCurrentPage('ordering');
  };

  const handleBackToMatcha = () => {
    setCurrentPage('matcha-making');
  };

  const handleBackToMilk = () => {
    setCurrentPage('milk-selection');
  };

  const handleBackToToppings = () => {
    setCurrentPage('toppings');
  };

  // Natural ad break point: matcha latte finished.
  useEffect(() => {
    if (currentPage === 'final-combination') {
      sendAdOpportunity('DRINK_COMPLETE');
    }
  }, [currentPage]);

  const confirmExit = () => {
    setShowExitConfirm(false);
    sendClose();
  };

  const cancelExit = () => {
    setShowExitConfirm(false);
  };

  return (
    <div className={`App${adPlaying ? ' gl-ad-playing' : ''}`}>
      <div className={`page-container ${currentPage}`}>
        {currentPage === 'main' && (
          <div className="page-slide">
            <MainPage onPlayClick={handlePlayClick} />
          </div>
        )}
        {currentPage === 'ordering' && (
          <div className="page-slide">
            <CustomerOrdering onOrderStart={handleOrderStart} onBack={handleBackToMain} />
          </div>
        )}
        {currentPage === 'matcha-making' && (
          <div className="page-slide">
            <MatchaMaking onComplete={handleMatchaComplete} onBack={handleBackToOrdering} />
          </div>
        )}
        {currentPage === 'milk-selection' && (
          <div className="page-slide">
            <MilkSelection
              onMilkSelected={handleMilkSelected}
              onAddToppings={handleAddToppings}
              onBack={handleBackToMatcha}
            />
          </div>
        )}
        {currentPage === 'toppings' && (
          <div className="page-slide">
            <ToppingsStation onComplete={handleToppingsComplete} onBack={handleBackToMilk} />
          </div>
        )}
        {currentPage === 'final-combination' && (
          <div className="page-slide">
            <FinalCombination
              selectedMilk={selectedMilk}
              onBack={handleBackToToppings}
              onComplete={handleBackToMain}
            />
          </div>
        )}
      </div>

      {showExitConfirm && (
        <div className="gl-exit-confirm-backdrop">
          <div className="gl-exit-confirm-dialog">
            <p>Exit Cloud Cafe?</p>
            <div className="gl-exit-confirm-buttons">
              <button type="button" autoFocus data-focusable onClick={confirmExit}>
                Exit
              </button>
              <button type="button" data-focusable onClick={cancelExit}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {adPlaying && <div className="gl-ad-curtain">Ad playing…</div>}

      {/* Removable GameLoop V1 debug overlay — hidden for now (design work in
          progress). Uncomment to bring it back for validating appReady/
          adOpportunity/close/focusHost; the bridge and Back handling keep
          working either way. */}
      {/* <GameLoopAPIDebugOverlay /> */}
    </div>
  );
}

export default App;
