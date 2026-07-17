// Same PAL shape as src/gameloop/pal.js, kept as an independent copy per the
// mockhost's own dependency boundary (it does not import from the game's
// src/ tree).
const KEYCODE_TO_ACTION = {
  37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down',
  13: 'Enter', 32: 'Enter',
  8: 'Back', 27: 'Back', 461: 'Back', 10009: 'Back',
};

export function getActionFromKeyEvent(e) {
  if (typeof e.keyCode === 'number' && KEYCODE_TO_ACTION[e.keyCode]) {
    return KEYCODE_TO_ACTION[e.keyCode];
  }
  return null;
}
