import React, { useEffect, useRef, useState } from 'react';
import './App.css';
import MainPage from './components/MainPage';
import CustomerOrdering from './components/CustomerOrdering';
import MatchaMaking from './components/MatchaMaking';
import MilkSelection from './components/MilkSelection';
import ToppingsStation from './components/ToppingsStation';
import FinalCombination from './components/FinalCombination';
import { PROGRESS_STEPS } from './components/ProgressBar';
// Debug overlay is currently unused (see the commented-out JSX below) --
// import left commented out too so CRA's CI lint pass (unused-import) doesn't
// fail the Vercel build. Uncomment both together to bring it back.
// import GameLoopAPIDebugOverlay from './gameloop/GameLoopAPIDebugOverlay';
import { getActionFromKeyEvent } from './gameloop/pal';
import {
  initGameLoopBridge,
  sendAppReady,
  sendClose,
  sendAdOpportunity,
  onAdMessage,
  hasSentAppReady,
} from './gameloop/bridge';

// Same order as the ProgressBar's PROGRESS_STEPS, imported from the same
// place so the bar and this state machine can't drift apart.
const STEP_KEYS = PROGRESS_STEPS.map((step) => step.key);
const ORDERS_PER_SESSION = 3;

function App() {
  const [currentPage, setCurrentPage] = useState('main');
  // Which customer (1-3) the player is currently serving this session.
  const [customerNumber, setCustomerNumber] = useState(1);
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
  // exit UX then close. Every other screen's Back walks one step back
  // through STEP_KEYS (stepping out of 'ordering' returns to main). The
  // on-screen Back buttons are gone now (replaced by the ProgressBar, which
  // supports jumping to any step, forward or back) -- this is just the
  // remote/keyboard Back key's fallback path.
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
      if (currentPageRef.current === 'main') {
        setShowExitConfirm(true);
        return;
      }
      const idx = STEP_KEYS.indexOf(currentPageRef.current);
      if (idx <= 0) {
        setCurrentPage('main');
        setCustomerNumber(1);
        sendAdOpportunity('MENU_RETURN');
      } else {
        setCurrentPage(STEP_KEYS[idx - 1]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExitConfirm]);

  const handlePlayClick = () => {
    setCustomerNumber(1);
    setCurrentPage('ordering');
  };

  // Progress bar: clicking any step other than the current one jumps
  // straight there, forward or back.
  const navigateTo = (pageKey) => {
    setCurrentPage(pageKey);
  };

  // Progress bar: clicking the CURRENT step means "I'm done here" -- advance
  // to the next step, or, from the last step (Serve), complete this
  // customer's order and either start the next one or head back to the
  // main menu once all 3 are done.
  const handleAdvance = () => {
    const idx = STEP_KEYS.indexOf(currentPage);
    if (idx === -1) return;
    if (idx < STEP_KEYS.length - 1) {
      setCurrentPage(STEP_KEYS[idx + 1]);
      return;
    }
    if (customerNumber < ORDERS_PER_SESSION) {
      setCustomerNumber((n) => n + 1);
      setCurrentPage('ordering');
    } else {
      setCustomerNumber(1);
      setCurrentPage('main');
      sendAdOpportunity('MENU_RETURN');
    }
  };

  // Natural ad break point: each customer's drink finished.
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

  // Every screen except Main gets the same progress bar wired the same
  // way -- built once here and spread onto whichever screen is showing.
  const progressProps = {
    customerNumber,
    onNavigate: navigateTo,
    onAdvance: handleAdvance,
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
            <CustomerOrdering activeStep="ordering" {...progressProps} />
          </div>
        )}
        {currentPage === 'matcha-making' && (
          <div className="page-slide">
            <MatchaMaking activeStep="matcha-making" {...progressProps} />
          </div>
        )}
        {currentPage === 'milk-selection' && (
          <div className="page-slide">
            <MilkSelection activeStep="milk-selection" {...progressProps} />
          </div>
        )}
        {currentPage === 'toppings' && (
          <div className="page-slide">
            <ToppingsStation activeStep="toppings" {...progressProps} />
          </div>
        )}
        {currentPage === 'final-combination' && (
          <div className="page-slide">
            <FinalCombination activeStep="final-combination" {...progressProps} />
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
