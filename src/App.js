import React, { useEffect, useRef, useState, Suspense, lazy } from 'react';
import './App.css';
// MatchaMaking.css and OrderReceiptButton.css are each shared across more
// than one of the five lazy-loaded station screens below (MatchaMaking.css:
// re-used, class-name-only, by MilkSelection.js and ToppingsStation.js;
// OrderReceiptButton.css: pulled in by the OrderReceiptButton component,
// itself imported from MatchaMaking.js, MilkSelection.js, AND
// ToppingsStation.js) -- if left to import only from within those
// individual lazy chunks, webpack's mini-css-extract-plugin can't find one
// consistent relative order across every possible combination of chunks
// that might end up loaded on the same page (it did find a genuinely
// unresolvable one here: "Conflicting order" between these two files,
// which react-scripts treats as a hard build failure rather than a warning
// under Vercel's CI=true). Importing both here instead -- in App.js, which
// is always eager, never code-split -- puts them in the one initial CSS
// bundle that loads before any lazy chunk possibly could, so there's only
// ever a single order to resolve. Removed from MatchaMaking.js's and
// OrderReceiptButton.js's own imports accordingly (see each file's own
// note) now that this is their one canonical load site.
import './components/MatchaMaking.css';
import './components/OrderReceiptButton.css';
// Same reasoning -- shared (class names only, no import) by ToppingsStation.js
// and FinalCombination.js as well as its own MilkSelection.js.
import './components/MilkSelection.css';
import SplashScreen from './components/SplashScreen';
import SettingsPanel from './components/SettingsPanel';
import MainPage from './components/MainPage';
import { PROGRESS_STEPS, ORDERS_PER_SESSION } from './components/ProgressBar';
// Debug overlay is currently unused (see the commented-out JSX below) --
// import left commented out too so CRA's CI lint pass (unused-import) doesn't
// fail the Vercel build. Uncomment both together to bring it back.
// import GameLoopAPIDebugOverlay from './gameloop/GameLoopAPIDebugOverlay';
import { getActionFromKeyEvent } from './gameloop/pal';
import { setSfxVolume } from './gameloop/sfx';
import { useFlatFocusNav } from './gameloop/useFlatFocusNav';
import {
  initGameLoopBridge,
  sendAppReady,
  sendClose,
  sendAdOpportunity,
  onAdMessage,
  hasSentAppReady,
  isEmbedded,
} from './gameloop/bridge';

// The five station screens are lazy-loaded (GameLoop CTV startup policy:
// "code-split initial route/screen; preload/prefetch only after shell is
// visible") -- each is 1,000-2,000+ lines and none of them are needed for
// first paint (Splash and Main, both still eager above, are). On a cold
// start this keeps the initial JS bundle to just what's needed to reach
// Play; each station's own chunk then downloads in the background while
// the player is still busy on the *previous* screen (React kicks off the
// fetch for a lazy component as soon as it's about to be rendered, i.e.
// the moment currentPage flips to it below -- by the time that screen's
// JSX actually needs to mount, the chunk has usually already arrived).
// See .route-loading in App.css for the brief-gap fallback UI, and each
// screen's own <Suspense> wrapper below.
const CustomerOrdering = lazy(() => import('./components/CustomerOrdering'));
const MatchaMaking = lazy(() => import('./components/MatchaMaking'));
const MilkSelection = lazy(() => import('./components/MilkSelection'));
const ToppingsStation = lazy(() => import('./components/ToppingsStation'));
const FinalCombination = lazy(() => import('./components/FinalCombination'));

// Same order as the ProgressBar's PROGRESS_STEPS, imported from the same
// place so the bar and this state machine can't drift apart.
const STEP_KEYS = PROGRESS_STEPS.map((step) => step.key);
// How much each press of the Settings panel's volume +/- buttons changes
// musicVolume by -- 10 presses from empty reaches full volume.
const VOLUME_STEP = 0.1;

