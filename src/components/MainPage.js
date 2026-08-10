import React, { useEffect, useRef } from 'react';
import './MainPage.css';
import { playButtonClick } from '../gameloop/sfx';
import { getActionFromKeyEvent } from '../gameloop/pal';

const MainPage = ({ onPlayClick, disabled = false }) => {
  const playButtonRef = useRef(null);

  // Up/Left: Start -> Settings gear. Down/Right: Settings gear -> back to
  // Start. Both directions work for either arrow pair (per request) -- this
  // screen only has the one focusable element (the Start button, autoFocused
  // below), so there's nothing for the shared useFlatFocusNav spatial-nav
  // hook (used by the station screens) to route between within this
  // screen's own container -- and the Settings gear/popover live in their
  // own separate useFlatFocusNav scope in App.js (settingsRef), which only
  // manages movement *within* that widget, not into/out of it (see the big
  // comment on settingsRef there). This is a small, deliberately scoped
  // bridge between just these two elements for this one screen, rather than
  // merging the two hooks' scopes globally -- keeping each frame's keyboard
  // wiring self-contained and checked in one at a time, per request.
  // Reaches for .settings-toggle-button by class (it's rendered once,
  // App-wide) since there's no prop path from here to SettingsPanel.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Up' && action !== 'Down' && action !== 'Left' && action !== 'Right') return;
      const gearButton = document.querySelector('.settings-toggle-button');

      if ((action === 'Up' || action === 'Left') && document.activeElement === playButtonRef.current) {
        if (!gearButton) return;
        e.preventDefault();
        gearButton.focus();
        return;
      }

      // Down/Right: Settings gear -> back to Start, the reverse trip. Only
      // handled when the gear button itself (not something inside its
      // popover) is focused, and only when the popover is actually closed
      // -- when it's open, Down from the gear button should instead move
      // into the popover's own first control, which the settings widget's
      // own useFlatFocusNav scope (settingsRef in App.js) already handles
      // on its own; stepping in here too would fight that. Right isn't
      // wired to anything inside the popover, so it's always safe to send
      // straight back to Start regardless of whether the popover is open.
      if ((action === 'Down' || action === 'Right') && gearButton && document.activeElement === gearButton) {
        const popoverOpen = !!document.querySelector('.settings-popover');
        if (action === 'Down' && popoverOpen) return;
        e.preventDefault();
        playButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
        {/* Visible button positioned over the "PLAY" sign drawn onto the
            door art (see MainPage.css). Styled to match the Back button on
            the Customer Ordering screen. Percentage-based so it stays
            aligned with the art at any render size. Already focused on
            mount (autoFocus) so Enter works immediately without requiring
            an arrow-key press first -- native <button> behavior already
            fires this same onClick on Enter/Space with no extra JS needed. */}
        <button
          ref={playButtonRef}
          type="button"
          className="play-button"
          data-focusable
          autoFocus
          disabled={disabled}
          onClick={() => {
            playButtonClick();
            onPlayClick?.();
          }}
        >
          start
        </button>
      </div>
    </div>
  );
};

export default MainPage;
