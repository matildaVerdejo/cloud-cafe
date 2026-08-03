import React, { useEffect, useRef, useState } from 'react';
import './CustomerOrdering.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { getActionFromKeyEvent } from '../gameloop/pal';
import { playButtonClick, playVoiceLine } from '../gameloop/sfx';
import ProgressBar from './ProgressBar';

// ---- Order-builder option lists ------------------------------------------
// One list per dropdown/adder below, each a plain { value, label } pair --
// value is what gets stored in state, label is what's shown to the player.
const GRADE_OPTIONS = [
  { value: 'cafe', label: 'Cafe' },
  { value: 'classic', label: 'Classic' },
  { value: 'ceremonial', label: 'Ceremonial' },
];
const TEASPOON_OPTIONS = [1, 2, 3].map((n) => ({ value: n, label: `${n} tsp` }));
const CUP_OPTIONS = [
  { value: 'glass', label: 'Glass' },
  { value: 'mug', label: 'Mug' },
  { value: 'plastic', label: 'Plastic' },
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
  { value: 'dairy', label: 'Dairy milk' },
  { value: 'oat', label: 'Oat milk' },
  { value: 'almond', label: 'Almond milk' },
  { value: 'coconut', label: 'Coconut water' },
];
const BASE_OPTIONS_WITH_STRAWBERRY = [...BASE_OPTIONS_BASE, { value: 'strawberry', label: 'Strawberry milk' }];
const TOPPING_OPTIONS = [
  { value: 'guava-syrup', label: 'Guava syrup' },
  { value: 'mint-syrup', label: 'Mint syrup' },
  { value: 'reg-foam', label: 'Reg cold foam' },
  { value: 'matcha-foam', label: 'Matcha cold foam' },
  { value: 'guava-powder', label: 'Guava powder' },
  { value: 'matcha-powder', label: 'Matcha powder' },
  { value: 'mint-leaves', label: 'Mint leaves' },
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
const GREETINGS = ['Hello!', 'Hi!', 'Howdy!'];

// A couple of these read better spoken aloud than their short dropdown-chip
// labels (e.g. TOPPING_OPTIONS' "Reg cold foam" -> "regular foam" here), so
// this is a separate speech-name map rather than reusing `label` directly.
const TOPPING_SPEECH_NAMES = {
  'guava-syrup': 'guava syrup',
  'mint-syrup': 'mint syrup',
  'reg-foam': 'regular foam',
  'matcha-foam': 'matcha foam',
  'guava-powder': 'guava powder',
  'matcha-powder': 'matcha powder',
  'mint-leaves': 'mint leaves',
};

// ---- Per-character ordering voice line -----------------------------------
// One short voice-over clip per customer character, keyed by character id
// -- tied to WHO is at the counter, not to what they happen to order (the
// spoken order text itself is randomized separately by generateSpokenOrder
// above). Annie the bunny is the only character today; adding a new
// character later means adding another entry here (and setting
// CUSTOMER_CHARACTER appropriately for that round) rather than touching the
// playback logic below at all.
const CHARACTER_ORDERING_AUDIO = {
  annie: './AnnieOrdering.wav',
};

// Which character is at the counter this round. Hardcoded to 'annie' since
// she's the only customer character that exists yet -- once more characters
// are added, this should be derived per-customer (e.g. from customerNumber
// or a prop) instead of a fixed constant.
const CUSTOMER_CHARACTER = 'annie';

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
// baseOptions is passed in (rather than this reading the module-level
// BASE_OPTIONS_BASE directly) so whichever milk pool the component decided
// is unlocked this round (see baseOptions in the component below) is what
// the customer can actually ask for -- order 1 can never randomly speak an
// ingredient (strawberry milk) the player hasn't seen on the counter yet.
function generateSpokenOrder(customerNumber, baseOptions) {
  const toppingCap = customerNumber === 1 ? pickRandom([2, 3]) : TOPPING_OPTIONS.length;
  return {
    greeting: pickRandom(GREETINGS),
    teaspoons: pickRandom(TEASPOON_OPTIONS).value,
    grade: pickRandom(GRADE_OPTIONS).value,
    cup: pickRandom(CUP_OPTIONS).value,
    ice: pickRandom(ICE_OPTIONS).value,
    milk: pickRandom(baseOptions).value,
    toppings: pickRandomSubset(TOPPING_OPTIONS, toppingCap).map((t) => t.value),
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
function buildSpeechSegments(o, baseOptions) {
  const grade = GRADE_OPTIONS.find((g) => g.value === o.grade).label.toLowerCase();
  const cup = CUP_OPTIONS.find((c) => c.value === o.cup).label.toLowerCase();
  const milk = baseOptions.find((m) => m.value === o.milk).label.toLowerCase();
  const tspWord = o.teaspoons === 1 ? 'teaspoon' : 'teaspoons';
  const iceWord = o.ice === 1 ? 'ice cube' : 'ice cubes';

  const segments = [
    { text: `${o.greeting} May I have a drink with `, highlight: false },
    { text: `${o.teaspoons} ${tspWord}`, highlight: true },
    { text: ' of ', highlight: false },
    { text: grade, highlight: true },
    { text: ' grade matcha, in a ', highlight: false },
    { text: cup, highlight: true },
    { text: ' cup with ', highlight: false },
    { text: `${o.ice} ${iceWord}`, highlight: true },
    { text: '. May I please have that with ', highlight: false },
    { text: milk, highlight: true },
  ];

  if (o.toppings.length > 0) {
    const toppingNames = o.toppings.map((v) => TOPPING_SPEECH_NAMES[v]);
    segments.push({ text: ", and I'd like to add on ", highlight: false });
    segments.push(...joinWithAndSegments(toppingNames));
  }

  segments.push({ text: '. Thank you!', highlight: false });
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

const CustomerOrdering = ({ activeStep, customerNumber, onNavigate, onAdvance, onPlaceOrder }) => {
  const containerRef = useRef(null);
  // Strawberry milk only becomes orderable from order 2 onward -- same
  // unlock as its counter bottle on Milk Selection. This screen fully
  // unmounts/remounts between customers (App.js only ever renders one
  // page-slide's component at a time), so customerNumber is fixed for this
  // whole mount's lifetime -- no need for this to be reactive, just read
  // once and used both for the dropdown's own options and for whatever the
  // customer might randomly ask for (see generateSpokenOrder below).
  const baseOptions = customerNumber >= 2 ? BASE_OPTIONS_WITH_STRAWBERRY : BASE_OPTIONS_BASE;
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
  // toppings' own "+ Add topping" toggle; toppings Down -> Place Order,
  // once it actually exists (see isOrderComplete further down --
  // placeOrderRef.current is null until then, so that leg is simply a
  // no-op before that).
  //
  // Every direction is swallowed (preventDefault + stopImmediatePropagation)
  // whenever any of these seven elements has focus, whether or not it maps
  // to one of the named legs above -- not just the ones with somewhere to
  // go. This is what actually keeps the D-pad contained to the order form
  // while it's open: without it, an unhandled direction (e.g. Down from
  // Place Order, or Up from Grade) would fall through to the generic
  // useFlatFocusNav(containerRef) hook below, which doesn't know this
  // modal is supposed to be a closed loop and would happily walk focus
  // out to whatever's spatially nearest elsewhere on the screen -- the
  // reported bug, where enough Down presses eventually reached the
  // ProgressBar's own station dot underneath the modal. (This trap
  // originally only covered these seven named toggles; an open dropdown's
  // own option list is now trapped too, right below -- see that block's
  // own comment. Topping chips still aren't covered, so their existing
  // nav is untouched.)
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

      if (active === toppingsAddRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Down' && placeOrderRef.current) placeOrderRef.current.focus();
        else if (action === 'Up') baseRef.current?.focus();
        return;
      }

      if (active === placeOrderRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (action === 'Up') toppingsAddRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useFlatFocusNav(containerRef);

  // Rolled once per mount (i.e. once per customer -- see the big comment
  // above generateSpokenOrder) via the lazy initializer, so it doesn't
  // re-roll on every re-render (opening a dropdown, picking a value, etc).
  const [spokenOrder] = useState(() => generateSpokenOrder(customerNumber, baseOptions));
  const speechSegments = buildSpeechSegments(spokenOrder, baseOptions);
  const speechText = flattenSegments(speechSegments);

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

  // Character voice line -- plays once, right as the speech bubble starts
  // typing (this effect and the typewriter one above both fire on mount,
  // i.e. once per customer/remount, for the same reason). Keyed off the
  // character (CUSTOMER_CHARACTER/CHARACTER_ORDERING_AUDIO above), not the
  // rolled spokenOrder text, so this stays "Annie's ordering line" no
  // matter what she orders -- and so later customer characters just need
  // their own entry in that map, not a change here. Routed through
  // sfx.js's playVoiceLine (a one-shot clip, same "not App.js's looping
  // <audio ref> element" distinction as before) so it's controlled by the
  // Settings panel's "Sound" slider rather than always playing at full
  // volume. Autoplay can still be blocked the same way background music's
  // can be (see App.js's own tryPlay/catch) if this is somehow the very
  // first sound of the session with no prior user gesture; unlike
  // background music there's no first-gesture retry for a one-shot line
  // like this, it just silently doesn't play that round.
  useEffect(() => {
    const src = CHARACTER_ORDERING_AUDIO[CUSTOMER_CHARACTER];
    if (!src) return undefined;
    const audio = playVoiceLine(src);
    return () => audio.pause();
  }, []);

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
  // Each added topping gets its own id (toppingIdRef below) rather than
  // being de-duplicated by value, so the same flavor can be added more than
  // once (e.g. two pumps of guava syrup) and each copy still removed
  // independently of the others.
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

  const addTopping = (value) => {
    playButtonClick();
    setToppings((prev) => [...prev, { id: toppingIdRef.current++, value }]);
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

  // Highlight beat -- half a second after landing on this screen, the play
  // button starts flashing the same green halo, plus a nearby "click enter
  // to take the customer's order" label (see .ordering-tablet-* in
  // CustomerOrdering.css), and becomes enabled/focusable (see disabled=
  // {!tabletPromptActive} below). Opening the order form itself is handled
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

  const placeOrder = () => {
    playButtonClick();
    const order = {
      matchaGrade,
      teaspoons,
      cupType,
      iceCubes,
      baseMilk,
      toppings: toppings.map((t) => t.value),
    };
    onPlaceOrder?.(order);
    closeOrderForm();
    setShowStationHint(true);
  };

  return (
    <div className="ordering-container" ref={containerRef}>
      <h1 className="sr-only">Customer Ordering</h1>

      <div className="ordering-content">
        <img
          src="./TakeOrderFrame.png"
          alt="The take-order counter, with an ordering computer terminal"
          className="ordering-art"
        />
        {/* The customer (bunny) character, composited on top of the
            background rather than baked into it -- same "cut character out
            of the background so it can eventually be swapped per customer"
            approach the matcha/toppings stations use for their own props.
            Swapped to a new BunnyOrder.png asset (was BunnyOrdering.png)
            and moved back to roughly centered/counter-height -- see
            .ordering-bunny in CustomerOrdering.css. */}
        <img src="./BunnyOrder.png" alt="A bunny customer at the counter" className="ordering-bunny" />

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
        <div className="ordering-speech-wrap">
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
          className={`ordering-play-button${tabletPromptActive ? ' tablet-highlight' : ''}`}
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

        {/* Second highlight beat -- just the button's own flashing white
            halo (see .ordering-play-button.tablet-highlight in
            CustomerOrdering.css) plus its nearby hint label, no tint. */}
        {tabletPromptActive && <p className="ordering-tablet-hint">Click Enter to take the customer&apos;s order.</p>}

        {orderFormOpen && (
          <>
            {/* Clicking the dimmed backdrop closes the modal (mouse-only --
                there's no keyboard/D-pad equivalent for this early-exit
                path anymore; the dedicated close (X) button that used to
                cover that was removed since completing the order via Place
                Order already closes the modal, making a separate close
                button redundant). */}
            <div className="order-modal-backdrop" onClick={closeOrderForm} />
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
                  <h2 className="order-section-title">Matcha</h2>
                  <div className="order-section-row">
                    <Dropdown
                      placeholder="Grade"
                      options={GRADE_OPTIONS}
                      value={matchaGrade}
                      onSelect={setMatchaGrade}
                      isOpen={openControl === 'grade'}
                      onToggle={() => toggleControl('grade')}
                      toggleRef={gradeRef}
                    />
                    <Dropdown
                      placeholder="Tsp"
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
                  <h2 className="order-section-title">Cup &amp; Ice</h2>
                  <div className="order-section-row">
                    <Dropdown
                      placeholder="Cup"
                      options={CUP_OPTIONS}
                      value={cupType}
                      onSelect={setCupType}
                      isOpen={openControl === 'cup'}
                      onToggle={() => toggleControl('cup')}
                      toggleRef={cupRef}
                    />
                    <Dropdown
                      placeholder="Ice"
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
                  <h2 className="order-section-title">Base</h2>
                  <Dropdown
                    placeholder="Milk / water"
                    options={baseOptions}
                    value={baseMilk}
                    onSelect={setBaseMilk}
                    isOpen={openControl === 'base'}
                    onToggle={() => toggleControl('base')}
                    toggleRef={baseRef}
                  />
                </div>

                <div className="order-section">
                  <h2 className="order-section-title">Toppings</h2>
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
                      + Add topping
                    </button>
                    {openControl === 'toppings' && (
                      <div className="order-dropdown-list">
                        {TOPPING_OPTIONS.map((opt, index) => (
                          <button
                            key={opt.value}
                            ref={index === 0 ? toppingsFirstOptionRef : undefined}
                            type="button"
                            className="order-dropdown-option"
                            data-focusable
                            onClick={() => addTopping(opt.value)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {toppings.length > 0 && (
                    <div className="order-topping-chips">
                      {toppings.map((t) => {
                        const opt = TOPPING_OPTIONS.find((o) => o.value === t.value);
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
                    Place Order
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
          currentStepHint="Use your right arrow key to head to the matcha station."
        />
      </div>
    </div>
  );
};

export default CustomerOrdering;
