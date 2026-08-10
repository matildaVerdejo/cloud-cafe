// GameLoop shared one-shot SFX helper -- a tiny wrapper so every place that
// needs to play a short, non-looping sound effect (button clicks, character
// voice lines, etc.) does it the same way instead of each component
// hand-rolling its own `new Audio(...).play()` call. Background music
// stays exactly as-is (looping, via App.js's own <audio ref> element,
// controlled by the Settings panel's separate "Music" slider); everything
// here is one-shot clips layered on top of it, controlled by that same
// panel's "Sound" slider instead.

const BUTTON_CLICK_ON_SRC = './ButtonClickOn.mp3';
const BUTTON_CLICK_OFF_SRC = './ButtonClickOff.mp3';
const LIQUID_POUR_SRC = './LiquidPour.wav';
const ICE_CUBE_DROP_SRC = './IceCubeDrop.wav';
const MATCHA_WHISKING_SRC = './MatchaWhisking.wav';
const MATCHA_POWDER_POUR_SRC = './MatchaPowderPour.wav';

// Current "Sound" volume (0-1) -- covers every clip played through this
// module (button clicks, character ordering voice lines, and whatever else
// gets added later), separately from musicVolume in App.js. Lives here as
// plain module state (rather than being threaded through props/context to
// every button) since nothing here is React state itself -- setSfxVolume
// is just called from App.js's own effect whenever the Settings panel's
// Sound slider changes, mirroring how that effect already keeps the
// background-music <audio> element's own .volume in sync with musicVolume.
// Default matches musicVolume's own default (0.5) so a first-time player
// hears both at the same level before ever opening Settings.
let sfxVolume = 0.5;

export function setSfxVolume(v) {
  sfxVolume = v;
}

// Small, fixed-size pool of pre-created Audio() elements per clip, reused
// forever -- NOT a fresh `new Audio()` on every call. Each `new Audio()` +
// .play() creates a real native media-player instance under the hood
// (AwMediaPlayerBridge/WebMediaPlayer on Chromium WebView, which is what
// every CTV platform's in-app browser runs on); those aren't free the
// instant the JS object goes out of scope, they linger until the engine's
// own cleanup catches up. On a real Fire TV Stick this actually crashed
// the app: the device log showed 33 distinct "Creating new AWV Browser
// message manager for player_id" entries (one per button click/pour/voice
// line) in under 4 minutes, immediately followed by the app's own process
// dropping out of the log entirely -- i.e. it died. Capping the number of
// native players any one clip can ever create to POOL_SIZE, round-robin
// reused via .currentTime = 0 + .play() again, fixes that at the root
// instead of hoping GC keeps up. POOL_SIZE (4) just needs to comfortably
// exceed how many times the *same* clip could ever legitimately overlap
// itself (rapid repeat button clicks) -- callers get back the exact Audio
// instance that will actually play, so pausing it later (playVoiceLine/
// playLiquidPouring/playMatchaWhisking's own callers) still works exactly
// as before; only the never-reclaimed `new Audio()` growth is gone.
const POOL_SIZE = 4;
const audioPools = new Map(); // src -> { elements: HTMLAudioElement[], next: number }

function getPooledAudio(src) {
  let pool = audioPools.get(src);
  if (!pool) {
    pool = { elements: Array.from({ length: POOL_SIZE }, () => new Audio(src)), next: 0 };
    audioPools.set(src, pool);
  }
  const audio = pool.elements[pool.next];
  pool.next = (pool.next + 1) % POOL_SIZE;
  return audio;
}

// .catch(() => {}) swallows the same autoplay-block possibility every
// one-shot Audio() call in this project already guards against -- if it's
// blocked, that one clip just plays silently. Returns the Audio instance
// so callers that need to hang onto it (e.g. to pause a longer voice line
// on unmount) can.
function playClip(src) {
  const audio = getPooledAudio(src);
  audio.currentTime = 0;
  audio.volume = sfxVolume;
  audio.play().catch(() => {});
  return audio;
}

// The general-purpose click used for most buttons (Start, the ordering
// iPad screen, Place Order, the order-form's dropdowns/toppings, etc.).
export function playButtonClick() {
  playClip(BUTTON_CLICK_ON_SRC);
}

