import { useEffect, useRef } from 'react';
import './MainPage.css';
import { playButtonClick } from '../gameloop/sfx';
import { getActionFromKeyEvent } from '../gameloop/pal';

// Two Play buttons now instead of one -- "training day" starts a session
// exactly like the game always has (walkthrough on order 1, orders 2-5
// normal), "i'm trained" starts the same five-order session but skips the
// walkthrough entirely, playing order 1 like every other order (see
// App.js's own trainingMode state/isWalkthrough prop, and
// CustomerOrdering.js's big comment on isWalkthrough for how every station
// screen actually reads this). onPlayClick is called with which one was
// pressed ('training' | 'trained') so App.js's handlePlayClick can set
// trainingMode before starting the session.
const MainPage = ({ onPlayClick, disabled = false }) => {
  const trainingButtonRef = useRef(null);
  const trainedButtonRef = useRef(null);
  // Tracks whichever of the two Play buttons most recently had focus, so
  // Down/Right from the Settings gear (see the keydown handler below) can
  // send focus back to the right one instead of always snapping to
  // "training day" regardless of where the player actually came from.
  // Defaults to the training button, which is also the one autoFocused on
  // mount below.
  const lastFocusedButtonRef = useRef(null);

  // Up/Left from the training (left) button, and Up/Right from the trained
  // (right) button, jump to the Settings gear -- same "either direction
  // works" redundancy the original single-button version had (per
  // request), just split across the two new outer edges instead of both
  // pointing off the one button. Left/Right between the two buttons moves
  // between them directly. Down/Right from the gear jumps back to
  // whichever button was last focused (lastFocusedButtonRef above) -- the
  // reverse trip, same as the original single-button version's "Down/Right:
  // Settings gear -> back to Start."
  //
  // This screen only ever has these three focusable elements (the two Play
  // buttons here, plus the Settings gear/popover living in its own
  // separate useFlatFocusNav scope in App.js -- see settingsRef there,
  // which only manages movement *within* that widget, not into/out of it).
  // This is a small, deliberately scoped bridge between just these
  // elements for this one screen, rather than merging the two hooks'
  // scopes globally -- keeping each frame's keyboard wiring self-contained
  // and checked in one at a time, per request. Reaches for
  // .settings-toggle-button by class (it's rendered once, App-wide) since
  // there's no prop path from here to SettingsPanel.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Up' && action !== 'Down' && action !== 'Left' && action !== 'Right') return;
      const gearButton = document.querySelector('.settings-toggle-button');
      const active = document.activeElement;

      // Left/Right directly between the two buttons.
      if (action === 'Right' && active === trainingButtonRef.current) {
        e.preventDefault();
        trainedButtonRef.current?.focus();
        return;
      }
      if (action === 'Left' && active === trainedButtonRef.current) {
        e.preventDefault();
        trainingButtonRef.current?.focus();
        return;
      }

      // Either button's own OUTER edge (Up from both, Left from training,
      // Right from trained) -> the Settings gear.
      const atOuterEdge =
        (active === trainingButtonRef.current && (action === 'Up' || action === 'Left')) ||
        (active === trainedButtonRef.current && (action === 'Up' || action === 'Right'));
      if (atOuterEdge) {
        if (!gearButton) return;
        e.preventDefault();
        gearButton.focus();
        return;
      }

      // Down/Right: Settings gear -> back to whichever button was last
      // focused. Only handled when the gear button itself (not something
      // inside its popover) is focused, and only when the popover is
      // actually closed -- when it's open, Down from the gear button
      // should instead move into the popover's own first control, which
      // the settings widget's own useFlatFocusNav scope (settingsRef in
      // App.js) already handles on its own; stepping in here too would
      // fight that. Right isn't wired to anything inside the popover, so
      // it's always safe to send straight back regardless of whether the
      // popover is open.
      if ((action === 'Down' || action === 'Right') && gearButton && active === gearButton) {
        const popoverOpen = !!document.querySelector('.settings-popover');
        if (action === 'Down' && popoverOpen) return;
        e.preventDefault();
        (lastFocusedButtonRef.current || trainingButtonRef.current)?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const startSession = (mode) => {
    playButtonClick();
    onPlayClick?.(mode);
  };

  return (
    <div className="main-container">
      {/* Visually hidden; the storefront art below already shows the "Cloud
          Cafe" sign, this just keeps the page title available to screen
          readers / the document outline. */}
      <h1 className="sr-only">Cloud Cafe</h1>

      <div className="main-content">
        <img
          src="./CloudCafeHome.jpg"
          alt="Cloud Cafe storefront"
          className="home-art"
        />
        {/* Two buttons side by side, positioned over the same "PLAY" sign
            spot the single Start button used to occupy (see MainPage.css) --
            percentage-based so they stay aligned with the art at any render
            size. Training day is already focused on mount (autoFocus) so
            Enter works immediately without requiring an arrow-key press
            first -- native <button> behavior already fires this same
            onClick on Enter/Space with no extra JS needed. */}
        <button
          ref={trainingButtonRef}
          type="button"
          className="play-button play-button-training"
          data-focusable
          autoFocus
          disabled={disabled}
          onFocus={() => {
            lastFocusedButtonRef.current = trainingButtonRef.current;
          }}
          onClick={() => startSession('training')}
        >
          training day
        </button>
        <button
          ref={trainedButtonRef}
          type="button"
          className="play-button play-button-trained"
          data-focusable
          disabled={disabled}
          onFocus={() => {
            lastFocusedButtonRef.current = trainedButtonRef.current;
          }}
          onClick={() => startSession('trained')}
        >
          i'm trained
        </button>
      </div>
    </div>
  );
};

export default MainPage;
