import React, { useRef, useState } from 'react';
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
const ICE_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: `${n}` }));
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
