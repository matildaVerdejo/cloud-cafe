// GameLoop shared one-shot SFX helper -- a tiny wrapper so every place that
// needs to play a short, non-looping sound effect (button clicks, etc.)
// does it the same way instead of each component hand-rolling its own
// `new Audio(...).play()` call. Deliberately minimal: no volume control, no
// music-ducking, no preloading strategy -- just "play this clip once, right
// now." Background music stays exactly as-is (looping, volume-slider-aware,
// via App.js's own <audio ref> element); this is only for short one-shot
// clips layered on top of it, the same pattern CustomerOrdering.js's own
// per-character ordering voice line already uses.

const BUTTON_CLICK_SRC = './ButtonClickOn.mp3';

// Fresh `new Audio()` per call (rather than one shared/reused instance) so
// rapid repeat clicks each get their own full playback instead of cutting
// each other off mid-clip. .catch(() => {}) swallows the same
// autoplay-block possibility every other one-shot Audio() call in this
// project already guards against -- if it's blocked, that one click just
// plays silently.
export function playButtonClick() {
  const audio = new Audio(BUTTON_CLICK_SRC);
  audio.play().catch(() => {});
}
