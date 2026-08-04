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
