import React, { useEffect, useRef, useState } from 'react';
import './CustomerOrdering.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { getActionFromKeyEvent } from '../gameloop/pal';
import { playButtonClick, playVoiceLine } from '../gameloop/sfx';
import ProgressBar from './ProgressBar';
import { scoreOrderTaking } from '../gameloop/scoring';

// ---- Order-builder option lists ------------------------------------------
// One list per dropdown/adder below, each a plain { value, label } pair --
// value is what gets stored in state, label is what's shown to the player.
// Base three, always orderable. Hojicha (added per request, order 4 onward
// only, same as its counter tin on Matcha Making -- see gradeOptions in the
// component below) is kept as a separate list rather than merged in
// directly, same "never ask for what the player hasn't seen on the counter
// yet" rule as BASE_OPTIONS_WITH_STRAWBERRY below.
const GRADE_OPTIONS_BASE = [
  { value: 'cafe', label: 'cafe' },
  { value: 'classic', label: 'classic' },
  { value: 'ceremonial', label: 'ceremonial' },
];
const GRADE_OPTIONS_WITH_HOJICHA = [...GRADE_OPTIONS_BASE, { value: 'hojicha', label: 'hojicha' }];
const TEASPOON_OPTIONS = [1, 2, 3].map((n) => ({ value: n, label: `${n} tsp` }));
const CUP_OPTIONS = [
  { value: 'glass', label: 'glass' },
  { value: 'mug', label: 'mug' },
  { value: 'plastic', label: 'plastic' },
];
// Extended to include 0 (was [1..7]) so a spoken "0 ice cubes" order (see
// generateSpokenOrder below) is always something the player can actually
// match in this same dropdown.
const ICE_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: `${n}` }));
// Base four, always orderable. Strawberry milk (added per request, order 2
// onward only, same as its counter bottle on Milk Selection -- see
// baseOptions in the component below) is kept as a separate list rather
// than merged into this one directly so a first-time player is never asked
// for -- or hears the customer speak -- an ingredient they haven't been
// introduced to on the counter yet.
const BASE_OPTIONS_BASE = [
  { value: 'dairy', label: 'dairy milk' },
  { value: 'oat', label: 'oat milk' },
  { value: 'almond', label: 'almond milk' },
  { value: 'coconut', label: 'coconut water' },
];
const BASE_OPTIONS_WITH_STRAWBERRY = [...BASE_OPTIONS_BASE, { value: 'strawberry', label: 'strawberry milk' }];
// Sparkling yuzu (order 4 onward, added per request) stacks on top of
// strawberry rather than replacing it, same "separate list, never ask for
// what hasn't been introduced yet" reasoning as strawberry itself above --
// see baseOptions in the component below.
const BASE_OPTIONS_WITH_YUZU = [...BASE_OPTIONS_WITH_STRAWBERRY, { value: 'yuzu', label: 'sparkling yuzu' }];
// Same "kept as a separate list, not merged in directly" reasoning as
// BASE_OPTIONS_BASE/_WITH_STRAWBERRY above -- banana foam (order 2+, see
// ToppingsStation.js's own bananaFoamUnlocked) and honey syrup/mint leaves
// (order 3+, see that file's own honeySyrupUnlocked/mintLeavesUnlocked)
// only become orderable/speakable once the counter itself actually has
// them, same "never ask for what the player hasn't been introduced to
// yet" rule. banana-foam was missing entirely here before (a real bug --
// the counter offered it from order 2 on, but there was no way to ever be
// asked for it), unlike honey-syrup/mint-leaves, whose value here reuses
// ToppingsStation's own item key directly rather than a differently-named
// order-form value (contrast matcha-cold-foam/reg-cold-foam, which map
// through FOAM_KEY_TO_ORDER in gameloop/scoring.js).
const TOPPING_OPTIONS_BASE = [
  { value: 'guava-syrup', label: 'guava syrup' },
  { value: 'mint-syrup', label: 'mint syrup' },
  { value: 'reg-foam', label: 'reg cold foam' },
  { value: 'matcha-foam', label: 'matcha cold foam' },
  { value: 'guava-powder', label: 'guava powder' },
  { value: 'matcha-powder', label: 'matcha powder' },
];
const TOPPING_OPTIONS_ORDER2 = [...TOPPING_OPTIONS_BASE, { value: 'banana-foam', label: 'banana foam' }];
const TOPPING_OPTIONS_ORDER3 = [
  ...TOPPING_OPTIONS_ORDER2,
  { value: 'honey-syrup', label: 'honey syrup' },
  { value: 'mint-leaves', label: 'mint leaves' },
];

// ---- Customer's randomized spoken order ----------------------------------
// Purely flavor/dialogue text shown in the speech bubble above the bunny's
// head -- a fresh, randomly generated order line each round (each new
// customer, since this whole component unmounts/remounts between customers
// as App.js switches currentPage away from and back to 'ordering'). Built
// from the same option pools as the order-builder dropdowns above so
// nothing spoken here is ever impossible to actually build. Not wired to
// isOrderComplete/placeOrder or any correctness-checking -- this is
// dialogue only, same "no correctness checking wired up yet" scope the
// order form has had all along.
//
// ICE_OPTIONS above only went 1-7 (there's always been ice); extended to
// include 0 here (both for speech and the actual Ice dropdown, so a spoken
// "0 ice cubes" order can still be matched in the form) rather than
// tracking a second, speech-only range that the dropdown couldn't match.
const GREETINGS = ['hello!', 'hi!', 'howdy!'];

// A couple of these read better spoken aloud than their short dropdown-chip
// labels (e.g. TOPPING_OPTIONS' "Reg cold foam" -> "regular foam" here), so
// this is a separate speech-name map rather than reusing `label` directly.
const TOPPING_SPEECH_NAMES = {
  'guava-syrup': 'guava syrup',
  'mint-syrup': 'mint syrup',
  'honey-syrup': 'honey syrup',
  'reg-foam': 'regular foam',
  'matcha-foam': 'matcha foam',
  'guava-powder': 'guava powder',
  'matcha-powder': 'matcha powder',
  'mint-leaves': 'mint leaves',
  'banana-foam': 'banana foam',
};

// ---- Which character is at the counter -----------------------------------
// Five interchangeable customer characters -- Annie (the bunny, the
// original/only one before this), Otto (the frog), Katie (the cat), Teddy
// (the bear), and Coco (the poodle) -- one is picked at random each time a
// new order starts (see CUSTOMER_CHARACTER's own lazy useState initializer
// in the component below, same "rolled once per mount, not re-rolled on
// every render" pattern generateSpokenOrder's own spokenOrder already
// uses, since this whole component unmounts/remounts between customers).
// All five share the same bust framing/crop (Annie.png/Otto.png/
// Katie.png/Teddy.png/Coco.png, each 429x509 -- cropped from a shared
// 455x548 source canvas down to the union of all FIVE characters' own
// bounding boxes (re-widened from the original three-character union once
// Teddy's/Coco's own art turned out to reach further toward the canvas
// edges than Annie/Otto/Katie did -- see the git history around when Teddy/
// Coco were added for the narrower box that used to clip Teddy's left ear/
// arm), so they render at identical scale/position in .ordering-bunny below
// regardless of which one gets picked, with a few pixels of headroom (PAD)
// on every side rather than a pixel-tight bound.
const CUSTOMER_CHARACTERS = {
  annie: { src: './Annie.png', alt: 'Annie the bunny, a customer at the counter' },
  otto: { src: './Otto.png', alt: 'Otto the frog, a customer at the counter' },
  katie: { src: './Katie.png', alt: 'Katie the cat, a customer at the counter' },
  teddy: { src: './Teddy.png', alt: 'Teddy the bear, a customer at the counter' },
  coco: { src: './Coco.png', alt: 'Coco the poodle, a customer at the counter' },
};

