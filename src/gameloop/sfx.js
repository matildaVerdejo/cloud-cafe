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

// Fresh `new Audio()` per call (rather than one shared/reused instance) so
// rapid repeat clicks each get their own full playback instead of cutting
// each other off mid-clip. .catch(() => {}) swallows the same
// autoplay-block possibility every one-shot Audio() call in this project
// already guards against -- if it's blocked, that one clip just plays
// silently. Returns the Audio instance so callers that need to hang onto
// it (e.g. to pause a longer voice line on unmount) can.
function playClip(src) {
  const audio = new Audio(src);
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
// same "caller owns stopping it" contract as playLiquidPouring.
export function playMatchaWhisking() {
  const audio = new Audio(MATCHA_WHISKING_SRC);
  audio.volume = sfxVolume;
  audio.loop = true;
  audio.play().catch(() => {});
  return audio;
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
