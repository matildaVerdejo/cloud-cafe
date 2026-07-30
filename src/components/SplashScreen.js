import React, { useEffect, useRef } from 'react';
import './SplashScreen.css';

// How long the splash waits before auto-advancing on its own, for anyone
// who doesn't press anything (no remote in hand yet, focus didn't land
// where expected on some odd platform, etc.) -- same "never leave the
// player stuck" reasoning as every other auto-timeout in this project
// (SYRUP_POUR_MS and friends), just for the one thing there is to do here:
// move on to the actual main menu.
const SPLASH_AUTO_DISMISS_MS = 4000;

// First screen shown on load -- a brief, non-interactive branding beat
// (title lockup + mascot) ahead of MainPage's own storefront/Start screen.
// This is deliberately NOT the "start screen" the GameLoop messaging
// contract means by that phrase (see docs/GameLoop/publisher-messaging-api-guide.md
// and docs/game-planning/publisher-quickstart.md's own PREROLL timing note,
// "fire only after any splash/start-screen has been shown and dismissed")
// -- MainPage (with its own Play button) is still the actual start screen;
// this is the beat before it. appReady is unaffected either way -- App.js's
// own bridge-init effect fires on mount regardless of which page happens to
// be showing first, so it still goes out the instant this (now the actual
// first-painted UI) appears, same "send it the moment there's ANY
// presentable UI, even a loading/splash screen" rule the messaging guide
// states explicitly.
//
// Kept deliberately cheap: a CSS gradient (no background image to decode
// before first paint), one shared drift animation on the decorative cloud
// layer as a group rather than animating each cloud individually (that
// tenet is called out explicitly in this GS's tv-universal rule -- "always
// animate the parent container, not each item"), and a single one-shot
// entrance animation on the mascot rather than a continuous per-item
// bounce loop.
const SplashScreen = ({ onDismiss }) => {
  const dismissedRef = useRef(false);

  const dismiss = () => {
    if (dismissedRef.current) return; // guards the auto-timeout firing after a manual dismiss already happened
    dismissedRef.current = true;
    onDismiss?.();
  };

  useEffect(() => {
    const t = setTimeout(dismiss, SPLASH_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="splash-container">
      <h1 className="sr-only">Cloud Cafe</h1>

      <div className="splash-content">
        {/* Purely decorative background flourish -- animated as one group
            (see the big comment above) rather than per-cloud. */}
        <div className="splash-clouds" aria-hidden="true">
          <span className="splash-cloud splash-cloud-1" />
          <span className="splash-cloud splash-cloud-2" />
          <span className="splash-cloud splash-cloud-3" />
        </div>

        <img src="./BunnyFace.png" alt="" aria-hidden="true" className="splash-mascot" />

        <div className="splash-title" aria-hidden="true">
          cloud cafe
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;