// The "off" pair for toggle-style buttons that open AND close a panel --
// today that's the Settings gear and the per-station "Order" receipt
// button. Callers are responsible for knowing which way the toggle is
// about to go (i.e. check the *current* open state before flipping it) and
// picking playButtonClick (opening) vs this (closing) accordingly.
export function playButtonClickOff() {
  playClip(BUTTON_CLICK_OFF_SRC);
}

// For one-off clips elsewhere that need this same shared "Sound" volume
// but also need the Audio instance itself (e.g. CustomerOrdering's
// per-character ordering voice line pauses it on unmount). Same clip/
// volume/autoplay-catch behavior as playButtonClick/playButtonClickOff
// above, just parameterized on src and returning the instance instead of
// firing-and-forgetting.
export function playVoiceLine(src) {
  return playClip(src);
}

// Plays when a liquid actually starts filling the cup/drink -- any base
// (milk or coconut water) poured in Milk Selection, the matcha bowl poured
// on top of it there, and any syrup poured onto the drink in the Toppings
// station. Fired once per pour, right as each screen's own pour effect
// flips into its 'pouring' stage (the same moment the fill state itself
// gets set), not on 'moving' or 'idle'. Cold foam and powder toppings
// intentionally don't use this -- they're not liquids being poured, so
// they keep using their own visual-only settle/pour animation with no SFX.
//
// Returns the Audio instance (same reasoning as playVoiceLine above) so
// callers can pause it early -- the clip itself runs longer than a single
// pour's own on-screen duration (BOTTLE_POUR_MS/SYRUP_POUR_MS), so each
// caller stops it the moment its own pour's timeout fires rather than
// letting it play out past the visual.
export function playLiquidPouring() {
  return playClip(LIQUID_POUR_SRC);
}

// Plays the instant an ice cube is actually placed into a cup (any of the
// three cup types) in Milk Selection -- both the drag-and-drop path and its
// Enter-key equivalent. A short one-shot like the button clicks above (not
// something that needs cutting short mid-clip the way playLiquidPouring
// does), so this fires and forgets rather than returning the instance.
// Deliberately NOT played when a cube is picked back out of the cup (or
// dropped back over the ice box) -- only on the box -> cup placement itself.
export function playIceCubeDrop() {
  playClip(ICE_CUBE_DROP_SRC);
}

// Starts the whisking loop for the whole balance-minigame stretch of Matcha
// Making (whiskStage === 'mixing') -- unlike every other clip above, this
// one sets .loop so it keeps going for as long as the caller wants rather
// than playing out once, since the minigame's own duration
// (WHISK_MIX_DURATION_MS) isn't guaranteed to line up with the clip's own
// length. Returns the Audio instance so the caller can .pause() it the
// moment whisking actually stops -- normal completion or an early unmount --
// same "caller owns stopping it" contract as playLiquidPouring. Reuses one
// persistent Audio element across every whisking session (rather than a
// fresh `new Audio()` per call) for the same reason playClip's own pool
// does -- see that comment above. No pooling needed here specifically
// (unlike the one-shot clips, only one whisking session is ever active at
// once, so there's nothing to round-robin), just a single cached instance.
let whiskingAudio = null;
export function playMatchaWhisking() {
  if (!whiskingAudio) {
    whiskingAudio = new Audio(MATCHA_WHISKING_SRC);
    whiskingAudio.loop = true;
  }
  whiskingAudio.currentTime = 0;
  whiskingAudio.volume = sfxVolume;
  whiskingAudio.play().catch(() => {});
  return whiskingAudio;
}

// Plays when the big spoon actually dumps its scoop of matcha powder into
// the bowl in Matcha Making -- fires once right as bigSpoonStage flips into
// its 'pouring' stage (the same moment the falling-powder .spoon-pour effect
// and the bowl's own mound both start), same "on the 'pouring' transition,
// not 'moving'" timing every other pour SFX in this module uses.
//
// Returns the Audio instance (same reasoning as playLiquidPouring) so the
// caller can cut it short the moment BIG_SPOON_POUR_MS elapses, since the
// clip isn't guaranteed to match that duration exactly.
export function playMatchaPowderPour() {
  return playClip(MATCHA_POWDER_POUR_SRC);
}
