// GameLoop PAL (Platform Abstraction Layer) — keycode -> logical action.
// App/UI code never reads raw keyCodes; it only sees 'Up' | 'Down' | 'Left' |
// 'Right' | 'Enter' | 'Back'. Keep all OEM keycode deltas here.
//
// keydown is authoritative for one-shot actions (nav, Enter, Back). We do not
// depend on keyup for basic navigation (TV remotes may not fire it reliably).

const KEYCODE_TO_ACTION = {
  37: 'Left',
  38: 'Up',
  39: 'Right',
  40: 'Down',
  13: 'Enter',
  // Space (32) used to also map to 'Enter' -- removed per request: the
  // game should only respond to arrow keys, Enter, and Backspace, nothing
  // else. See the capture-phase listener in App.js for the other half of
  // this -- removing the mapping here stops the game's own action-based
  // handlers from treating Space as Enter, but native <button> elements
  // still activate on Space by default regardless of this map, so that
  // listener also preventDefaults Space (and Tab) directly.
  // Back deltas: Backspace/Escape (desktop/browser testing), 461 (LG webOS),
  // 10009 (Samsung Tizen), 27 duplicated intentionally for clarity.
  8: 'Back',
  27: 'Back',
  461: 'Back',
  10009: 'Back',
  // Android/Fire TV native D-pad keycodes (KEYCODE_DPAD_*), for when the app
  // is wrapped in an Android WebView instead of a general-purpose TV browser.
  // Chromium's WebView normally remaps these to the standard DOM ArrowUp/Down/
  // Left/Right (37-40) before they ever reach page JS, but some OEM WebView
  // builds pass the raw Android keyCode through instead -- map both so either
  // behavior works without needing a device-specific branch.
  19: 'Up',
  20: 'Down',
  21: 'Left',
  22: 'Right',
  23: 'Enter', // KEYCODE_DPAD_CENTER
  66: 'Enter', // KEYCODE_ENTER
  4: 'Back',   // KEYCODE_BACK
};

export function getActionFromKeyEvent(e) {
  if (typeof e.keyCode === 'number' && KEYCODE_TO_ACTION[e.keyCode]) {
    return KEYCODE_TO_ACTION[e.keyCode];
  }
  return null;
}

// Enter/Select debounce: TV remotes repeat keydown while held. One physical
// press must equal one activation. Call shouldDebounce(e) and skip the action
// when it returns true.
let lastEnterAt = 0;
const ENTER_DEBOUNCE_MS = 350;

export function shouldDebounceEnter(e) {
  if (e.repeat) return true;
  const now = Date.now();
  if (now - lastEnterAt < ENTER_DEBOUNCE_MS) return true;
  lastEnterAt = now;
  return false;
}

// ---- Held input (TV remotes) ----------------------------------------------
// For held/continuous input (charge-up gauges, movement, aiming -- anything
// that reads "press and hold, act on release") the debounce helper above is
// the wrong tool: it exists to collapse a repeating keydown into a single
// one-shot activation, not to track how long a key has been down.
//
// Per the GameLoop TV keycode held-input policy: TV remotes emit repeated
// `keydown` while a key is physically held, but deliver `keyup` unreliably
// (often late, sometimes never). Held input must therefore be derived from a
// keydown heartbeat + release watchdog, not from waiting for keyup. Each
// repeated keydown refreshes a per-action "last seen" timestamp; the action
// is considered released once no repeat has arrived for RELEASE_WATCHDOG_MS
// (comfortably longer than any OS/remote key-repeat interval). keyup, when it
// does arrive, is consumed only as an optional early-release hint via
// trackKeyUp -- nothing here ever depends on it firing.
//
// Feature code doesn't read the two Maps below directly -- call trackKeyDown/
// trackKeyUp from a keydown/keyup listener scoped to whatever's currently
// listening for the hold (e.g. MilkSelection.js's pour gauge, only while its
// own 'measuring' stage is mounted), then poll isHeld/heldDurationMs from a
// requestAnimationFrame loop to drive a live reading.
const RELEASE_WATCHDOG_MS = 600;
const heldSince = new Map(); // action -> timestamp the current hold actually started
const heldLastSeen = new Map(); // action -> timestamp of the most recent keydown heartbeat

// Call from a keydown listener for every keydown (including OS repeats) --
// repeats are exactly what keeps a hold alive here, unlike shouldDebounceEnter
// above which exists to swallow them.
export function trackKeyDown(e) {
  const action = getActionFromKeyEvent(e);
  if (!action) return;
  const now = Date.now();
  if (!heldSince.has(action)) heldSince.set(action, now);
  heldLastSeen.set(action, now);
}

// Call from a keyup listener. Optional early-release hint only -- ends the
// hold immediately when the event does arrive, but isHeld's own watchdog
// below is what actually guarantees release on hardware that never fires it.
export function trackKeyUp(e) {
  const action = getActionFromKeyEvent(e);
  if (!action) return;
  heldSince.delete(action);
  heldLastSeen.delete(action);
}

// True while the logical action is considered held: a keydown heartbeat has
// arrived within the last RELEASE_WATCHDOG_MS. Lazily clears both maps once
// the watchdog window elapses, so a caller that stops polling mid-hold (e.g.
// unmounting the gauge) doesn't leave a stale "held" entry behind for a key
// that was never explicitly released.
export function isHeld(action, now = Date.now()) {
  const lastSeen = heldLastSeen.get(action);
  if (lastSeen === undefined) return false;
  if (now - lastSeen > RELEASE_WATCHDOG_MS) {
    heldSince.delete(action);
    heldLastSeen.delete(action);
    return false;
  }
  return true;
}

// Milliseconds of sustained hold for the action, 0 if not currently held.
export function heldDurationMs(action, now = Date.now()) {
  if (!isHeld(action, now)) return 0;
  return now - heldSince.get(action);
}
