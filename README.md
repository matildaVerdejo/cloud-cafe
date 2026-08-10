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

A session is 5 orders (`ORDERS_PER_SESSION` in `src/components/ProgressBar.js`).
`adOpportunity` fires twice per boundary:

- **`PREROLL`** — once each time Play is pressed on the main menu, before
  the first order's ordering screen actually opens.
- **`ORDER_COMPLETE`** — once between each pair of consecutive orders (4
  times per full session), fired from the "Start order N+1" button on the
  Serve screen. The button stays disabled until the score/sticker reveal
  has fully played out (required outcome-comprehension dwell) and, once
  pressed, until the ad itself resolves.

No ad fires after the final (5th) order — it returns straight to the main menu.
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

### CTV performance pass (reported input/animation lag on Fire TV Stick)

A round of changes targeting GameLoop's own CTV performance guidance
(`tv-universal`/`tv-platform-html5` rules, `tv-gameplay-envelopes` doc) after
real-device testing on a Fire TV Stick reported delayed button presses and
laggy animations:

- **Images.** Every station background was a lossless, often oversized PNG
  (`CustomerOrdering.png` was 2752×1536 for a 1920×1080 target). Three were
  entirely unreferenced dead weight (`Matcha1.png`, `CustomerOrdering.png`,
  `ToppingsStation.png` -- superseded by other art, ~4.7MB) and were deleted
  outright. The five still-used backgrounds were converted to resized
  (max 1920px), quality-85 JPEGs (`TakeOrderFrame`, `Serving`, `CloudCafeHome`,
  `MatchaBaseStation`, `MilkMixingStation`) -- each shrank 85-97%, total image
  weight in `public/` dropped from ~28MB to ~19MB. Every `src="./Foo.png"`
  reference was updated to `.jpg` alongside the conversion. Sprite art
  (cups, bottles, toppings, characters) was left as PNG -- all RGBA
  (transparency-dependent) and already small (under ~150KB each), not worth
  the conversion risk.
- **Startup.** `public/index.html` gained an inline, JS-free `#pre-splash`
  (GameLoop's own "render splash immediately from inline HTML/CSS" startup
  policy) so a slow device shows *something* branded instead of a blank
  screen during the JS download/parse/mount gap; it's removed the instant
  `App.js`'s own bridge-init effect fires (the same moment the real,
  React-rendered `SplashScreen` has already painted underneath it). The five
  station screens (`CustomerOrdering`/`MatchaMaking`/`MilkSelection`/
  `ToppingsStation`/`FinalCombination`, each 1,000-2,000+ lines) are now
  `React.lazy`-loaded from `App.js` instead of bundled into the initial
  chunk -- `Splash`/`Main` stay eager since they're needed for first paint.
  `.route-loading` in `App.css` is the brief-gap Suspense fallback.
- **Animations.** This project had 26 CSS `@keyframes` animating
  `box-shadow`/`filter` directly (the pulsing focus-halo/hint-bubble glows
  used throughout) -- a paint-triggering pattern GameLoop's own tv-universal
  rule explicitly calls out as the wrong approach for CTV (should be
  `transform`/`opacity`, compositor-only). 18 were converted to a shared
  `::after` pseudo-element pattern (`haloGlowFade`/`hintRingPulse` keyframes,
  defined once in `App.css`): the glow/ring's shape is now a static
  box-shadow/border on the pseudo-element, and only its `opacity`/`transform`
  animates, so nothing recomputes a blur every frame. **8 were deliberately
  left unconverted** -- known, scoped-out gap, not an oversight:
  - `tinHaloBlink`/`kettleHaloBlink`/`whiskHaloBlink`/`bowlHaloBlink`/
    `bigSpoonHaloBlink` (MatchaMaking.css) animate `filter: drop-shadow()`,
    not `box-shadow` -- drop-shadow follows the sprite's actual alpha
    silhouette, which a plain pseudo-element (no image content of its own)
    can't replicate; fixing these properly needs a duplicate `<img>` glow
    layer (JSX change, not CSS-only) or a `background-image` pseudo-element
    keyed to each item's own `src`.
  - `mixBarHaloBlink`/`heaterTempBarHaloBlink` (MatchaMaking.css) sit on
    elements with `overflow: hidden` (clips the fill bar to its own rounded
    corners) -- a glow pseudo-element as a child would get clipped too;
    needs `overflow: visible` scoped to just the highlighted state (verify
    the fill's square corners don't visibly poke out during that window) or
    a sibling element instead of a child pseudo.
  - `receiptHaloBlink` (CustomerOrdering.css) sits on `.order-modal`, which
    has `overflow-y: auto` (a real scrollable dialog) -- same clipping risk,
    plus a stray scrollbar if the glow's extent isn't handled carefully.
  
  Left as their original (still-working, box-shadow/filter-animating) form
  rather than risk a visual regression on high-visibility gameplay elements
  without a real device to check against.
- **Input.** `pal.js`'s `ENTER_DEBOUNCE_MS` tightened from 350ms to 250ms,
  matching the `tv-gameplay-envelopes` doc's own recommended envelope.

None of this was validated on an actual Fire TV Stick (no such device in
this environment) -- verified via `esbuild` bundle passes and a `postcss`
parse check on every touched CSS file, same no-full-build-available
constraint as everything else in this project's known gaps. Re-test on the
real device before the next demo; if lag persists, the 8 unconverted
animations above and the still-PNG sprite art are the next things to look
at.

### Root-caused crash: unpooled `new Audio()` per SFX call (`gameloop/sfx.js`)

After the pass above, real on-device testing (Fire TV Stick) still showed
lag and a random crash after playing for a few minutes. The player provided
the device's own system log (`2026080701.log`, Android logcat, UTF-16), and
it pinpointed the crash exactly: `sfx.js`'s `playClip`/`playMatchaWhisking`
called `new Audio(src)` fresh on *every* button click, pour, ice-cube drop,
and voice line, with no pooling or reuse. Each `new Audio()` + `.play()`
creates a real native media-player instance under Chromium WebView
(`AwMediaPlayerBridge`), and those aren't reclaimed the instant the JS
object goes out of scope. The log showed the game's own process
(`com.gameloop.matchamaker.tvwrapper`) creating 33 distinct
"AWV Browser message manager" player instances in under 4 minutes of normal
play (`SendAwvMessageHandles: ... player_id: [1..33...]`), a
"Choreographer: Skipped 31 frames!" main-thread warning in the same window,
and then the process's own PID stops appearing in the log at all --
i.e. it died. 33 is suspiciously close to Android's own long-standing
platform-level cap on concurrent `AudioTrack` sessions per process (~32),
which fits a hard native crash once that ceiling is crossed, not just a
soft slowdown.

Fixed by pooling: every clip now reuses a small fixed-size pool
(`POOL_SIZE = 4`) of pre-created `Audio()` elements per `src` (round-robin,
`.currentTime = 0` + `.play()` again instead of a new instance), and the
looping matcha-whisking clip reuses one single persistent instance instead
of a fresh one per whisking session. Same public API (every exported
function's signature/return value is unchanged), so no caller elsewhere in
the app needed to change. Not yet re-tested on the real device -- this is a
strong, well-evidenced root-cause fix (matches the log's own player-id
count, timing, and Android's own AudioTrack ceiling almost exactly), but
confirm the crash is actually gone and dig into the log again if it isn't.