// One short voice-over clip per customer character, keyed by character id --
// tied to WHO is at the counter, not to what they happen to order (the
// spoken order text itself is randomized separately by generateSpokenOrder
// above). All five characters have a recorded line now -- Katie's was
// re-recorded (a straight file swap, same key/path, no code change needed
// beyond the asset itself) and Otto/Teddy/Coco's were added fresh. The
// playback effect below still treats a missing entry as "no line to play"
// rather than erroring, so any future character added without its own line
// yet would still just silently skip playing anything.
const CHARACTER_ORDERING_AUDIO = {
  annie: './AnnieOrdering.wav',
  katie: './KatieOrdering.wav',
  otto: './OttoOrdering.wav',
  teddy: './TeddyOrdering.wav',
  coco: './CocoOrdering.wav',
};

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Random-length (0 through maxCount, which defaults to the whole list),
// random-order subset -- "any and however many toppings," not a fixed count
// and not necessarily in list order. maxCount lets the first round cap this
// lower (see generateSpokenOrder below) without a separate code path.
function pickRandomSubset(list, maxCount = list.length) {
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  const cap = Math.min(maxCount, list.length);
  const count = Math.floor(Math.random() * (cap + 1));
  return shuffled.slice(0, count);
}

// Oxford-comma joiner, segment version -- same "a" / "a and b" / "a, b, and
// c" phrasing as a plain joinWithAnd would, but returns a list of
// { text, highlight } pieces instead of one string, so each ingredient name
// stays its own highlightable segment and only the connective words
// ("and", ", ") stay unhighlighted in between.
function joinWithAndSegments(items) {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ text: items[0], highlight: true }];
  if (items.length === 2) {
    return [
      { text: items[0], highlight: true },
      { text: ' and ', highlight: false },
      { text: items[1], highlight: true },
    ];
  }
  const segments = [];
  items.slice(0, -1).forEach((item, i) => {
    segments.push({ text: item, highlight: true });
    segments.push({ text: i === items.length - 2 ? ', and ' : ', ', highlight: false });
  });
  segments.push({ text: items[items.length - 1], highlight: true });
  return segments;
}

// Rolls one full random order for the customer to "say." Randomized once
// per customer (see the useState lazy initializer in the component below),
// not re-rolled on every render.
//
// customerNumber === 1 (the very first order of a session) caps the topping
// count lower -- a random max of 2 or 3, rather than the full 0-7 range --
// so a brand-new player's first order is a simpler one to read and build.
// Every later round uses the full range as before.
//
// gradeOptions/baseOptions/toppingOptions are passed in (rather than this
// reading the module-level GRADE_OPTIONS_BASE/BASE_OPTIONS_BASE/
// TOPPING_OPTIONS_BASE directly) so whichever pools the component decided
// are unlocked this round (see gradeOptions/baseOptions/toppingOptions in
// the component below) are what the customer can actually ask for -- order
// 1/2/3 can never randomly speak an ingredient (hojicha, strawberry milk,
// sparkling yuzu, honey syrup, mint leaves) the player hasn't seen on the
// counter yet.
function generateSpokenOrder(customerNumber, gradeOptions, baseOptions, toppingOptions) {
  const toppingCap = customerNumber === 1 ? pickRandom([2, 3]) : toppingOptions.length;
  // First order only -- fixed at exactly 3 (rather than rolled) so the
  // walkthrough's own ice-placement beat on Milk Selection (see
  // showIceSpotlight/showBaseSpotlight there, which waits for exactly/at
  // least 3 cubes) always has the same, predictable amount to actually
  // teach; orders 2/3 keep rolling the full ICE_OPTIONS range, 0 included,
  // same as before.
  const ice = customerNumber === 1 ? 3 : pickRandom(ICE_OPTIONS).value;
  return {
    greeting: pickRandom(GREETINGS),
    teaspoons: pickRandom(TEASPOON_OPTIONS).value,
    grade: pickRandom(gradeOptions).value,
    cup: pickRandom(CUP_OPTIONS).value,
    ice,
    milk: pickRandom(baseOptions).value,
    toppings: pickRandomSubset(toppingOptions, toppingCap).map((t) => t.value),
  };
}

// Pure formatter -- no randomness in here, so re-renders (opening a
// dropdown, picking a value, etc.) never change the sentence that's already
// showing. Returns a list of { text, highlight } segments (rather than one
// plain string) so every randomized value -- teaspoon count, grade, cup,
// ice count, milk/base, and each topping -- can be visually called out in
// the bubble (see .ordering-speech-highlight in CustomerOrdering.css),
// while the surrounding scripted phrasing and the greeting stay
// unhighlighted. flattenSegments (below) rejoins these into one plain
// string for the typewriter effect's character-count timing.
function buildSpeechSegments(o, gradeOptions, baseOptions) {
  const grade = gradeOptions.find((g) => g.value === o.grade).label.toLowerCase();
  const cup = CUP_OPTIONS.find((c) => c.value === o.cup).label.toLowerCase();
  const milk = baseOptions.find((m) => m.value === o.milk).label.toLowerCase();
  const tspWord = o.teaspoons === 1 ? 'teaspoon' : 'teaspoons';
  const iceWord = o.ice === 1 ? 'ice cube' : 'ice cubes';

  const segments = [
    { text: `${o.greeting} may i have a drink with `, highlight: false },
    { text: `${o.teaspoons} ${tspWord}`, highlight: true },
    { text: ' of ', highlight: false },
    { text: grade, highlight: true },
    { text: ' grade matcha, in a ', highlight: false },
    { text: cup, highlight: true },
    { text: ' cup with ', highlight: false },
    { text: `${o.ice} ${iceWord}`, highlight: true },
    { text: '. may i please have that with ', highlight: false },
    { text: milk, highlight: true },
  ];

  if (o.toppings.length > 0) {
    const toppingNames = o.toppings.map((v) => TOPPING_SPEECH_NAMES[v]);
    segments.push({ text: ", and i'd like to add on ", highlight: false });
    segments.push(...joinWithAndSegments(toppingNames));
  }

  segments.push({ text: '. thank you!', highlight: false });
  return segments;
}

function flattenSegments(segments) {
  return segments.map((s) => s.text).join('');
}

// Truncates a segment list down to just its first n characters (across all
// segments combined), keeping each remaining piece's own highlight flag --
// used to drive the typewriter reveal below without losing which parts of
// the not-yet-fully-typed sentence are highlighted vs plain.
function sliceSegments(segments, n) {
  const out = [];
  let remaining = n;
  for (const seg of segments) {
    if (remaining <= 0) break;
    const take = Math.min(seg.text.length, remaining);
    if (take > 0) {
      out.push({ text: seg.text.slice(0, take), highlight: seg.highlight });
      remaining -= take;
    }
  }
  return out;
}

