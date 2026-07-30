import React, { useEffect, useRef, useState } from 'react';
import './App.css';
import SplashScreen from './components/SplashScreen';
import SettingsPanel from './components/SettingsPanel';
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
import { useFlatFocusNav } from './gameloop/useFlatFocusNav';
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
// How much each press of the Settings panel's volume +/- buttons changes
// musicVolume by -- 10 presses from empty reaches full volume.
const VOLUME_STEP = 0.1;

function App() {
  // Splash is the very first thing shown, ahead of MainPage's own
  // storefront/Start screen -- see the big comment in SplashScreen.js for
  // why this doesn't change anything about appReady timing (still fires on
  // mount regardless of which page is showing) or the PREROLL ad-timing
  // note in the messaging guide (MainPage's Play button is still the real
  // "start screen" that gates that, unaffected by this beat coming before
  // it).
  const [currentPage, setCurrentPage] = useState('splash');
  // Which customer (1-3) the player is currently serving this session.
  const [customerNumber, setCustomerNumber] = useState(1);
  // The order built in CustomerOrdering's "Place Order" step -- null until
  // placed, then shown by OrderReceiptButton on the Matcha/Milk/Toppings
  // screens (replacing the old hardcoded AnnieOrder1.png receipt). Reset to
  // null when a new customer's ordering step starts so the next order can't
  // ever show the previous customer's receipt (see handlePlayClick/
  // handleAdvance below).
  const [currentOrder, setCurrentOrder] = useState(null);
  // The whisked matcha bowl sent over from MatchaMaking's "Make Drink"
  // drop-zone -- null until sent, then shown by MilkSelection as its own
  // carried-over bowl+whisk display (see incomingBowl there). Shape is
  // whatever MatchaMaking's bowlPowder state holds ({ color, grade }).
  // Reset to null in the same places currentOrder is, for the same reason
  // -- a new customer's Milk Selection screen should never show the
  // previous customer's leftover bowl.
  const [matchaBowl, setMatchaBowl] = useState(null);
  // The finished cup sent over from MilkSelection's own "Send to Toppings"
  // drop-zone -- null until sent, then shown by ToppingsStation as its own
  // carried-over drink display (see incomingDrink there). Shape is
  // whatever MilkSelection's beginSendDrink hands off ({ milk, matcha }, the
  // cup's own cupMilk/cupMatcha state at the moment it's sent). Reset to
  // null in the same places matchaBowl/currentOrder are, for the same
  // reason -- a new customer's Toppings screen should never show the
  // previous customer's leftover drink.
  const [finishedDrink, setFinishedDrink] = useState(null);
  // The fully-topped drink sent over from ToppingsStation's own "Send to
  // Serving" drop-zone -- null until sent, then shown by FinalCombination as
  // its own carried-over drink display (see incomingDrink there). Shape is
  // whatever ToppingsStation's beginSendToFinal hands off ({ milk, matcha,
  // foam, syrup, powder } -- milk/matcha straight from finishedDrink, foam/
  // syrup/powder from that screen's own cupFoam/cupSyrup/cupPowder state).
  // Reset to null in the same places matchaBowl/finishedDrink/currentOrder
  // are, for the same reason -- a new customer's Serving screen should
  // never show the previous customer's leftover drink.
  const [servedDrink, setServedDrink] = useState(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [adPlaying, setAdPlaying] = useState(false);
  // Background music -- one <audio> element rendered once here (outside the
  // per-page conditionals below) so it survives every page navigation and
  // just keeps looping until the tab/app itself closes. There's no on/off
  // toggle anymore (the old MainPage mute button was removed once the
  // Settings panel's volume control shipped -- turning musicVolume down to
  // 0% covers the same need); this always tries to play.
  // Music volume (0-1), adjustable from the Settings panel's up/down
  // buttons (VOLUME_STEP, in SettingsPanel.js) -- default matches the value
  // this used to be hardcoded to directly on the <audio> element.
  const [musicVolume, setMusicVolume] = useState(0.5);
  // Settings popover open/closed -- lifted up here (rather than local state
  // inside SettingsPanel) for the same reason showExitConfirm is: the
  // central Back-key handler below needs to know about it, to close the
  // popover on Back before falling through to that screen's own Back
  // behavior.
  const [showSettings, setShowSettings] = useState(false);
  const audioRef = useRef(null);
  // currentPage is read inside a window-level keydown listener that is
  // attached once; keep a ref so the handler always sees the latest value
  // without re-attaching the listener on every navigation.
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  // Exit-confirm dialog is rendered outside/on top of the per-screen
  // components, so it needs its own spatial-nav scope -- the screens'
  // useFlatFocusNav hooks only act while focus is inside their own
  // container, and unmount/remount with currentPage, so nothing here would
  // otherwise let the D-pad move between Exit and Cancel. Safe to call
  // unconditionally: when the dialog isn't rendered, dialogRef.current is
  // null and the hook's handler just returns early.
  const exitDialogRef = useRef(null);
  useFlatFocusNav(exitDialogRef);
  // Settings panel is rendered once here (see the big comment on it further
  // down) rather than duplicated into every screen, so it needs this same
  // "own spatial-nav scope, safe to call unconditionally" treatment as the
  // exit dialog -- the circle button and its popover live outside every
  // screen's own container, so none of those screens' own useFlatFocusNav
  // hooks would otherwise let the D-pad move between them.
  const settingsRef = useRef(null);
  useFlatFocusNav(settingsRef);

  // ---- GameLoop V1 bridge setup -------------------------------------------
  useEffect(() => {
    initGameLoopBridge();
    // SplashScreen is the first screen now (see currentPage's own initial
    // value above) and is already painted by the time this effect runs --
    // this effect doesn't depend on currentPage at all, so it fires the
    // instant there's ANY presentable UI on screen, satisfying "appReady
    // once first presentable UI is shown, even a loading/splash screen"
    // (see the messaging guide) regardless of which page that turns out to
    // be.
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

  // Keeps the <audio> element's own volume in sync with musicVolume --
  // declared (and therefore runs, on mount) before the autoplay effect
  // below, so playback that starts during that effect already has the
  // right volume applied rather than briefly using the element's own
  // default (1.0) first. Also re-applies live on every Settings panel
  // up/down press afterward.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = musicVolume;
  }, [musicVolume]);

  // ---- Background music: autoplay + first-gesture fallback ---------------
  // Most browsers block audio with sound until the user has interacted with
  // the page at least once. We try to start it immediately on mount (works
  // on platforms/TV browsers that allow it), and also attach a one-time
  // listener for the first keydown/click/pointerdown anywhere so it starts
  // right away everywhere else.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const tryPlay = () => {
      audio.play().catch(() => {
        // Autoplay was blocked -- the first-gesture listener below will
        // retry once the player interacts.
      });
    };
    tryPlay();
    const handleFirstGesture = () => {
      tryPlay();
      window.removeEventListener('keydown', handleFirstGesture);
      window.removeEventListener('pointerdown', handleFirstGesture);
    };
    window.addEventListener('keydown', handleFirstGesture);
    window.addEventListener('pointerdown', handleFirstGesture);
    return () => {
      window.removeEventListener('keydown', handleFirstGesture);
      window.removeEventListener('pointerdown', handleFirstGesture);
    };
  }, []);

  // Settings panel: volume up/down and the popover's own open/closed
  // toggle. Clamped to [0, 1] and rounded to one decimal place to avoid
  // floating-point drift (0.1 + 0.2 !== 0.3 and friends) from repeated
  // presses landing on an odd value like 0.7000000000000001.
  const stepMusicVolume = (delta) => {
    setMusicVolume((v) => Math.round(Math.min(1, Math.max(0, v + delta)) * 10) / 10);
  };
  const decreaseMusicVolume = () => stepMusicVolume(-VOLUME_STEP);
  const increaseMusicVolume = () => stepMusicVolume(VOLUME_STEP);
  const toggleSettings = () => setShowSettings((open) => !open);

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
      if (showSettings) {
        setShowSettings(false); // Back closes the Settings popover, same as the exit dialog above
        return;
      }
      // Splash isn't really "loading" (nothing to wait on -- see
      // SplashScreen.js), so Back here just skips it the same way the
      // start button/auto-timeout do, rather than falling into the
      // idx <= 0 branch below (which would also fire a MENU_RETURN ad
      // opportunity -- appropriate for returning from a finished session,
      // not for skipping the very first beat of a fresh one).
      if (currentPageRef.current === 'splash') {
        setCurrentPage('main');
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
  }, [showExitConfirm, showSettings]);

  const handleSplashDismiss = () => {
    setCurrentPage('main');
  };

  const handlePlayClick = () => {
    setCustomerNumber(1);
    setCurrentOrder(null);
    setMatchaBowl(null);
    setFinishedDrink(null);
    setServedDrink(null);
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
      setCurrentOrder(null);
      setMatchaBowl(null);
      setFinishedDrink(null);
      setServedDrink(null);
      setCurrentPage('ordering');
    } else {
      setCustomerNumber(1);
      setCurrentOrder(null);
      setMatchaBowl(null);
      setFinishedDrink(null);
      setServedDrink(null);
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
        {currentPage === 'splash' && (
          <div className="page-slide">
            <SplashScreen onDismiss={handleSplashDismiss} />
          </div>
        )}
        {currentPage === 'main' && (
          <div className="page-slide">
            <MainPage onPlayClick={handlePlayClick} />
          </div>
        )}
        {currentPage === 'ordering' && (
          <div className="page-slide">
            <CustomerOrdering activeStep="ordering" onPlaceOrder={setCurrentOrder} {...progressProps} />
          </div>
        )}
        {currentPage === 'matcha-making' && (
          <div className="page-slide">
            <MatchaMaking
              activeStep="matcha-making"
              order={currentOrder}
              onSendToMilk={setMatchaBowl}
              {...progressProps}
            />
          </div>
        )}
        {currentPage === 'milk-selection' && (
          <div className="page-slide">
            <MilkSelection
              activeStep="milk-selection"
              order={currentOrder}
              incomingBowl={matchaBowl}
              onSendToToppings={setFinishedDrink}
              {...progressProps}
            />
          </div>
        )}
        {currentPage === 'toppings' && (
          <div className="page-slide">
            <ToppingsStation
              activeStep="toppings"
              order={currentOrder}
              incomingDrink={finishedDrink}
              onSendToFinal={setServedDrink}
              {...progressProps}
            />
          </div>
        )}
        {currentPage === 'final-combination' && (
          <div className="page-slide">
            <FinalCombination activeStep="final-combination" incomingDrink={servedDrink} {...progressProps} />
          </div>
        )}

        {/* Rendered once here rather than duplicated into every screen
            component above -- .page-container (see App.css) always sizes
            to exactly wrap whichever single screen is currently mounted
            (same fixed 1920x1080-aspect box that screen's own art/UI is
            positioned against), so anchoring this here with the same
            percentage convention every screen already uses for its own
            corner UI puts it in the upper-left corner of every frame for
            free, including the splash screen. */}
        <SettingsPanel
          containerRef={settingsRef}
          open={showSettings}
          onToggleOpen={toggleSettings}
          volume={musicVolume}
          onVolumeDown={decreaseMusicVolume}
          onVolumeUp={increaseMusicVolume}
        />
      </div>

      {showExitConfirm && (
        <div className="gl-exit-confirm-backdrop">
          <div className="gl-exit-confirm-dialog" ref={exitDialogRef}>
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

      {/* Rendered once here (not inside any per-page conditional) so it
          keeps looping across every screen/customer for the whole session --
          only closing the app stops it (there's no on/off toggle anymore,
          see the background-music effect above; the Settings panel's
          volume-down-to-0% covers that need). */}
      <audio ref={audioRef} src="./BackgroundMusic.mp3" loop preload="auto" />

      {/* Removable GameLoop V1 debug overlay — hidden for now (design work in
          progress). Uncomment to bring it back for validating appReady/
          adOpportunity/close/focusHost; the bridge and Back handling keep
          working either way. */}
      {/* <GameLoopAPIDebugOverlay /> */}
    </div>
  );
}

export default App;