// Shared Suspense fallback for the five lazy station screens above -- a
// static, dependency-free element (module scope, not recreated per render)
// wrapped in its own .page-slide the same way every real screen below is,
// so it sits in exactly the same slot with no layout shift when the real
// screen's chunk finishes loading and swaps in. See .route-loading in
// App.css for the actual look.
const routeLoadingFallback = (
  <div className="page-slide">
    <div className="route-loading" aria-hidden="true">
      <div className="route-loading-dots">
        <span />
        <span />
        <span />
      </div>
    </div>
  </div>
);

function App() {
  // Splash is the very first thing shown, ahead of MainPage's own
  // storefront/Start screen -- see the big comment in SplashScreen.js for
  // why this doesn't change anything about appReady timing (still fires on
  // mount regardless of which page is showing) or the PREROLL ad-timing
  // note in the messaging guide (MainPage's Play button is still the real
  // "start screen" that gates that, unaffected by this beat coming before
  // it).
  const [currentPage, setCurrentPage] = useState('splash');
  // Which customer (1-ORDERS_PER_SESSION) the player is currently serving
  // this session.
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
  // Per-category score results for the round's score card (see ScoreCard.js
  // and gameloop/scoring.js) -- each null until the station that produces it
  // hands it off (CustomerOrdering's placeOrder, MatchaMaking's
  // beginBowlCarry, MilkSelection's beginSendDrink, ToppingsStation's
  // beginSendToFinal, in that order), same lift-it-up-through-a-callback
  // shape as currentOrder/matchaBowl/finishedDrink/servedDrink above. Reset
  // to null in the exact same places those are, for the same reason -- a
  // new customer's round should never show the previous customer's scores
  // while it's still in progress.
  const [orderTakingScore, setOrderTakingScore] = useState(null);
  const [matchaScore, setMatchaScore] = useState(null);
  const [mixingScore, setMixingScore] = useState(null);
  const [toppingsScore, setToppingsScore] = useState(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  // Whether an adOpportunity is currently in flight (sent, not yet resolved
  // by ads.completed/ads.skipped) -- per GameLoop's ad policy, adOpportunity
  // is a BLOCKING contract: once sent, progression must wait for one of
  // those two release signals. Drives both the visual curtain below and the
  // disabled state on whichever button would otherwise let the player
  // advance past it (MainPage's Play button for PREROLL, FinalCombination's
  // "Start order N+1" button for the between-order ad). Armed only when
  // actually embedded (see embeddedRef below) -- the standalone exemption
  // means there's no host to ever resolve it outside a real iframe.
  const [adGate, setAdGate] = useState(false);
  // Captured once at mount -- window.parent doesn't change over the app's
  // lifetime, so there's no need to recompute this on every ad request.
  const embeddedRef = useRef(isEmbedded());
  // Deferred continuation for whichever adOpportunity is currently gating
  // (see requestAd below) -- run once, the moment adGate clears, then
  // cleared back to null. null means "nothing to do when this ad resolves"
  // (the between-order ad's own button click already IS the deferred
  // action's trigger point, so its own requestAd call passes the real
  // continuation; PREROLL's requestAd call is the only other caller today).
  const pendingAfterAdRef = useRef(null);
  // Background music -- one <audio> element rendered once here (outside the
  // per-page conditionals below) so it survives every page navigation and
  // just keeps looping until the tab/app itself closes. There's no on/off
  // toggle anymore (the old MainPage mute button was removed once the
  // Settings panel's volume control shipped -- turning musicVolume down to
  // 0% covers the same need); this always tries to play.
  // Music volume (0-1), adjustable from the Settings panel's up/down
  // buttons (VOLUME_STEP, in SettingsPanel.js) -- starts at 30% per
  // request (soundVolume below keeps its own separate 50% default).
  const [musicVolume, setMusicVolume] = useState(0.3);
  // Sound volume (0-1) -- covers every one-shot SFX/voice clip played
  // through gameloop/sfx.js (button clicks today; the character ordering
  // voice line; whatever else gets added there later), as a control
  // separate from musicVolume above so a player can turn one down without
  // the other. Same default/step/rounding treatment as musicVolume. Not an
  // <audio> element's own .volume like music is -- sfx.js has no
  // persistent element to set, so this is synced out to it imperatively
  // (see the effect below) any time it changes instead.
  const [soundVolume, setSoundVolume] = useState(0.5);
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
  // Highest STEP_KEYS index reached so far *this round* -- once a station
  // is left behind for a later one, per request it should be locked: no
  // more going back to it, by any path (ProgressBar's own Left-arrow/dot
  // navigation, or the Backspace/Back key below). -1 until the player
  // actually reaches 'ordering' (STEP_KEYS' own index 0), so nothing is
  // considered "locked" yet on the splash/main screens. Bumped up (never
  // down) below on every render while currentPage is a real station --
  // Math.max against its own previous value makes this safe to recompute
  // on every render (including React.StrictMode's double-invocation)
  // without any special-casing. Explicitly reset back to -1 in
  // handlePlayClick and handleAdvance's "next customer" branch below,
  // *before* the state update that starts a fresh round at 'ordering' --
  // otherwise a new customer's stations would stay artificially locked
  // from the previous one's progress.
  const maxStepIndexRef = useRef(-1);
  const currentStepIndexForLock = STEP_KEYS.indexOf(currentPage);
  if (currentStepIndexForLock !== -1) {
    maxStepIndexRef.current = Math.max(maxStepIndexRef.current, currentStepIndexForLock);
  }
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
  // down) rather than duplicated into every screen. Its own internal
  // keyboard navigation (gear <-> the two volume rows) is handled by a
  // dedicated, exact button-to-button keydown handler inside
  // SettingsPanel.js itself now, rather than the generic spatial
  // useFlatFocusNav hook every screen's own container uses -- the
  // requested nav graph (e.g. "Down from either music button always lands
  // on sound minus, never sound plus") isn't what nearest-neighbor spatial
  // matching would produce on its own, so this needed its own precise
  // logic instead. settingsRef here is just a plain DOM ref for
  // SettingsPanel's outer anchor div now (no hook attached to it).
  const settingsRef = useRef(null);

  // ---- GameLoop V1 bridge setup -------------------------------------------
  useEffect(() => {
    initGameLoopBridge();
    // Hands off from index.html's own inline pre-splash (see that file's
    // big comment on #pre-splash) to this real, React-rendered SplashScreen
    // -- both use the exact same gradient, so this removal is invisible.
    // Runs unconditionally on every mount (there's only ever one App mount
    // per page load), same "fires the instant there's ANY presentable UI"
    // timing sendAppReady below already relies on.
    document.getElementById('pre-splash')?.remove();
    // SplashScreen is the first screen now (see currentPage's own initial
    // value above) and is already painted by the time this effect runs --
    // this effect doesn't depend on currentPage at all, so it fires the
    // instant there's ANY presentable UI on screen, satisfying "appReady
    // once first presentable UI is shown, even a loading/splash screen"
    // (see the messaging guide) regardless of which page that turns out to
    // be.
    sendAppReady();

    // ads.completed / ads.skipped are the ONLY two release signals for the
    // blocking adGate (see its own comment above) -- ads.started/
    // inProgress are informational only and must never clear it (per
    // gameloop-html5-tv.mdc "Ad policy"; inProgress is also spec-marked
    // "future release" and not currently emitted by the production
    // launcher, so this deliberately does not branch on it at all). No
    // game-side resolution watchdog/timeout either -- a self-release here
    // would race the host, which is the one place failure handling
    // (no-fill, playback error) is actually owned.
    const unsubscribe = onAdMessage((message) => {
      if (message !== 'ads.completed' && message !== 'ads.skipped') return;
      setAdGate(false);
      const runAfterAd = pendingAfterAdRef.current;
      pendingAfterAdRef.current = null;
      runAfterAd?.();
    });
    return unsubscribe;
  }, []);

  // Sends a blocking adOpportunity and arms adGate, deferring `onResolved`
  // (if given) until the host actually releases it via ads.completed/
  // ads.skipped (see the onAdMessage handler above). Standalone exemption
  // (gameloop-html5-tv.mdc "Ad policy"): when there's no host to ever
  // resolve the request (embeddedRef.current is false -- e.g. `npm start`
  // opened directly in a tab, or the game running outside any iframe),
  // this suppresses the send entirely and runs onResolved immediately
  // instead of arming a gate nothing will ever clear.
  const requestAd = (reason, onResolved) => {
    if (!embeddedRef.current) {
      onResolved?.();
      return;
    }
    sendAdOpportunity(reason);
    pendingAfterAdRef.current = onResolved ?? null;
    setAdGate(true);
  };

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

  // Keeps gameloop/sfx.js's own module-level sfxVolume in sync with
  // soundVolume -- same idea as the effect just above, just imperative
  // (setSfxVolume(...) rather than an <audio> ref's .volume) since sfx.js's
  // one-shot clips don't have a single persistent element to set volume on
  // the way background music does. Runs on mount too, so the very first
  // button click/voice line already uses the right volume instead of
  // sfx.js's own default.
  useEffect(() => {
    setSfxVolume(soundVolume);
  }, [soundVolume]);

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
  const stepSoundVolume = (delta) => {
    setSoundVolume((v) => Math.round(Math.min(1, Math.max(0, v + delta)) * 10) / 10);
  };
  const decreaseSoundVolume = () => stepSoundVolume(-VOLUME_STEP);
  const increaseSoundVolume = () => stepSoundVolume(VOLUME_STEP);
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

  // ---- Lock input to arrow keys / Enter / Backspace only -------------------
  // Per request: no other key should do anything. pal.js's own
  // KEYCODE_TO_ACTION already stops treating Space as Enter (see its own
  // comment), which handles every screen's *custom* action-based
  // handlers -- but real <button> elements (Start, the settings gear, the
  // volume +/-, ProgressBar's dots, etc.) still activate on Space by
  // default via the browser's own native behavior, completely independent
  // of pal.js's map, and Tab still cycles focus via the browser's own
  // native tab order, independent of the D-pad nav effects every screen
  // builds. Both need to be preventDefault'd directly to actually stop.
  // Registered with { capture: true } so it runs in the capture phase,
  // before the event even reaches its target (let alone any bubble-phase
  // listener, including every screen's own keydown effects and the Back
  // handler right below) -- guaranteeing Space/Tab never reach a native
  // element's default activation/focus-shift behavior no matter which
  // screen is mounted. Only ever calls preventDefault, never
  // stopPropagation, so it doesn't interfere with any other handler still
  // wanting to see (and ignore) the same event.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.keyCode === 32 || e.keyCode === 9) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

  // ---- Back key policy (single PAL-driven path) ---------------------------
  // Per request, Back/Backspace no longer does any in-game step navigation
  // at all -- it's exclusively the "would you like to exit?" gesture now,
  // from every screen (previously it walked one step back through
  // STEP_KEYS from most screens, only asking to exit from the main menu).
  // Station-to-station backward navigation still lives entirely on the
  // ProgressBar (jumping to any already-completed step's dot) -- this key
  // no longer offers a shortcut for that. showExitConfirm/showSettings
  // still get their own dedicated Back handling first (cancel the dialog /
  // close the popover, same as before) since those are momentary overlays,
  // not steps in the game itself, and Splash still just skips straight to
  // Main the same way the start button/auto-timeout do (nothing to
  // meaningfully "exit" from a loading beat that isn't really loading
  // anything -- see SplashScreen.js).
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
      if (currentPageRef.current === 'splash') {
        setCurrentPage('main');
        return;
      }
      setShowExitConfirm(true);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExitConfirm, showSettings]);

  const handleSplashDismiss = () => {
    setCurrentPage('main');
  };

  // Actually starts a fresh session at order 1 -- split out from
  // handlePlayClick below so it can run either immediately (standalone) or
  // as the deferred continuation of the PREROLL adOpportunity (embedded).
  const startNewSession = () => {
    // Fresh round -- reset the lock too (see maxStepIndexRef's own comment
    // above), before setCurrentPage below actually lands on 'ordering', so
    // this customer's stations don't start out already locked from
    // whatever the previous customer reached.
    maxStepIndexRef.current = -1;
    setCustomerNumber(1);
    setCurrentOrder(null);
    setMatchaBowl(null);
    setFinishedDrink(null);
    setServedDrink(null);
    setOrderTakingScore(null);
    setMatchaScore(null);
    setMixingScore(null);
    setToppingsScore(null);
    setCurrentPage('ordering');
  };

  // MainPage's Play button IS the "start screen" the GameLoop ad policy
  // means by "fire PREROLL only after any splash/start-screen has been
  // shown and dismissed, immediately before gameplay actually begins" --
  // SplashScreen (the earlier, auto-dismissing loading beat) is unaffected,
  // see its own comment on currentPage's initial value above. Fires once
  // per session start (i.e. again each time the player returns to the main
  // menu and presses Play again, not just once for the whole iframe load --
  // unlike appReady, PREROLL has no emit-once requirement). requestAd
  // itself handles the embedded/standalone split and defers startNewSession
  // until the host actually resolves the ad (or runs it immediately if
  // there's no host to resolve it at all). Guarded against re-entry so a
  // second Enter/click on an already-disabled-but-not-yet-re-rendered Play
  // button can't fire two PREROLL requests back to back.
  const handlePlayClick = () => {
    if (adGate) return;
    requestAd('PREROLL', startNewSession);
  };

  // Per request: the next station is locked until the current one's own
  // task is actually done, not just "the player pressed the advance
  // gesture" -- each case below is the same carried-over-item state
  // App.js already tracks for that station's own screen (see each one's
  // own useState comment above): CustomerOrdering's "Place Order" button
  // (currentOrder), then each later station's own "carry the bowl/cup to
  // the lower-right corner" drop-zone (matchaBowl/finishedDrink/
  // servedDrink). Not a switch on customerNumber or anything time-based --
  // literally "has that station's own onSendTo*/onPlaceOrder callback
  // actually fired yet this round." final-combination (and any other page
  // that isn't one of these four) falls through to the default `true` --
  // that screen already gates its own advance gesture separately via
  // hasNextOrder/disableAdvance (see FinalCombination.js), it doesn't need
  // a second gate here.
  const canAdvanceFromCurrentStep = () => {
    switch (currentPage) {
      case 'ordering':
        return currentOrder !== null;
      case 'matcha-making':
        return matchaBowl !== null;
      case 'milk-selection':
        return finishedDrink !== null;
      case 'toppings':
        return servedDrink !== null;
      default:
        return true;
    }
  };

  // Progress bar: clicking any step other than the current one jumps
  // straight there -- but only ever backward, to an already-visited
  // station (per request never backward past whichever station's already
  // been left behind for a later one either -- see maxStepIndexRef's own
  // comment above). Moving FORWARD is exclusively handleAdvance's job now
  // (see its own task-completion gate below, canAdvanceFromCurrentStep) --
  // blocking any targetIndex ahead of the current step here too closes the
  // same "skip a station without doing anything" gap on this path as well,
  // in case a future dot is ever reachable some way other than the
  // Right-arrow/current-dot gesture (both of which go through handleAdvance,
  // not this function) -- ProgressBar's dot-click and its own Left-arrow
  // handler (onNavigate(PROGRESS_STEPS[activeIndex - 1].key)) both call
  // this, so locking it here alone covers every path into this function.
  const navigateTo = (pageKey) => {
    const targetIndex = STEP_KEYS.indexOf(pageKey);
    if (targetIndex === -1) return;
    if (targetIndex < maxStepIndexRef.current || targetIndex > currentStepIndexForLock) return;
    setCurrentPage(pageKey);
  };

  // Progress bar: clicking the CURRENT step means "I'm done here" -- advance
  // to the next step, or, from the last step (Serve), complete this
  // customer's order and either start the next one or head back to the
  // main menu once all 3 are done. Gated on canAdvanceFromCurrentStep --
  // per request, the next station is locked until the current one's own
  // task is actually done (placing the order / carrying the bowl-or-cup to
  // the lower-right corner), not just available on demand.
  const handleAdvance = () => {
    const idx = STEP_KEYS.indexOf(currentPage);
    if (idx === -1) return;
    if (!canAdvanceFromCurrentStep()) return;
    if (idx < STEP_KEYS.length - 1) {
      setCurrentPage(STEP_KEYS[idx + 1]);
      return;
    }
    if (customerNumber < ORDERS_PER_SESSION) {
      // Next customer, fresh round -- reset the lock (see maxStepIndexRef's
      // own comment above) before setCurrentPage below lands back on
      // 'ordering', same reasoning as handlePlayClick's own reset.
      maxStepIndexRef.current = -1;
      setCustomerNumber((n) => n + 1);
      setCurrentOrder(null);
      setMatchaBowl(null);
      setFinishedDrink(null);
      setServedDrink(null);
      setOrderTakingScore(null);
      setMatchaScore(null);
      setMixingScore(null);
      setToppingsScore(null);
      setCurrentPage('ordering');
    } else {
      setCustomerNumber(1);
      setCurrentOrder(null);
      setMatchaBowl(null);
      setFinishedDrink(null);
      setServedDrink(null);
      setOrderTakingScore(null);
      setMatchaScore(null);
      setMixingScore(null);
      setToppingsScore(null);
      // No ad on the final order's own return to the main menu -- per
      // product decision, this session's ad breaks are exactly PREROLL (on
      // Play) plus one between each pair of consecutive orders (see
      // FinalCombination's own onStartNextOrder/adGate props below), which
      // is ORDERS_PER_SESSION - 1 of them. The final order's completion is
      // the end of the session, not a boundary between two orders, so
      // nothing fires here.
      setCurrentPage('main');
    }
  };

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
    <div className={`App${adGate ? ' gl-ad-playing' : ''}`}>
      <div className={`page-container ${currentPage}`}>
        {currentPage === 'splash' && (
          <div className="page-slide">
            <SplashScreen onDismiss={handleSplashDismiss} />
          </div>
        )}
        {currentPage === 'main' && (
          <div className="page-slide">
            {/* disabled while adGate is true so a held-Enter/double-click
                during the PREROLL ad's own blocking window can't fire a
                second adOpportunity before the first has resolved -- see
                handlePlayClick's own re-entry guard, which this backs up
                at the DOM level (a disabled button can't receive Enter/
                click at all, see MainPage.js). */}
            <MainPage onPlayClick={handlePlayClick} disabled={adGate} />
          </div>
        )}
        {currentPage === 'ordering' && (
          <Suspense fallback={routeLoadingFallback}>
            <div className="page-slide">
              <CustomerOrdering
                activeStep="ordering"
                onPlaceOrder={setCurrentOrder}
                onOrderScored={setOrderTakingScore}
                {...progressProps}
              />
            </div>
          </Suspense>
        )}
        {currentPage === 'matcha-making' && (
          <Suspense fallback={routeLoadingFallback}>
            <div className="page-slide">
              <MatchaMaking
                activeStep="matcha-making"
                order={currentOrder}
                onSendToMilk={setMatchaBowl}
                onScored={setMatchaScore}
                {...progressProps}
              />
            </div>
          </Suspense>
        )}
        {currentPage === 'milk-selection' && (
          <Suspense fallback={routeLoadingFallback}>
            <div className="page-slide">
              <MilkSelection
                activeStep="milk-selection"
                order={currentOrder}
                incomingBowl={matchaBowl}
                onSendToToppings={setFinishedDrink}
                onScored={setMixingScore}
                {...progressProps}
              />
            </div>
          </Suspense>
        )}
        {currentPage === 'toppings' && (
          <Suspense fallback={routeLoadingFallback}>
            <div className="page-slide">
              <ToppingsStation
                activeStep="toppings"
                order={currentOrder}
                incomingDrink={finishedDrink}
                onSendToFinal={setServedDrink}
                onScored={setToppingsScore}
                {...progressProps}
              />
            </div>
          </Suspense>
        )}
        {currentPage === 'final-combination' && (
          <Suspense fallback={routeLoadingFallback}>
            <div className="page-slide">
              <FinalCombination
                activeStep="final-combination"
                order={currentOrder}
                incomingDrink={servedDrink}
                hasNextOrder={customerNumber < ORDERS_PER_SESSION}
                orderTakingScore={orderTakingScore}
                matchaScore={matchaScore}
                mixingScore={mixingScore}
                toppingsScore={toppingsScore}
                // Between-order adOpportunity: FinalCombination's own dwell
                // timer (see that file) waits out the score/sticker reveal
                // before ever letting this fire, then this requests the ad
                // and only actually advances (handleAdvance) once it
                // resolves -- same requestAd/deferred-continuation shape as
                // PREROLL above, just triggered by this screen's own button
                // instead of Play. Only meaningful while hasNextOrder is
                // true; unused (never called) on the final order, which has
                // no "Start order N+1" button at all (see hasNextOrder
                // above).
                adGate={adGate}
                onStartNextOrder={() => requestAd('ORDER_COMPLETE', handleAdvance)}
                {...progressProps}
              />
            </div>
          </Suspense>
        )}

        {/* Rendered once here rather than duplicated into every screen
            component above -- .page-container (see App.css) always sizes
            to exactly wrap whichever single screen is currently mounted
            (same fixed 1920x1080-aspect box that screen's own art/UI is
            positioned against), so anchoring this here with the same
            percentage convention every screen already uses for its own
            corner UI puts it in the upper-left corner of every frame for
            free. Skipped during the splash screen specifically (per
            request) -- there's nothing to configure yet at that beat, and
            SplashScreen's own Back-to-skip/auto-dismiss timer is the only
            input that screen needs. (currentPage never transitions back to
            'splash' once left -- see currentPage's own useState above and
            every place that sets it -- so there's no case where a
            previously-opened popover would need to be force-closed here.) */}
        {currentPage !== 'splash' && (
          <SettingsPanel
            containerRef={settingsRef}
            open={showSettings}
            onToggleOpen={toggleSettings}
            volume={musicVolume}
            onVolumeDown={decreaseMusicVolume}
            onVolumeUp={increaseMusicVolume}
            soundVolume={soundVolume}
            onSoundVolumeDown={decreaseSoundVolume}
            onSoundVolumeUp={increaseSoundVolume}
          />
        )}
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

      {/* Up for the entire blocking window (from the moment adOpportunity
          is sent until ads.completed/ads.skipped resolves it), not just
          while the host has confirmed an ad is actually rendering
          (ads.started) -- see adGate's own comment above for why: the gap
          between "request sent" and "ads.started arrives" still needs to
          read as "please wait", not as a dead, clickable screen. */}
      {adGate && <div className="gl-ad-curtain">Ad playing…</div>}

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
