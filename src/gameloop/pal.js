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
  32: 'Enter',
  // Back deltas: Backspace/Escape (desktop/browser testing), 461 (LG webOS),
  // 10009 (Samsung Tizen), 27 duplicated intentionally for clarity.
  8: 'Back',
  27: 'Back',
  461: 'Back',
  10009: 'Back',
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