// A compact single-select control -- a toggle button showing the current
// selection (or a placeholder), which reveals a row of the other options
// directly below it once opened. Built entirely from plain <button>
// elements (not custom onKeyDown/getActionFromKeyEvent handling) so Enter/
// Space on a focused button "just works" via ordinary browser behavior,
// same as .heater-button in MatchaMaking.js -- a simple activate-on-press
// control doesn't need pal.js's key-mapping helpers, those are only for
// controls that need Enter to behave differently than a native click (or
// need to filter out other keys).
//
// isOpen/onToggle are owned by the parent (CustomerOrdering below) rather
// than local state here, so only one dropdown across the whole order form
// can be open at a time -- keeps the small modal from ever showing two
// option rows stacked on each other. toggleRef is also owned by the parent
// now (rather than a local useRef here) -- CustomerOrdering's own explicit
// order-form keyboard graph (see the big comment above it) needs to
// address each dropdown's toggle button directly by identity, the same
// reason SettingsPanel's VolumeRow takes minusRef/plusRef props instead of
// creating its own internal refs.
function Dropdown({ placeholder, options, value, onSelect, isOpen, onToggle, toggleRef }) {
  const selected = options.find((opt) => opt.value === value);
  const firstOptionRef = useRef(null);

  // The first option (leftmost, matching the row's own visual/DOM order)
  // gets focus automatically the instant the dropdown opens, per request
  // -- previously, opening it via Enter left focus sitting on the toggle
  // button itself, with nothing to show a D-pad user that a row of
  // options had even appeared below it.
  useEffect(() => {
    if (isOpen) {
      firstOptionRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <div className="order-dropdown">
      <button
        ref={toggleRef}
        type="button"
        className={`order-dropdown-toggle${isOpen ? ' open' : ''}${selected ? ' filled' : ''}`}
        data-focusable
        onClick={() => {
          playButtonClick();
          onToggle();
        }}
      >
        {selected ? selected.label : placeholder}
      </button>
      {isOpen && (
        <div className="order-dropdown-list">
          {options.map((opt, index) => (
            <button
              key={opt.value}
              ref={index === 0 ? firstOptionRef : undefined}
              type="button"
              className={`order-dropdown-option${opt.value === value ? ' selected' : ''}`}
              data-focusable
              onClick={() => {
                playButtonClick();
                onSelect(opt.value);
                // Closes the dropdown -- onToggle flips isOpen back to
                // false for this control the same way clicking the toggle
                // button itself does (see toggleControl in
                // CustomerOrdering, which un-sets openControl when it's
                // already this key). Previously missing here, so picking
                // an option filled it in but left the row of options open
                // instead of closing like every other "activate and
                // close" control in this form.
                onToggle();
                // Refocuses the toggle button once an option's picked --
                // without this, focus would vanish along with the (now
                // unmounted) option button, dropping the player back to
                // document.body and breaking D-pad navigation until they
                // manually found their way again.
                toggleRef.current?.focus();
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CustomerOrdering = ({ activeStep, customerNumber, onNavigate, onAdvance, onPlaceOrder, onOrderScored }) => {
  const containerRef = useRef(null);
  // Strawberry milk becomes orderable from order 2 onward, sparkling yuzu
  // from order 4 onward -- same unlocks as their counter bottles on Milk
  // Selection. This screen fully unmounts/remounts between customers
  // (App.js only ever renders one page-slide's component at a time), so
  // customerNumber is fixed for this whole mount's lifetime -- no need for
  // this to be reactive, just read once and used both for the dropdown's
  // own options and for whatever the customer might randomly ask for (see
  // generateSpokenOrder below).
  const baseOptions =
    customerNumber >= 4 ? BASE_OPTIONS_WITH_YUZU : customerNumber >= 2 ? BASE_OPTIONS_WITH_STRAWBERRY : BASE_OPTIONS_BASE;
  // Hojicha becomes orderable from order 4 onward -- same unlock as its
  // counter tin on Matcha Making, same "read once" reasoning as baseOptions
  // just above.
  const gradeOptions = customerNumber >= 4 ? GRADE_OPTIONS_WITH_HOJICHA : GRADE_OPTIONS_BASE;
  // Banana foam becomes orderable from order 2 onward, honey syrup/mint
  // leaves from order 3 onward -- same "read once, unmounts between
  // customers" reasoning as baseOptions just above -- see
  // ToppingsStation.js's own bananaFoamUnlocked/honeySyrupUnlocked/
  // mintLeavesUnlocked for the matching counter-side gates.
  const toppingOptions =
    customerNumber >= 3 ? TOPPING_OPTIONS_ORDER3 : customerNumber >= 2 ? TOPPING_OPTIONS_ORDER2 : TOPPING_OPTIONS_BASE;
  // Declared up here (rather than down by orderFormOpen/the order-builder
  // state, where the rest of these would naturally sit) purely so the two
  // bridge effects right below -- which need these refs -- can be
  // registered before useFlatFocusNav(containerRef) further down is. See
  // those effects' own comments for why the registration order matters.
  const playButtonRef = useRef(null);
  const gradeRef = useRef(null);
  const teaspoonRef = useRef(null);
  const cupRef = useRef(null);
  const iceRef = useRef(null);
  const baseRef = useRef(null);
  const toppingsAddRef = useRef(null);
  const placeOrderRef = useRef(null);
  // Ref (not state) purely so the lockdown handler right below -- which
  // has to be declared/registered up here, before the "each leg" Up/Down
  // handler and useFlatFocusNav(containerRef) further down, same ordering
  // reasons as those two -- can read the CURRENT value without needing
  // showReadPhase/showButtonPhase (both declared much further down this
  // component, past the order-builder state) in its own dependency array.
  // Kept in sync every render by the effect sitting right after
  // showButtonPhase's own declaration below.
  const restrictNavigationRef = useRef(false);

  // First-order-only walkthrough lockdown -- while the "read the order" or
  // "find the button" beats are up (i.e. before the order form's ever been
  // opened this visit), arrow keys shouldn't move focus anywhere at all:
  // Enter on the play button (once it's focused -- see the showButtonPhase
  // effect further down) is the only thing that should do anything at that
  // point. Without this, Up/Down would still fall through to the "each leg"
  // handler right below (jumping the still-fresh play-button focus up to
  // the gear or down to the station dot) or, with nothing focused yet
  // during the read phase, to useFlatFocusNav's own defensive "nothing
  // focused, land on the first focusable element" fallback further down --
  // both read as the walkthrough letting the player wander off before it's
  // actually pointed them anywhere yet. Once the order form opens, this
  // flag is already false (see the ref-sync effect below), so the form's
  // own nav trap and every control inside it behaves exactly as normal.
  //
  // Registered here, before both of those, for the exact same "attach the
  // window listener first so it runs first" reasoning the "each leg"
  // effect's own comment right below explains -- stopImmediatePropagation
  // makes this a hard stop rather than merely a first opinion those other
  // handlers could still override.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!restrictNavigationRef.current) return;
      const action = getActionFromKeyEvent(e);
      if (action !== 'Up' && action !== 'Down' && action !== 'Left' && action !== 'Right') return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Bridges between this screen's own containerRef scope and the two
  // things outside it that keyboard nav needs to reach: the Settings gear
  // (rendered once in App.js) and, going the other way, back down to the
  // ProgressBar's current-station dot at the very bottom of the screen.
  // Four legs, each a mirror of another: play button Up -> gear; gear Down
  // (only while its popover is closed -- while open, SettingsPanel's own
  // handler owns Down, moving into the popover's own controls instead) ->
  // play button; play button Down -> station dot. (Station dot Up -> play
  // button is NOT handled here -- that one's already covered for free by
  // the generic useFlatFocusNav(containerRef) hook below, since the dot
  // and the play button are both within this screen's own container and
  // spatially the play button is the nearest qualifying candidate above
  // the dot.) Reaches for .settings-toggle-button/.settings-popover/
  // .progress-step.current by class/DOM query rather than a ref/prop,
  // since none of the three components involved (SettingsPanel, ProgressBar)
  // have a prop path to this one.
  //
  // Registered here, BEFORE useFlatFocusNav(containerRef) below, so its
  // window keydown listener attaches (and therefore runs) first -- this
  // matters: useFlatFocusNav's own Up/Down handling calls focus()
  // synchronously, which updates document.activeElement immediately,
  // still within the same event dispatch. With this effect registered
  // AFTER useFlatFocusNav's (as the play-button-Up leg originally was), a
  // single Up press from the station's dot would let useFlatFocusNav move
  // focus dot -> play button first, and then this handler -- seeing the
  // *already-updated* activeElement now equal to playButtonRef.current --
  // would immediately fire too and jump straight on to the gear, all
  // within that one press (station -> gear in one jump, skipping the play
  // button stop entirely -- the exact bug this ordering already fixed
  // once). Registering this one first instead means it only ever sees the
  // focus state as it was *before* any handler for this keypress has run,
  // so each leg below only ever acts on a genuinely separate, later
  // keypress where the relevant element already had focus coming in --
  // and stopImmediatePropagation on every acted-on leg keeps
  // useFlatFocusNav from ever getting a second, redundant say on the same
  // press once one of these has already decided what to do with it.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Up' && action !== 'Down') return;
      const active = document.activeElement;

      if (active === playButtonRef.current) {
        if (action === 'Up') {
          const gearButton = document.querySelector('.settings-toggle-button');
          if (!gearButton) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          gearButton.focus();
        } else {
          const stationDot = document.querySelector('.progress-step.current');
          if (!stationDot) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          stationDot.focus();
        }
        return;
      }

      if (action === 'Down' && active === document.querySelector('.settings-toggle-button')) {
        const popoverOpen = !!document.querySelector('.settings-popover');
        if (popoverOpen) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        playButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Order-form's own internal keyboard graph -- exact button-to-button
  // path requested, same "explicit fixed graph, not generic spatial
  // nearest-neighbor matching" approach as the Settings popover's own nav
  // (see SettingsPanel.js's own handler for the same reasoning): grade
  // Right -> teaspoons, Down -> cup; teaspoons Down -> cup; cup Right ->
  // ice, Down -> base; ice Up -> grade, Down -> base; base Down ->
  // toppings' own "+ Add topping" toggle; toppings Down -> the first
  // topping chip if any are on the order (see toggleTopping/.order-topping-
  // chip), else straight to Place Order; chips themselves cycle Left/Right
  // among each other (Left from the first one back to "+ Add topping"),
  // Up back to "+ Add topping", Down on to Place Order; Place Order's own
  // Up goes to the LAST chip if any exist, else "+ Add topping" -- all
  // once Place Order actually exists (see isOrderComplete further down --
  // placeOrderRef.current is null until then, so those legs are simply a
  // no-op before that).
  //
  // Every direction is swallowed (preventDefault + stopImmediatePropagation)
  // whenever any of these elements (or a chip) has focus, whether or not it
  // maps to one of the named legs above -- not just the ones with somewhere
  // to go. This is what actually keeps the D-pad contained to the order form
  // while it's open: without it, an unhandled direction (e.g. Down from
  // Place Order, or Up from Grade) would fall through to the generic
  // useFlatFocusNav(containerRef) hook below, which doesn't know this
  // modal is supposed to be a closed loop and would happily walk focus
  // out to whatever's spatially nearest elsewhere on the screen -- the
  // reported bug, where enough Down presses eventually reached the
  // ProgressBar's own station dot underneath the modal. (This trap
  // originally only covered seven named toggles, none of them the
  // dynamically-many topping chips -- an open dropdown's own option list is
  // trapped too, right below -- see that block's own comment.)
  //
  // Registered here, before useFlatFocusNav(containerRef) below, for the
  // same reason (and avoiding the same possible cascade) as the
  // play-button/gear/station bridge above -- these toggles all live
  // within this screen's own container too.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Right' && action !== 'Down' && action !== 'Up' && action !== 'Left') return;
      const active = document.activeElement;

      // Trap + Left/Right movement while focus is on one of an OPEN
      // dropdown's own option buttons (Grade/Teaspoon/Cup/Ice/Base's
      // revealed choice row) -- per request, none of these four
      // directions should be able to escape out to the rest of the order
      // form while a dropdown is open; they should only ever move between
      // this SAME dropdown's own sibling options (or do nothing, at the
      // first/last one, or for Up/Down, which nothing here maps since
      // these lists are single rows) until Enter picks one (which now
      // also closes the dropdown -- see Dropdown's own onClick above) or
      // it's otherwise closed. Plain DOM queries rather than refs, since
      // the option buttons themselves are dynamically many and belong to
      // a child component (Dropdown) that doesn't expose a ref for each
      // one -- .closest('.order-dropdown-list') finds the specific list
      // the focused option belongs to, regardless of which of the five
      // dropdowns it is.
      const optionList = active?.closest?.('.order-dropdown-list');
      if (optionList) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Left' || action === 'Right') {
          const optionButtons = Array.from(optionList.querySelectorAll('.order-dropdown-option'));
          const currentIndex = optionButtons.indexOf(active);
          if (currentIndex === -1) return;
          const nextIndex = action === 'Right' ? currentIndex + 1 : currentIndex - 1;
          optionButtons[nextIndex]?.focus();
        }
        return;
      }

      if (active === gradeRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Right') teaspoonRef.current?.focus();
        else if (action === 'Down') cupRef.current?.focus();
        return;
      }

      if (active === teaspoonRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Down') cupRef.current?.focus();
        else if (action === 'Left') gradeRef.current?.focus();
        return;
      }

      if (active === cupRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Right') iceRef.current?.focus();
        else if (action === 'Down') baseRef.current?.focus();
        else if (action === 'Up') gradeRef.current?.focus();
        return;
      }

      if (active === iceRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Up') gradeRef.current?.focus();
        else if (action === 'Down') baseRef.current?.focus();
        return;
      }

      if (active === baseRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Down') toppingsAddRef.current?.focus();
        else if (action === 'Up') cupRef.current?.focus();
        return;
      }

      // Topping chips (the removable "flavor x" pills that appear once at
      // least one's been added -- see toggleTopping/.order-topping-chip)
      // are now part of this same trapped graph too, sitting between the
      // "+ Add topping" button and Place Order: toppingsAddRef's own Down
      // goes to the first chip (if any exist) instead of jumping straight
      // to Place Order, chips themselves cycle Left/Right among each other
      // (DOM order, same '.order-dropdown-list' pattern above) and go
      // Up back to "+ Add topping" / Down on to Place Order, and Place
      // Order's own Up goes back to the LAST chip (if any) instead of
      // always "+ Add topping" -- keeps a mistaken topping reachable (and
      // removable with Enter, same as clicking it) from anywhere in this
      // loop without ever needing to reopen the add list.
      const chips = containerRef.current
        ? Array.from(containerRef.current.querySelectorAll('.order-topping-chip'))
        : [];

      if (active === toppingsAddRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Down') {
          if (chips[0]) chips[0].focus();
          else if (placeOrderRef.current) placeOrderRef.current.focus();
        } else if (action === 'Up') {
          baseRef.current?.focus();
        }
        return;
      }

      const chipIndex = chips.indexOf(active);
      if (chipIndex !== -1) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Right') {
          chips[chipIndex + 1]?.focus();
        } else if (action === 'Left') {
          if (chipIndex === 0) toppingsAddRef.current?.focus();
          else chips[chipIndex - 1]?.focus();
        } else if (action === 'Up') {
          toppingsAddRef.current?.focus();
        } else if (action === 'Down' && placeOrderRef.current) {
          placeOrderRef.current.focus();
        }
        return;
      }

      if (active === placeOrderRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Up') {
          if (chips[chips.length - 1]) chips[chips.length - 1].focus();
          else toppingsAddRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useFlatFocusNav(containerRef);

  // Rolled once per mount (i.e. once per customer -- see the big comment
  // above generateSpokenOrder) via the lazy initializer, so it doesn't
  // re-roll on every re-render (opening a dropdown, picking a value, etc).
  const [spokenOrder] = useState(() => generateSpokenOrder(customerNumber, gradeOptions, baseOptions, toppingOptions));
  const speechSegments = buildSpeechSegments(spokenOrder, gradeOptions, baseOptions);
  const speechText = flattenSegments(speechSegments);

  // Which of the three customer characters (CUSTOMER_CHARACTERS above) is at
  // the counter this round -- rolled once per mount via the lazy
  // initializer, same "once per customer, not re-rolled on every re-render"
  // reasoning as spokenOrder just above.
  const [customerCharacter] = useState(() => pickRandom(Object.keys(CUSTOMER_CHARACTERS)));

  // Typewriter effect -- same one the very first version of this screen's
  // speech bubble had (reveal one more character every TYPE_INTERVAL_MS, so
  // the bubble looks like the customer is actually talking) before this
  // screen was rebuilt around the play-button/modal order form. Runs
  // unconditionally on mount (tied only to speechText, which -- like
  // spokenOrder above -- only ever changes on remount/new customer) --
  // typing happens concurrently with the read-acknowledgment gate below,
  // not gated behind it.
  const [visibleChars, setVisibleChars] = useState(0);
  useEffect(() => {
    setVisibleChars(0);
    const TYPE_INTERVAL_MS = 35;
    const intervalId = setInterval(() => {
      setVisibleChars((prev) => {
        if (prev >= speechText.length) {
          clearInterval(intervalId);
          return prev;
        }
        return prev + 1;
      });
    }, TYPE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [speechText]);

  // First-order-only walkthrough, "read the order" phase -- drives the
  // callout (arrow + label) and the spotlight's own character/bubble
  // cutouts (see .ordering-spotlight-overlay further down). Starts true
  // only for customerNumber === 1 (2nd/3rd orders never show it), and
  // switches off 2 seconds after the typewriter above actually finishes --
  // not the instant it finishes, so there's a real beat to read the order
  // before this phase ends and the "button" phase below takes over.
  const typingDone = visibleChars >= speechText.length;
  const [showReadPhase, setShowReadPhase] = useState(customerNumber === 1);
  useEffect(() => {
    if (customerNumber !== 1 || !typingDone) return undefined;
    const READ_PHASE_LINGER_MS = 2000;
    const timeoutId = setTimeout(() => setShowReadPhase(false), READ_PHASE_LINGER_MS);
    return () => clearTimeout(timeoutId);
  }, [customerNumber, typingDone]);

  // Character voice line -- plays once, right as the speech bubble starts
  // typing (this effect and the typewriter one above both fire on mount,
  // i.e. once per customer/remount, for the same reason). Keyed off
  // whichever character customerCharacter rolled above (not the rolled
  // spokenOrder text), so this stays "that character's own ordering line"
  // no matter what they order. All five characters now have a recorded
  // line (CHARACTER_ORDERING_AUDIO above) -- the src/!src check below is
  // kept regardless, so a future character added without its own line yet
  // still silently skips playing anything instead of erroring.
  // Routed through sfx.js's playVoiceLine (a one-shot clip, same "not
  // App.js's looping <audio ref> element" distinction as before) so it's
  // controlled by the Settings panel's "Sound" slider rather than always
  // playing at full volume. Autoplay can still be blocked the same way
  // background music's can be (see App.js's own tryPlay/catch) if this is
  // somehow the very first sound of the session with no prior user gesture;
  // unlike background music there's no first-gesture retry for a one-shot
  // line like this, it just silently doesn't play that round.
  // Held in a ref (not just a local const in the effect below) so the
  // separate typingDone effect further down can reach the same Audio
  // instance and cut it short -- see that effect's own comment.
  const orderingAudioRef = useRef(null);
  useEffect(() => {
    const src = CHARACTER_ORDERING_AUDIO[customerCharacter];
    if (!src) return undefined;
    const audio = playVoiceLine(src);
    orderingAudioRef.current = audio;
    return () => {
      audio.pause();
      orderingAudioRef.current = null;
    };
  }, [customerCharacter]);

  // Cuts the voice line short the instant the typewriter above actually
  // finishes (typingDone) -- per request, the recorded clips tend to run
  // noticeably longer than the bubble takes to finish typing out, which
  // read as awkward with the character still talking well after their own
  // line has finished appearing on screen. A plain .pause() (not swapping
  // the src or anything more involved) is enough, same "just stop it"
  // treatment playLiquidPouring's own callers already use to cut a pour's
  // clip short once its own visual finishes. Separate effect (rather than
  // folded into the play effect above) since this one's dependency is
  // typingDone, not customerCharacter -- combining them would either
  // re-trigger playback on every typingDone flip or miss the cutoff
  // entirely depending on which dependency actually changed.
  useEffect(() => {
    if (typingDone) {
      orderingAudioRef.current?.pause();
    }
  }, [typingDone]);

  // ---- Order-builder state -----------------------------------------------
  // Four sections (matcha, cup & ice, base, toppings) -- now shown inside a
  // modal rectangle (see orderFormOpen below) opened via the play button on
  // the ordering computer's screen, rather than pinned permanently to the
  // receipt paper the way they were before this background/layout changed.
  // All start unset/empty; there's no correctness checking wired up yet
  // (that would compare these against the active order), just the controls
  // themselves.
  const [matchaGrade, setMatchaGrade] = useState(null);
  const [teaspoons, setTeaspoons] = useState(null);
  const [cupType, setCupType] = useState(null);
  const [iceCubes, setIceCubes] = useState(null);
  const [baseMilk, setBaseMilk] = useState(null);
  // Each added topping still gets its own id (toppingIdRef below) even
  // though there's now only ever at most one per value (see toggleTopping
  // below -- picking an already-added flavor in the list removes it rather
  // than stacking a second copy, per request) -- keeps the id-keyed
  // chip/removal plumbing below unchanged rather than switching it over to
  // keying by value directly.
  const [toppings, setToppings] = useState([]); // { id, value }[]
  const toppingIdRef = useRef(0);

  // Only one dropdown/adder row open at a time -- opening a new one closes
  // whatever was already open. Holds the control's key ('grade',
  // 'teaspoons', 'cup', 'ice', 'base', 'toppings') or null.
  const [openControl, setOpenControl] = useState(null);
  const toggleControl = (key) => setOpenControl((prev) => (prev === key ? null : key));

  // First topping option gets focus automatically the instant this list
  // opens, same as every other dropdown's own first-option autofocus (see
  // Dropdown's own effect above) -- toppings' own reveal list isn't built
  // from the shared Dropdown component (it needs its own add-without-
  // closing-the-form / removable-chips behavior instead of a single
  // select), so it needs this same behavior wired up separately here
  // rather than getting it for free from that component.
  const toppingsFirstOptionRef = useRef(null);
  useEffect(() => {
    if (openControl === 'toppings') {
      toppingsFirstOptionRef.current?.focus();
    }
  }, [openControl]);

  // Picking a flavor that isn't on the order yet adds it; picking one
  // that's already there removes it instead of stacking a duplicate --
  // per request, so double-clicking (or any mis-click) on the same
  // topping undoes itself instead of silently adding a second copy. Same
  // dropdown-closes/refocuses-the-adder-button behavior either way.
  const toggleTopping = (value) => {
    playButtonClick();
    setToppings((prev) =>
      prev.some((t) => t.value === value) ? prev.filter((t) => t.value !== value) : [...prev, { id: toppingIdRef.current++, value }]
    );
    setOpenControl(null);
    toppingsAddRef.current?.focus();
  };
  const removeTopping = (id) => {
    playButtonClick();
    setToppings((prev) => prev.filter((t) => t.id !== id));
  };

  // ---- Order-form modal: opened via the play button on the computer's
  // screen (see .ordering-play-button below), closed via the modal's own
  // close button or by clicking the backdrop behind it. Any dropdown left
  // open gets closed too (openControl reset) so re-opening the modal later
  // always starts from a clean, fully-closed state rather than resuming
  // wherever a dropdown happened to be left.
  const [orderFormOpen, setOrderFormOpen] = useState(false);

  const closeOrderForm = () => {
    setOrderFormOpen(false);
    setOpenControl(null);
    playButtonRef.current?.focus();
  };

  // First thing selected the instant the order form opens is the Grade
  // toggle, per request -- same "rising edge only" pattern as
  // ProgressBar.js's own highlightCurrentStep focus-effect (keyed on
  // orderFormOpen itself, not e.g. openControl, so this only steals focus
  // when the modal actually opens, not on every re-render while it's up).
  useEffect(() => {
    if (orderFormOpen) {
      gradeRef.current?.focus();
    }
  }, [orderFormOpen]);

  // First-order-only walkthrough, "use the button" phase -- once
  // showReadPhase above ends, the spotlight stays up but its cutouts swap
  // from character+bubble to play-button+bubble instead (see
  // showButtonPhase below and the exempt-from-tint classes further down),
  // pointing the player at the play button next rather than the character.
  // hasOpenedOrderForm is a one-way flag (never resets back to false) so
  // this phase doesn't pop back up if the player opens the form, decides to
  // look around, and closes it again without placing the order yet --
  // once they've found the button once, this walkthrough beat is done.
  const [hasOpenedOrderForm, setHasOpenedOrderForm] = useState(false);
  useEffect(() => {
    if (orderFormOpen) setHasOpenedOrderForm(true);
  }, [orderFormOpen]);
  const showButtonPhase = customerNumber === 1 && !showReadPhase && !hasOpenedOrderForm;

  // Moves focus onto the play button the instant showButtonPhase turns on,
  // same "rising edge only" pattern as orderFormOpen's own grade-toggle
  // effect above -- pairs with ProgressBar's suppressInitialFocus (passed
  // below) so the station dot never grabs the walkthrough's very first
  // selection instead: nothing is focused during showReadPhase, then this
  // hands focus straight to the play button (its :focus-visible halo, see
  // .ordering-play-button in CustomerOrdering.css) the moment the "Move up
  // to take the order" callout appears, ready for Enter.
  useEffect(() => {
    if (showButtonPhase) {
      playButtonRef.current?.focus();
    }
  }, [showButtonPhase]);

  // Keeps restrictNavigationRef (declared/read far above the lockdown
  // handler -- see that ref's own comment for why it exists at all) in
  // sync with the two flags it actually gates on. No dependency array --
  // this just re-reads both every render, which is cheap and means the ref
  // can never go stale a render behind either flag.
  useEffect(() => {
    restrictNavigationRef.current = showReadPhase || showButtonPhase;
  });

  // Third walkthrough beat, first order only -- once the order
  // form modal is actually open, its own backdrop (see .order-modal-backdrop
  // below) already covers literally everything on screen except the modal
  // itself, which is exactly the "pink over everything but the order panel"
  // shape the first two phases were built around -- so rather than stacking
  // a second overlay underneath it, this just recolors that existing
  // backdrop to the same pink tint (see .order-modal-backdrop--walkthrough
  // in CustomerOrdering.css) instead of its normal dark dim, and shows a
  // short label above the modal explaining what to do with it. Tied
  // directly to orderFormOpen, so it starts the instant the modal opens and
  // ends the instant it closes (either by placing the order or backing out
  // via the backdrop click) -- no separate linger/one-way flag needed here.
  const showFormPhase = customerNumber === 1 && orderFormOpen;

  // Half a second after landing on this screen, the play button becomes
  // enabled/focusable (see disabled={!tabletPromptActive} below) -- used to
  // also flash a green halo plus a nearby hint label at this same moment,
  // both removed per request (see the ordering-spotlight-overlay comment
  // further down for the walkthrough treatment that replaced them).
  // Opening the order form itself is handled
  // entirely by the button's own native onClick below now -- there used to
  // also be a separate window-level keydown listener here that opened the
  // form on Enter regardless of what was focused, which is exactly what
  // broke Settings: with Up/Down keyboard nav now wired between this
  // button and the Settings gear, pressing Enter while the *gear* was
  // focused was still being hijacked by this listener and opening the
  // order form instead of toggling Settings. Removed -- once the button is
  // actually focused (reached via Up from the station dot, per the nav
  // chain above), Enter already "just works" via ordinary <button>
  // behavior and fires the exact same onClick, including the click sound
  // it plays (a bonus the old hijacked path skipped).
  const [tabletPromptActive, setTabletPromptActive] = useState(false);
  useEffect(() => {
    const timeoutId = setTimeout(() => setTabletPromptActive(true), 500);
    return () => clearTimeout(timeoutId);
  }, []);

  // "Place Order" only appears once every required section has a selection
  // -- toppings is the one section left out of this check since it's an
  // optional adder (a drink with no extra toppings is still a complete
  // order), not a required dropdown like the other four.
  const isOrderComplete =
    matchaGrade !== null && teaspoons !== null && cupType !== null && iceCubes !== null && baseMilk !== null;

  // Fourth highlight beat -- once the order's actually been placed (not
  // just the modal closed via the X/backdrop), the progress bar's current
  // step (still "Take Order" at this point) flashes and points the player
  // at the Left/Right shortcut just added to it (see highlightCurrentStep/
  // currentStepHint passed to <ProgressBar> below, and
  // .progress-step.station-highlight/.progress-station-hint in
  // ProgressBar.css). Deliberately tied to actually placing the order
  // (this flag), not merely orderFormOpen going false, so closing the
  // modal early via the X button doesn't trigger it.
  const [showStationHint, setShowStationHint] = useState(false);

  // Fourth and final walkthrough beat, first order only -- once the order's
  // actually been placed (showStationHint above, set true at the end of
  // placeOrder below, never reset false again for this mount), this phase
  // simply lasts until the player leaves this screen for the matcha
  // station, same as the dot-highlight/hint it already drives on
  // ProgressBar. Reuses the exact same pink spotlight (see showSpotlight
  // below) as the first two phases, this time exempting the progress bar
  // itself (see spotlightExempt passed to <ProgressBar> further down)
  // instead of the character/button, with its own down-pointing callout
  // above the bar telling the player where to go next.
  const showProgressPhase = customerNumber === 1 && showStationHint;

  // Whether the spotlight overlay itself renders at all -- any of the
  // three "pink over the whole screen" phases (the fourth, showFormPhase,
  // instead recolors the order-modal's own backdrop rather than using this
  // overlay -- see that flag's own comment above).
  const showSpotlight = showReadPhase || showButtonPhase || showProgressPhase;

  const placeOrder = () => {
    playButtonClick();
    const order = {
      matchaGrade,
      teaspoons,
      cupType,
      iceCubes,
      baseMilk,
      toppings: toppings.map((t) => t.value),
      // Threaded through App.js's own currentOrder state all the way to
      // FinalCombination/ScoreCard, so the score sheet's title can read
      // "<Name> Order" for whichever of the three characters (see
      // CUSTOMER_CHARACTERS above) this round's customer happened to be.
      customerCharacter,
    };
    onPlaceOrder?.(order);
    // Grades this order against the customer's own spoken order (see
    // spokenOrder/generateSpokenOrder above) -- both are independently
    // rolled, so this is the "did the order actually match what was asked
    // for" check for the score card's own Order Taking category (see
    // gameloop/scoring.js). Computed right here, the one place both objects
    // are ever in scope together, and lifted up to App.js the same way
    // onPlaceOrder itself is.
    onOrderScored?.(scoreOrderTaking(order, spokenOrder));
    closeOrderForm();
    setShowStationHint(true);
  };

  return (
    <div className="ordering-container" ref={containerRef}>
      <h1 className="sr-only">Customer Ordering</h1>

      <div className="ordering-content">
        <img
          src="./TakeOrderFrame.jpg"
          alt="The take-order counter, with an ordering computer terminal"
          className="ordering-art"
        />
        {/* The customer character, composited on top of the background
            rather than baked into it -- same "cut character out of the
            background so it can eventually be swapped per customer"
            approach the matcha/toppings stations use for their own props.
            Now actually swapped per customer -- randomly one of Annie/Otto/
            Katie/Teddy/Coco (see customerCharacter/CUSTOMER_CHARACTERS
            above) instead of always Annie's own BunnyOrder.png -- see
            .ordering-bunny in
            CustomerOrdering.css (class name kept as-is even though it's not
            always the bunny anymore, to avoid churning that stylesheet's
            own selector for a purely cosmetic rename). */}
        <img
          src={CUSTOMER_CHARACTERS[customerCharacter].src}
          alt={CUSTOMER_CHARACTERS[customerCharacter].alt}
          className={`ordering-bunny${showReadPhase ? ' ordering-spotlight-exempt' : ''}`}
        />

        {/* Speech bubble, sitting above the bunny's head -- now carries the
            customer's actual (randomized, see generateSpokenOrder/
            buildSpeechSegments above) spoken order line instead of sitting
            empty. Height is min-height rather than a fixed height (see
            CustomerOrdering.css) since this text's length varies a lot
            round to round (0 vs 7 toppings is a big swing), so the bubble
            grows to fit rather than clipping long orders.

            The tail is an inline SVG polygon (not the old stacked
            CSS-border-triangle trick) so its outline can use a real `stroke`
            -- that's the only way to get the tail's point to read as the
            same ~4px border weight as the bubble's own border instead of
            looking like a solid, thicker wedge.

            Wrapped (along with the read-acknowledgment hint label below) in
            .ordering-speech-wrap, a flex column -- the wrap now owns the
            left/top/width positioning that used to live on the bubble
            itself, so the hint label always lands directly under the
            bubble with a small gap regardless of how tall the bubble's
            content makes it grow, instead of needing its own separately
            guessed percentage position. */}
        <div
          className={`ordering-speech-wrap${
            showReadPhase || showButtonPhase ? ' ordering-spotlight-exempt' : ''
          }`}
        >
          {/* No longer gated behind an Enter-to-acknowledge step (see the
              removed orderAcknowledged state above) -- the bubble just
              shows the order as it types out, with no flashing halo or
              "click Enter to continue" prompt to clear first. */}
          <div className="ordering-speech-bubble">
            <p className="ordering-speech-bubble-text">
              {sliceSegments(speechSegments, visibleChars).map((seg, i) =>
                seg.highlight ? (
                  <span key={i} className="ordering-speech-highlight">
                    {seg.text}
                  </span>
                ) : (
                  <React.Fragment key={i}>{seg.text}</React.Fragment>
                )
              )}
            </p>
            <svg
              className="ordering-speech-bubble-tail"
              viewBox="0 0 30 22"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="2,0 28,0 15,19" />
            </svg>
          </div>
        </div>

        {/* Play button on the ordering computer's screen -- opens the
            order-builder modal below. Styled to match .progress-step-dot
            in ProgressBar.css (same white circle/brown border/dark text
            look as the progress bar's numbered steps), shifted well down
            per request. Eyeballed position -- no reference for exactly
            where the computer screen sits in the new art. */}
        <button
          ref={playButtonRef}
          type="button"
          className={`ordering-play-button${showButtonPhase ? ' ordering-spotlight-exempt' : ''}`}
          data-focusable
          // Disabled (unfocusable/unclickable, and skipped by
          // useFlatFocusNav's own `!el.disabled` filter) until it's
          // actually this button's turn to be highlighted (tabletPromptActive)
          // -- covers both the first highlight beat (bubble) and the
          // half-second gap before the second one starts, so a keyboard/
          // D-pad user can't route around either gate.
          disabled={!tabletPromptActive}
          aria-label="Open order form"
          aria-haspopup="dialog"
          aria-expanded={orderFormOpen}
          onClick={() => {
            playButtonClick();
            setTabletPromptActive(false);
            setOrderFormOpen(true);
          }}
        >
          &#9654;
        </button>

        {orderFormOpen && (
          <>
            {/* Clicking the dimmed backdrop closes the modal (mouse-only --
                there's no keyboard/D-pad equivalent for this early-exit
                path anymore; the dedicated close (X) button that used to
                cover that was removed since completing the order via Place
                Order already closes the modal, making a separate close
                button redundant). During showFormPhase (first order only)
                this same element also carries the walkthrough's pink tint
                instead of its normal dark dim -- see showFormPhase above. */}
            <div
              className={`order-modal-backdrop${showFormPhase ? ' order-modal-backdrop--walkthrough' : ''}`}
              onClick={closeOrderForm}
            />
            {/* Third walkthrough beat, first order only -- two labels sitting
                in the open counter space to the RIGHT of the modal (which
                is horizontally centered, see .order-modal, so its right
                edge never reaches this far over), shown one at a time
                rather than together: the first (arrow + label, arrow aimed
                back at the modal same as before) covers the fill-in-the-
                sections step and is up while the order's still incomplete;
                the instant isOrderComplete flips true and the Place Order
                button itself actually appears (see further down), this one
                is replaced by the second, arrow-less label pointing the
                player at that new button instead -- never both at once, so
                there's always exactly one instruction on screen for
                whichever step the player's actually on. */}
            {showFormPhase && !isOrderComplete && (
              <div className="ordering-form-callout">
                <svg
                  className="ordering-form-callout-arrow"
                  viewBox="0 0 40 24"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polygon points="2,12 36,2 36,22" />
                </svg>
                <p className="ordering-form-callout-text">accurately fill in the order</p>
              </div>
            )}
            {showFormPhase && isOrderComplete && (
              <p className="ordering-form-callout-text ordering-form-callout-text--lower">
                press the button below to place the order
              </p>
            )}
            <div
              className="order-modal"
              role="dialog"
              aria-label="Order form"
            >
              {/* Four small sections, each covering one part of the order:
                  matcha (grade + teaspoons), cup & ice (cup type + ice
                  count), base (milk/water), and toppings (repeatable adder
                  + removable chips). */}
              <div className="order-form">
                <div className="order-section">
                  <h2 className="order-section-title">matcha</h2>
                  <div className="order-section-row">
                    <Dropdown
                      placeholder="grade"
                      options={gradeOptions}
                      value={matchaGrade}
                      onSelect={setMatchaGrade}
                      isOpen={openControl === 'grade'}
                      onToggle={() => toggleControl('grade')}
                      toggleRef={gradeRef}
                    />
                    <Dropdown
                      placeholder="tsp"
                      options={TEASPOON_OPTIONS}
                      value={teaspoons}
                      onSelect={setTeaspoons}
                      isOpen={openControl === 'teaspoons'}
                      onToggle={() => toggleControl('teaspoons')}
                      toggleRef={teaspoonRef}
                    />
                  </div>
                </div>

                <div className="order-section">
                  <h2 className="order-section-title">cup &amp; ice</h2>
                  <div className="order-section-row">
                    <Dropdown
                      placeholder="cup"
                      options={CUP_OPTIONS}
                      value={cupType}
                      onSelect={setCupType}
                      isOpen={openControl === 'cup'}
                      onToggle={() => toggleControl('cup')}
                      toggleRef={cupRef}
                    />
                    <Dropdown
                      placeholder="ice"
                      options={ICE_OPTIONS}
                      value={iceCubes}
                      onSelect={setIceCubes}
                      isOpen={openControl === 'ice'}
                      onToggle={() => toggleControl('ice')}
                      toggleRef={iceRef}
                    />
                  </div>
                </div>

                <div className="order-section">
                  <h2 className="order-section-title">base</h2>
                  <Dropdown
                    placeholder="milk / water"
                    options={baseOptions}
                    value={baseMilk}
                    onSelect={setBaseMilk}
                    isOpen={openControl === 'base'}
                    onToggle={() => toggleControl('base')}
                    toggleRef={baseRef}
                  />
                </div>

                <div className="order-section">
                  <h2 className="order-section-title">toppings</h2>
                  <div className="order-dropdown">
                    <button
                      ref={toppingsAddRef}
                      type="button"
                      className={`order-add-button${openControl === 'toppings' ? ' open' : ''}`}
                      data-focusable
                      onClick={() => {
                        playButtonClick();
                        toggleControl('toppings');
                      }}
                    >
                      + add topping
                    </button>
                    {openControl === 'toppings' && (
                      <div className="order-dropdown-list">
                        {toppingOptions.map((opt, index) => {
                          const chosen = toppings.some((t) => t.value === opt.value);
                          return (
                          <button
                            key={opt.value}
                            ref={index === 0 ? toppingsFirstOptionRef : undefined}
                            type="button"
                            className={`order-dropdown-option${chosen ? ' selected' : ''}`}
                            data-focusable
                            onClick={() => toggleTopping(opt.value)}
                            aria-pressed={chosen}
                            aria-label={chosen ? `${opt.label}. Already added -- select to remove.` : opt.label}
                          >
                            {opt.label}
                          </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {toppings.length > 0 && (
                    <div className="order-topping-chips">
                      {toppings.map((t) => {
                        const opt = toppingOptions.find((o) => o.value === t.value);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className="order-topping-chip"
                            data-focusable
                            onClick={() => removeTopping(t.id)}
                            aria-label={`${opt.label}. Select to remove.`}
                          >
                            {opt.label} &times;
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Only shows up once every required section above has a
                    selection -- see isOrderComplete. Places the order (lifts
                    it up to App.js via onPlaceOrder so the station screens'
                    OrderReceiptButton can show it instead of the old
                    hardcoded receipt image) and closes the modal. */}
                {isOrderComplete && (
                  <button
                    ref={placeOrderRef}
                    type="button"
                    className="order-place-button"
                    data-focusable
                    // No autoFocus (removed per request) -- this mounts as
                    // soon as Base is filled in (toppings isn't required
                    // for isOrderComplete), and stealing focus the instant
                    // it appears used to yank the player away from Base
                    // right after picking it, before they'd had any chance
                    // to decide whether to visit Toppings first. Leaving
                    // this unfocused means focus simply stays on Base
                    // after selecting it, and the player reaches this
                    // button on their own terms via the order-form nav
                    // graph's Down-from-base -> toppings -> Down-from-
                    // toppings -> here chain above.
                    onClick={placeOrder}
                  >
                    place order
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        <ProgressBar
          activeStep={activeStep}
          customerNumber={customerNumber}
          onNavigate={onNavigate}
          onAdvance={onAdvance}
          highlightCurrentStep={showStationHint}
          // Suppressed for the first order specifically -- showProgressPhase
          // below puts its own pink-backed, arrow-pointing callout above the
          // bar instead, and showing both at once would just be the same
          // "go to the next station" message said twice. Orders 2/3 never
          // set showProgressPhase (customerNumber !== 1), so they keep
          // getting this plain text hint exactly as before.
          currentStepHint={showProgressPhase ? null : 'use your right arrow key to head to the matcha station.'}
          spotlightExempt={showProgressPhase}
          // See ProgressBar's own comment on this prop -- suppresses the
          // station dot's autoFocus while the first two walkthrough beats
          // (read the order / find the button) are up, so it isn't the
          // thing holding the initial selection; showButtonPhase's own
          // effect above hands focus to the play button instead once its
          // callout appears.
          suppressInitialFocus={showReadPhase || showButtonPhase}
        />

        {/* First-order-only walkthrough spotlight -- a single light
            pastel-pink dim over the ENTIRE screen (art, window, play
            button, ProgressBar, everything). Used to punch two holes
            through it via an SVG mask so the character/bubble showed
            through -- dropped that (kept leaving visible gaps around both,
            never quite matching their real edges) in favor of the simpler,
            sturdier fix: this is now a plain flat-colored div with no holes
            at all, and whichever elements need to show through it are given
            the shared .ordering-spotlight-exempt z-index modifier instead
            (see .ordering-bunny/.ordering-speech-wrap/.ordering-play-button/
            ProgressBar's own spotlightExempt prop and their own conditional
            classNames) -- they already sit earlier in this file's own DOM
            order, so without that they'd normally paint UNDER this
            later-rendered overlay; the explicit z-index is what puts them
            back on top of it, fully untinted, regardless of DOM order.

            Three-phase lifecycle for customerNumber === 1 only (see
            showReadPhase/showButtonPhase/showProgressPhase above): the
            overlay itself stays up for all three (showSpotlight = any of
            them), but which element is exempt changes each time -- phase 1
            ("read phase") exempts the character + bubble while the order's
            still typing out (plus a 7s linger after it finishes) so the
            player focuses on reading it; phase 2 ("button phase") swaps the
            exemption to the play button + bubble instead, nudging the
            player toward the button next, and stays up until they actually
            open the order form for the first time; phase 3 ("progress
            phase") kicks in once the order's actually been placed, and
            swaps the exemption again to the progress bar itself, pointing
            the player at the next station. (The order-form modal itself,
            open between phases 2 and 3, uses a different mechanism
            entirely -- see showFormPhase/.order-modal-backdrop--walkthrough
            above -- since that modal's own backdrop already covers
            everything but itself, no separate overlay needed there.)
            pointer-events: none so it never blocks input even while it's
            up. */}
        {showSpotlight && <div className="ordering-spotlight-overlay" aria-hidden="true" />}

        {/* First-order-only walkthrough callout -- a message plus an arrow
            pointing across the screen at the speech bubble, sitting in the
            open space to its left (see .ordering-read-order-callout in
            CustomerOrdering.css for exact placement). Only shown during
            showReadPhase (not the later showButtonPhase) -- once the read
            phase ends the callout's job is done, only the spotlight's own
            exemption target changes over to the play button. z-index above
            the spotlight overlay (same as the bunny/speech-wrap) so the
            pink tint doesn't wash it out. */}
        {showReadPhase && (
          <div className="ordering-read-order-callout">
            <svg
              className="ordering-read-order-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,2 22,36 2,36" />
            </svg>
            <p className="ordering-read-order-callout-text">carefully read the customer&apos;s order</p>
          </div>
        )}

        {/* Second walkthrough beat, phase 2 only -- once the read phase
            ends and the spotlight's exemption swaps over to the play
            button (see showButtonPhase above), this callout sits just
            below the button with its own arrow pointing straight up at it,
            same "arrow + short label" shape as the read-phase callout
            above but telling the player where to go next instead of what
            to do: move up (the D-pad/keyboard direction that actually
            focuses the button, per the nav chain on .ordering-play-button
            itself) from their station number to reach it. Gone the instant
            showButtonPhase ends (order form opened), same as every other
            walkthrough element on this screen. */}
        {showButtonPhase && (
          <div className="ordering-button-callout">
            <svg
              className="ordering-button-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,2 22,36 2,36" />
            </svg>
            <p className="ordering-button-callout-text">take the order</p>
          </div>
        )}

        {/* Third and final walkthrough beat -- once the order's actually
            been placed and the spotlight's exemption swaps over to the
            progress bar itself (see showProgressPhase above and
            spotlightExempt on <ProgressBar>), this callout sits above the
            bar with its own arrow pointing straight down at it -- text on
            top, arrow below, mirrored from the read-phase callout's
            arrow-above-text layout since the thing being pointed at is now
            below this box instead of above it. Gone the instant the player
            actually leaves for the matcha station (this whole component
            unmounts then), same as every other walkthrough element on this
            screen. */}
        {showProgressPhase && (
          <div className="ordering-progress-callout">
            <p className="ordering-progress-callout-text">head to the next station to start making the drink</p>
            <svg
              className="ordering-progress-callout-arrow"
              viewBox="0 0 24 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerOrdering;
