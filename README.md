# Cloud Cafe

A React application that guides users through the process of making matcha tea.

## Features

- **Main Page**: Features the "Cloud Cafe" title with a play button to start the process
- **Matcha Making Process**: Step-by-step guide with interactive elements
- **Animations**: Smooth transitions and hover effects
- **Progress Tracking**: Visual progress indicator showing completion status

## How to Use

1. Start the development server:
   ```bash
   npm start
   ```

2. Click the "Play" button on the main page to begin the matcha making process

3. Follow the step-by-step instructions:
   - Click on each step to complete it
   - Use the "Next Step" button to proceed
   - Track your progress with the progress bar

## Image Assets

The app expects the following images in the `public` folder:
- `Matcha1.png` - Background image for main page
- `Play.png` - Play button image
- `MatchaMake.png` - Matcha powder step
- `Whisk.png` - Whisking step
- `Bowl.png` - Bowl preparation step
- `HotWater.png` - Hot water step
- `ready.png` - Final ready step

## Styling

The app uses the Pixelify Sans font and follows the specified design:
- Main container: 1024px × 1366px with #FEFFE9 background
- Green color scheme (#1E2E10, #295105)
- Responsive design with hover effects and animations
## GameLoop integration

This app is grafted to run as a GameLoop CTV Publisher game (runs inside a
nested iframe in the GameLoop launcher, talks to the host via
`window.parent.postMessage`). The existing React/CRA architecture and toolchain
are unchanged — GameLoop scaffolding was added alongside it:

- `src/gameloop/bridge.js` — V1 messaging: `appReady` (sent once the main
  screen paints), `close` (top-level exit), `adOpportunity` (see "Ad breaks"
  below), and the inbound `adMessage` ad-lifecycle listener. Reads the six
  GameLoop query parameters (`playerId`, `sessionId`, `platform`, `marketId`,
  `app_id`, `glQrURL`) at startup.
- `src/gameloop/pal.js` — keycode → logical action (`Up`/`Down`/`Left`/
  `Right`/`Enter`/`Back`) so no component hardcodes raw keycodes.
- `src/gameloop/useFlatFocusNav.js` — D-pad/remote focus navigation for each
  screen (native `<button>` elements handle Enter/Space activation).
- `src/gameloop/GameLoopAPIDebugOverlay.js` — removable, D-pad-navigable
  debug panel for exercising `adOpportunity`, `focusHost`, and `close`. Hide
  it by commenting out the `<GameLoopAPIDebugOverlay />` line in `App.js`;
  the bridge and Back handling keep working either way.
- Back key policy: Back on any sub-screen retraces to the previous step
  (same as the existing "Back to ..." buttons); Back on the main menu opens
  an exit confirmation and sends `close` on confirm.

### Ad breaks

A session is 7 orders (`ORDERS_PER_SESSION` in `src/components/ProgressBar.js`).
`adOpportunity` fires twice per boundary:

- **`PREROLL`** — once each time Play is pressed on the main menu, before
  the first order's ordering screen actually opens.
- **`ORDER_COMPLETE`** — once between each pair of consecutive orders (6
  times per full session), fired from the "Start order N+1" button on the
  Serve screen. The button stays disabled until the score/sticker reveal
  has fully played out (required outcome-comprehension dwell) and, once
  pressed, until the ad itself resolves.

No ad fires after the 7th order — it returns straight to the main menu.
Both requests are **blocking**: `App.js`'s `adGate` state disables the
triggering button and shows a curtain from the moment the request is sent
until GameLoop resolves it with `ads.completed` or `ads.skipped`; there is
no gate in a standalone tab (`npm start` opened directly, no host to
resolve the request).

### Testing in the GameLoop mock host

A lightweight dev harness lives in `public/mockhost/` (plain JS, no extra
build step — served by the same CRA dev server as the app, so it shares an
origin with the game for `postMessage`).

```bash
npm start
```

Then open **http://localhost:3000/mockhost/index.html**. It loads the game
in a scaled iframe, auto-injects the six GameLoop query parameters, and
provides D-pad-navigable controls (Up/Down + Enter) to reload the iframe,
hand focus to it, and send each `adMessage` ad-lifecycle state. Outbound
`appReady` / `adOpportunity` / `close` and inbound messages are logged in
the on-screen log panel. No mouse/click activation works in the mock host by
design — everything is keyboard/D-pad driven, matching a real TV remote.

### Known gaps / remaining risk

- The app's original design canvas is 1024×1366 (see "Styling" above), not
  GameLoop's 1920×1080 authoring surface. Layout/CSS was **not** rescaled to
  1920×1080 as part of this graft (that's a visual redesign, not missing
  scaffolding) — validate on a real 1920×1080 iframe/TV and adjust CSS if
  content is cropped or off-center.
- No production GameLoop launcher origin is set yet in
  `src/gameloop/bridge.js` (`HOST_ORIGINS`) — add it before shipping.
- `npm run build` / `npm test` were not run end-to-end in the environment
  that produced this graft (dependency install exceeded the sandbox's
  command timeout); the full module graph (`App.js` and every new
  `src/gameloop/*` file) was verified with an esbuild JSX bundle pass
  instead. Run `npm start` and `npm run build` locally to confirm.
- The Milk Selection screen's hold-to-fill milk pour gauge (`src/gameloop/
  pal.js`'s `trackKeyDown`/`isHeld`/`heldDurationMs`, wired up in
  `MilkSelection.js`) was built and bundle-verified in the same
  no-full-build environment above, so its *sizing/placement* (gauge width,
  offset from the cup) and the feel of `MILK_FILL_DURATION_MS`'s sweep speed
  are un-playtested — check both on a real 1920×1080 iframe/TV and against
  actual remote key-repeat behavior, not just desktop keyboard `keydown`
  repeat, and tune if the yellow band reads as too easy/hard to catch.
  One placement bug already found and fixed this way (not by eye): an
  earlier version anchored the gauge above the *bottle's* own hover box
  instead of the cup's, which pushed it above the 1920×1080 canvas's top
  edge (`.milk-selection-container` clips overflow) and made the whole
  widget invisible — confirmed purely by walking the box-math
  (`BOTTLE_HEIGHT`/`getBottleHoverPos`/`CUP_SPOTS.table.top`), not by
  rendering it. It's now anchored off the cup's own box instead, which
  keeps it on-canvas but means it likely overlaps the lower part of the
  bottle's art while pouring — worth a look on-screen to see whether that
  overlap reads fine or needs the bottle's own z-index/opacity adjusted
  during 'measuring'.
- The Toppings Station's foam/powder/mint-leaves aim-lever minigame (shared
  `leverStage`/`leverFor` state machine, `LEVER_PERIOD_MS`/`LEVER_AMPLITUDE_PCT`/
  `LEVER_CENTER_TOLERANCE` in `ToppingsStation.js`, graded via `leverCredit` in
  `gameloop/scoring.js`) was built and bundle-verified the same way, so its
  sweep speed/amplitude/tolerance are un-playtested — check on a real
  1920×1080 iframe/TV and against actual remote key-repeat behavior, and tune
  if the center zone reads as too easy/hard to catch. Only syrups keep their
  own Left/Right-steered balance minigame; foam, powder, and mint leaves all
  use this shared lever instead.
