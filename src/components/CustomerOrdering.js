import React, { useEffect, useRef, useState } from 'react';
import './CustomerOrdering.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
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
const BASE_OPTIONS = [
  { value: 'dairy', label: 'Dairy milk' },
  { value: 'oat', label: 'Oat milk' },
  { value: 'almond', label: 'Almond milk' },
  { value: 'coconut', label: 'Coconut water' },
];
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
function generateSpokenOrder(customerNumber) {
  const toppingCap = customerNumber === 1 ? pickRandom([2, 3]) : TOPPING_OPTIONS.length;
  return {
    greeting: pickRandom(GREETINGS),
    teaspoons: pickRandom(TEASPOON_OPTIONS).value,
    grade: pickRandom(GRADE_OPTIONS).value,
    cup: pickRandom(CUP_OPTIONS).value,
    ice: pickRandom(ICE_OPTIONS).value,
    milk: pickRandom(BASE_OPTIONS).value,
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
function buildSpeechSegments(o) {
  const grade = GRADE_OPTIONS.find((g) => g.value === o.grade).label.toLowerCase();
  const cup = CUP_OPTIONS.find((c) => c.value === o.cup).label.toLowerCase();
  const milk = BASE_OPTIONS.find((m) => m.value === o.milk).label.toLowerCase();
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
// option rows stacked on each other.
function Dropdown({ placeholder, options, value, onSelect, isOpen, onToggle }) {
  const toggleRef = useRef(null);
  const selected = options.find((opt) => opt.value === value);

  return (
    <div className="order-dropdown">
      <button
        ref={toggleRef}
        type="button"
        className={`order-dropdown-toggle${isOpen ? ' open' : ''}${selected ? ' filled' : ''}`}
        data-focusable
        onClick={onToggle}
      >
        {selected ? selected.label : placeholder}
      </button>
      {isOpen && (
        <div className="order-dropdown-list">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`order-dropdown-option${opt.value === value ? ' selected' : ''}`}
              data-focusable
              onClick={() => {
                onSelect(opt.value);
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
  useFlatFocusNav(containerRef);

  // Rolled once per mount (i.e. once per customer -- see the big comment
  // above generateSpokenOrder) via the lazy initializer, so it doesn't
  // re-roll on every re-render (opening a dropdown, picking a value, etc).
  const [spokenOrder] = useState(() => generateSpokenOrder(customerNumber));
  const speechSegments = buildSpeechSegments(spokenOrder);
  const speechText = flattenSegments(speechSegments);

  // Typewriter effect -- same one the very first version of this screen's
  // speech bubble had (reveal one more character every TYPE_INTERVAL_MS, so
  // the bubble looks like the customer is actually talking) before this
  // screen was rebuilt around the play-button/modal order form. Tied to
  // speechText, which -- like spokenOrder above -- only ever changes on
  // remount (new customer), so this reliably restarts once per round rather
  // than re-triggering on unrelated re-renders (opening a dropdown, etc).
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

  const toppingsAddRef = useRef(null);
  const addTopping = (value) => {
    setToppings((prev) => [...prev, { id: toppingIdRef.current++, value }]);
    setOpenControl(null);
    toppingsAddRef.current?.focus();
  };
  const removeTopping = (id) => {
    setToppings((prev) => prev.filter((t) => t.id !== id));
  };

  // ---- Order-form modal: opened via the play button on the computer's
  // screen (see .ordering-play-button below), closed via the modal's own
  // close button or by clicking the backdrop behind it. Any dropdown left
  // open gets closed too (openControl reset) so re-opening the modal later
  // always starts from a clean, fully-closed state rather than resuming
  // wherever a dropdown happened to be left.
  const [orderFormOpen, setOrderFormOpen] = useState(false);
  const playButtonRef = useRef(null);

  const closeOrderForm = () => {
    setOrderFormOpen(false);
    setOpenControl(null);
    playButtonRef.current?.focus();
  };

  // "Place Order" only appears once every required section has a selection
  // -- toppings is the one section left out of this check since it's an
  // optional adder (a drink with no extra toppings is still a complete
  // order), not a required dropdown like the other four.
  const isOrderComplete =
    matchaGrade !== null && teaspoons !== null && cupType !== null && iceCubes !== null && baseMilk !== null;

  const placeOrder = () => {
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
            looking like a solid, thicker wedge. */}
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

        {/* Play button on the ordering computer's screen -- opens the
            order-builder modal below. Styled to match .progress-step-dot
            in ProgressBar.css (same white circle/brown border/dark text
            look as the progress bar's numbered steps), shifted well down
            per request. Eyeballed position -- no reference for exactly
            where the computer screen sits in the new art. */}
        <button
          ref={playButtonRef}
          type="button"
          className="ordering-play-button"
          data-focusable
          aria-label="Open order form"
          aria-haspopup="dialog"
          aria-expanded={orderFormOpen}
          onClick={() => setOrderFormOpen(true)}
        >
          &#9654;
        </button>

        {orderFormOpen && (
          <>
            {/* Clicking the dimmed backdrop closes the modal, same as
                clicking outside any standard dialog -- doesn't affect
                keyboard/D-pad users, who close via the visible close
                button instead. */}
            <div className="order-modal-backdrop" onClick={closeOrderForm} />
            <div className="order-modal" role="dialog" aria-label="Order form">
              <button
                type="button"
                className="order-modal-close"
                data-focusable
                aria-label="Close order form"
                onClick={closeOrderForm}
              >
                &times;
              </button>

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
                    />
                    <Dropdown
                      placeholder="Tsp"
                      options={TEASPOON_OPTIONS}
                      value={teaspoons}
                      onSelect={setTeaspoons}
                      isOpen={openControl === 'teaspoons'}
                      onToggle={() => toggleControl('teaspoons')}
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
                    />
                    <Dropdown
                      placeholder="Ice"
                      options={ICE_OPTIONS}
                      value={iceCubes}
                      onSelect={setIceCubes}
                      isOpen={openControl === 'ice'}
                      onToggle={() => toggleControl('ice')}
                    />
                  </div>
                </div>

                <div className="order-section">
                  <h2 className="order-section-title">Base</h2>
                  <Dropdown
                    placeholder="Milk / water"
                    options={BASE_OPTIONS}
                    value={baseMilk}
                    onSelect={setBaseMilk}
                    isOpen={openControl === 'base'}
                    onToggle={() => toggleControl('base')}
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
                      onClick={() => toggleControl('toppings')}
                    >
                      + Add topping
                    </button>
                    {openControl === 'toppings' && (
                      <div className="order-dropdown-list">
                        {TOPPING_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
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
                  <button type="button" className="order-place-button" data-focusable onClick={placeOrder}>
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
        />
      </div>
    </div>
  );
};

export default CustomerOrdering;
