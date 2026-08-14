import { useEffect, useRef } from 'react';
import './SplashScreen.css';

// How long the splash waits before auto-advancing on its own, for anyone
// who doesn't press anything (no remote in hand yet, focus didn't land
// where expected on some odd platform, etc.) -- same "never leave the
// player stuck" reasoning as every other auto-timeout in this project
// (SYRUP_POUR_MS and friends), just for the one thing there is to do here:
// move on to the actual main menu.
const SPLASH_AUTO_DISMISS_MS = 4000;

// How many "cloud cafe" repeats fill the tiled background pattern (see
// .splash-pattern/.splash-pattern-item in SplashScreen.css) -- this is now
// the ONLY content on the screen (the old separate title lockup + its
// white backing card were removed per request), so it needs to be dense
// enough to read as a deliberate wallpaper-style wordmark, not a sparse
// scatter: 16 columns x 48 rows, oversized/rotated by that wrapper so the
// whole 16:9 canvas stays covered corner-to-corner even after the
// rotation, with each item's own text overflowing past its own narrow grid
// column (see that class's own comment) to actually overlap its
// neighbors -- that overlap is what gives the "stacked on one another"
// look per request.
//
// PATTERN_ROWS specifically needs to be tall enough that the grid's own
// rendered content actually fills .splash-pattern's full 160%-tall box --
// with too few rows, .splash-pattern's own `align-content: center` only
// fills a short band through the vertical middle of that (much taller) box
// and leaves the rest of it empty, which after the -18deg rotation shows
// up as a bare gradient strip above and below the (now diagonal) filled
// band instead of covering the whole screen edge-to-edge -- 48 is enough
// rows of ~36px-tall text + gap each to comfortably clear that box's own
// height at every supported viewport size. Just a plain numeric array
// mapped over below rather than hand-writing ~768 near-identical spans.
const PATTERN_COLUMNS = 16;
const PATTERN_ROWS = 48;
const PATTERN_ITEMS = Array.from({ length: PATTERN_COLUMNS * PATTERN_ROWS });

// First screen shown on load -- a brief, non-interactive branding beat (a
// tiled "cloud cafe" wordmark background, see PATTERN_ITEMS above) ahead
// of MainPage's own storefront/Start screen.
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
// before first paint), and the tiled "cloud cafe" wordmark background (see
// PATTERN_ITEMS/.splash-pattern below) is a fixed, static grid -- nothing
// on this screen animates per-item, only the shared container float below
// (that tenet is called out explicitly in this GS's tv-universal rule --
// "always animate the parent container, not each item").
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
        {/* Purely decorative background flourish -- replaces the old
            white-cloud shapes + bunny mascot per request: the whole screen
            now reads as a tiled "cloud cafe" wordmark pattern instead,
            rotated as one static group (see .splash-pattern's own comment
            in SplashScreen.css) rather than the mascot's old one-shot
            entrance. */}
        <div className="splash-pattern" aria-hidden="true">
          {PATTERN_ITEMS.map((_, index) => (
            <span className="splash-pattern-item" key={index}>
              cloud cafe
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;
