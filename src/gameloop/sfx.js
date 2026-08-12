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
const FOAM_POUR_SRC = './FoamPour.wav';
const SCORE_FAIL_SRC = './ScoreFail.wav';
const SCORE_MID_SRC = './ScoreMid.wav';
const SCORE_GOOD_SRC = './ScoreGood.wav';
const TOPPING_POWDER_POUR_SRC = './ToppingPowderPour.wav';
const TOPPING_PLACE_SRC = './ToppingPlace.wav';

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
// dropping out of the log entirely -- i.e. it died.
//
// IMPORTANT, learned the hard way from a second device log after the fix
// below: eagerly building all POOL_SIZE elements the instant a clip is
// FIRST used (the original version of this function --
// `Array.from({length: POOL_SIZE}, () => new Audio(src))`) still creates
// POOL_SIZE native WebMediaPlayers at once, because just constructing
// `new Audio(src)` with a src already makes Chromium start loading/
// demuxing that resource immediately, well before .play() is ever called --
// so simply touching a clip for the first time cost 4 native players, not
// 1. With ~10 distinct one-shot clips in a single order (clicks, pours,
// whisking, score stingers, etc.) that's still 40-ish players, and a
// follow-up on-device log showed the exact same "N distinct player_id
// registrations, then the process drops out of the log" crash signature
// again (38 that time). getPooledAudio below now grows each pool LAZILY
// instead: only ever construct a new Audio() when every element already in
// that clip's pool is genuinely still mid-playback (a real overlap, e.g. a
// rapid repeat button mash) -- so the common case (a clip that's never
// played twice at once) costs exactly ONE native player for its entire
// lifetime, and POOL_SIZE (4) is now just a ceiling for the rare
// legitimately-overlapping case, not something eagerly paid upfront. Callers
// still get back the exact Audio instance that will actually play, so
// pausing it later (playVoiceLine/playLiquidPouring/playMatchaWhisking's own
// callers) still works exactly as before.
const POOL_SIZE = 4;
const audioPools = new Map(); // src -> { elements: HTMLAudioElement[], next: number }

function getPooledAudio(src) {
  let pool = audioPools.get(src);
  if (!pool) {
    pool = { elements: [new Audio(src)], next: 0 };
    audioPools.set(src, pool);
    return pool.elements[0];
  }
  // Reuse whichever pooled element is idle (finished, or never started)
  // rather than growing the pool at all -- this is the overwhelmingly
  // common case for a one-shot clip that isn't currently overlapping itself.
  const idle = pool.elements.find((el) => el.paused || el.ended);
  if (idle) return idle;
  // Every existing element is genuinely still playing (a real overlap) --
  // only now does this clip earn a second/third/fourth native player,
  // capped at POOL_SIZE.
  if (pool.elements.length < POOL_SIZE) {
    const el = new Audio(src);
    pool.elements.push(el);
    return el;
  }
  // Pool maxed out and every slot is genuinely busy -- fall back to the
  // same round-robin steal-the-oldest behavior as before.
  pool.next = (pool.next + 1) % pool.elements.length;
  return pool.elements[pool.next];
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
// gets set), not on 'moving' or 'idle'. Cold foam and powder toppings each
// have their own dedicated clips instead now (see playFoamPouring/
// playToppingPowderPour below) rather than reusing this one.
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

// Plays when cold foam actually lands on the drink in Toppings -- fires once
// right as foamPourStage flips into its 'pouring' stage (the same moment
// cupFoam gets set), same "on the 'pouring' transition, not 'moving'/
// 'aiming'" timing every other pour SFX in this module uses. Unlike
// playLiquidPouring, foam was previously one of the toppings that
// intentionally played no pour SFX at all (see that function's own
// comment) -- this is a dedicated clip for it now that one's actually been
// recorded, not a reuse of the liquid-pour one, since foam isn't a liquid
// being poured the same way milk/matcha/syrup are.
//
// Returns the Audio instance (same reasoning as playLiquidPouring) so the
// caller can cut it short the moment FOAM_POUR_MS elapses, since the clip
// isn't guaranteed to match that duration exactly.
export function playFoamPouring() {
  return playClip(FOAM_POUR_SRC);
}

// One-shot "drink reaction" stingers for the Serving station's own score
// reveal -- fail/mid/good match computeOverallScore's own tier buckets
// exactly (gameloop/scoring.js), same keys FinalCombination.js's own
// REACTION_STICKERS map already uses for which sticker shows, so callers
// there can look either up off the same scoreTier value. Fire-and-forget
// like playButtonClick/playIceCubeDrop (not returning the instance) --
// unlike the pour clips above, there's no ongoing on-screen animation these
// need to stay in sync with or get cut short against; each one is just a
// single reaction to a single moment (the reaction sticker's own reveal),
// so it's fine to let it play out on its own.
export function playScoreFailSound() {
  playClip(SCORE_FAIL_SRC);
}

export function playScoreMidSound() {
  playClip(SCORE_MID_SRC);
}

export function playScoreGoodSound() {
  playClip(SCORE_GOOD_SRC);
}

// Plays when a powder topping (matcha powder or guava powder) actually
// lands on the drink in Toppings -- fires once right as powderPourStage
// flips into its 'pouring' stage (the same moment cupPowder gets set), same
// "on the 'pouring' transition" timing playFoamPouring/playLiquidPouring
// use. A distinct clip/export from playMatchaPowderPour above despite the
// similar name -- that one's for the big spoon dumping matcha powder into
// the bowl on Matcha Making, a completely different station/moment; this
// one's for either powder TOPPING landing on the finished drink here.
//
// Returns the Audio instance (same reasoning as the other pour clips) so
// the caller can cut it short the moment POWDER_POUR_MS elapses, since the
// clip isn't guaranteed to match that duration exactly.
export function playToppingPowderPour() {
  return playClip(TOPPING_POWDER_POUR_SRC);
}

// Plays when a single, non-poured topping is actually placed on the drink
// in Toppings -- today that's just the mint leaf garnish (Enter on the
// mint-leaves pot, a short gate-then-pause with no drag/aim/travel sprite,
// see beginLeafPlace/LEAF_PLACE_MS in ToppingsStation.js), but named
// generically (not playMintLeafPlace) in case a future single-item topping
// reuses this same "one clean placement, not a pour" shape. Fire-and-forget
// like playIceCubeDrop -- LEAF_PLACE_MS's own on-screen pause is short and
// this is a one-shot placement sound, not an ongoing pour that needs
// cutting short against a longer visual.
export function playToppingPlace() {
  playClip(TOPPING_PLACE_SRC);
}
