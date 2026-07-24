import React, { useEffect, useRef, useState } from 'react';
import './MatchaMaking.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { getActionFromKeyEvent, shouldDebounceEnter } from '../gameloop/pal';
import ProgressBar from './ProgressBar';
import OrderReceiptButton from './OrderReceiptButton';

// Static (not yet interactive) countertop items, layered on top of the now-
// empty background art. Positions were worked out by compositing each item
// onto the background at a few candidate boxes and eyeballing the result
// (see the process notes -- each box is left/top/width/height as a % of the
// 1394x768 art, matching the milk station's percentage-box convention).
// Each item PNG has already been cropped to its own visible content (no
// leftover transparent padding), so width/height here can use the image's
// own aspect ratio without distortion.
const STATIC_ITEMS = [
  { key: 'cafe-grade', src: './CafeGrade.png', alt: 'Cafe grade matcha tin', left: 63.65, top: 25.66, width: 6.9, height: 19.34 },
  { key: 'classic-grade', src: './ClassicGrade.png', alt: 'Classic grade matcha tin', left: 71.55, top: 25.47, width: 6.9, height: 19.53 },
  { key: 'ceremonial-grade', src: './CeremonialGrade.png', alt: 'Ceremonial grade matcha tin', left: 79.45, top: 25.50, width: 6.9, height: 19.50 },
];

// Scoop gauge -- the matcha-measuring counterpart to the heater's
// .heater-temp-bar, sitting to the right of the tins with a clear gap
// (ceremonial-grade, the rightmost tin, ends at 79.45 + 6.9 = 86.35) so it
// doesn't read as part of the tin cluster itself. Vertical instead of
// horizontal since it's meant to read as a measuring column rather than a
// temperature strip, but reuses the same gray-body/thick-outline look (see
// .scoop-bar in MatchaMaking.css, mirrored off .heater-temp-bar).
// Only rendered once a tin's been confirmed with Enter/Space (see
// selectedTin state below) -- merely having a tin focused/highlighted
// isn't enough, since that also happens while just browsing between tins.
// Pushed close to the right edge of the frame (right edge lands at
// 93 + 4 = 97%, leaving a small margin). top is set to sit entirely below
// the wall/counter seam in the background art -- that seam falls around
// 33-34% of the frame (measured off MatchaBaseStation.png's own pixels,
// which map straight to container % since the art is anchored to the
// container's top edge with no top letterbox -- see .matcha-making-art) --
// 42 nudges it a bit further down from that clearance line than before,
// still keeping the whole bar (and the spoons/slider that key off its box
// below) well within the counter.
const SCOOP_BAR_BOX = { left: 93, top: 42, width: 4, height: 40 };

// Just three light gray marks now -- top, middle, and bottom of the bar --
// rather than a full evenly-spaced run. Top and bottom sit an equal 8% in
// from their respective edges (previously 10 and 6 -- an uneven leftover
// from when this was a full evenly-spaced run of 8, not deliberately
// mismatched). Middle is the exact midpoint of the other two, (8 + 92) / 2
// = 50 (previously 46, another evenly-spaced-run leftover that actually
// sat closer to the top mark than the bottom one). Values match
// SCOOP_SPOON_LINES' tickTop entries below exactly, so each mark still
// lines up with its spoon.
const SCOOP_BAR_MARKERS = [8, 50, 92];

// Three small spoon icons sitting just to the left of the bar, in the gap
// between the tins and the bar itself (tins end at 86.35, bar starts at 93
// -- see SCOOP_BAR_BOX comment above), each lined up with one of the tick
// lines above: the topmost tick (8), the true middle tick (50), and the
// bottommost tick (92). spoon.png is a 500x500 square canvas with the
// spoon's own art only filling the vertical middle (~y160-359) -- rather
// than pre-cropping the file, the box below just keeps that 1:1 aspect
// ratio (width % converted from height % by the container's 16:9 ratio,
// same trick as KETTLE_SPOUT_OFFSET elsewhere) so the art doesn't distort,
// and the top/bottom padding it carries just centers it on the tick line
// automatically.
const SCOOP_SPOON_SIZE_HEIGHT = 7.47;
const SCOOP_SPOON_SIZE = { width: SCOOP_SPOON_SIZE_HEIGHT / (16 / 9), height: SCOOP_SPOON_SIZE_HEIGHT };
const SCOOP_SPOON_LEFT = 87.58;
const SCOOP_SPOON_LINES = [
  { key: 'top', tickTop: 8 },
  { key: 'middle', tickTop: 50 },
  { key: 'bottom', tickTop: 92 },
];
const SCOOP_SPOON_ITEMS = SCOOP_SPOON_LINES.map((line) => ({
  key: line.key,
  left: SCOOP_SPOON_LEFT,
  top: SCOOP_BAR_BOX.top + (line.tickTop / 100) * SCOOP_BAR_BOX.height - SCOOP_SPOON_SIZE.height / 2,
  width: SCOOP_SPOON_SIZE.width,
  height: SCOOP_SPOON_SIZE.height,
}));

// Scoop-count labels sitting right under each spoon -- "x 1" under the
// bottom spoon (the lowest line, closest to an empty tin), counting up to
// "x 3" under the top spoon, so the gauge reads as "the higher the line,
// the more scoops it represents". top is anchored to the spoon's actual
// VISIBLE bottom edge, not its full 500x500 box -- spoon.png's own art
// only fills y160-359 of that square canvas (see the SCOOP_SPOON_SIZE
// comment above), so using the raw box's bottom edge would leave a big
// unwanted gap between the spoon and its label. Centered under the spoon
// with a wider box than the spoon itself since the text is wider than the
// spoon art.
const SCOOP_SPOON_LABEL_TEXT = { top: 'x 3', middle: 'x 2', bottom: 'x 1' };
const SCOOP_SPOON_VISIBLE_BOTTOM_FRAC = 359 / 500;
const SCOOP_SPOON_LABEL_GAP = 1.2;
const SCOOP_SPOON_LABEL_WIDTH = 6;
const SCOOP_SPOON_LABELS = SCOOP_SPOON_ITEMS.map((item) => ({
  key: item.key,
  text: SCOOP_SPOON_LABEL_TEXT[item.key],
  left: item.left + item.width / 2 - SCOOP_SPOON_LABEL_WIDTH / 2,
  top: item.top + item.height * SCOOP_SPOON_VISIBLE_BOTTOM_FRAC + SCOOP_SPOON_LABEL_GAP,
  width: SCOOP_SPOON_LABEL_WIDTH,
}));

// Heater plate: rendered separately from the other static items because it
// carries two hotspots positioned relative to its own art (see below).
const HEATER_BOX = { left: 3, top: 51.5, width: 25, height: 17.5 };

// The heater's power button sits on the top surface, upper-left of the
// plate, centered on the molded oval drawn into the art (image x 27-91,
// y 66-89 of the 337x130 Heater.png -- see gs-feedback process notes) so
// the button visually covers it, but a bit smaller than that oval.
// Expressed here as a fraction of the heater image's own width/height,
// then converted to a box relative to the outer container the same way
// HEATER_BOX itself is positioned -- since HEATER_BOX is already sized to
// the image's exact aspect ratio (no distortion), plain fraction-of-parent
// math applies with no extra aspect correction needed, unlike a box
// positioned directly against the background art.
function heaterRelativeBox(imgLeft, imgTop, imgRight, imgBottom, imgWidth, imgHeight) {
  return {
    left: HEATER_BOX.left + (imgLeft / imgWidth) * HEATER_BOX.width,
    top: HEATER_BOX.top + (imgTop / imgHeight) * HEATER_BOX.height,
    width: ((imgRight - imgLeft) / imgWidth) * HEATER_BOX.width,
    height: ((imgBottom - imgTop) / imgHeight) * HEATER_BOX.height,
  };
}

const HEATER_BUTTON_BOX = heaterRelativeBox(33, 68.5, 85, 86.5, 337, 130);

// Temperature gauge -- sits on the counter/table directly in front of the
// heater rather than on the plate itself, so it's positioned as its own
// fixed box (not derived from HEATER_BOX) on the counter surface below.
// Idle state is plain grey (see .heater-temp-bar); the solid light-blue
// fill lives on a separate .heater-temp-bar-fill child that's scaled to 0
// width by default and animates open left-to-right when heaterOn flips
// true (and closes the same way when it flips back off), so the color
// progressively advances across the bar instead of appearing instantly.
const TEMP_BAR_BOX = { left: 3, top: 72, width: 21, height: 3.4 };

// Two tick marks in the gauge's white middle zone, positioned as a % of the
// bar's own box (TEMP_BAR_BOX) since they're rendered as children of the
// bar div -- shifted right of center, with a wider gap between them, sized
// to sit flush inside the bar's own height (see .heater-temp-bar-tick).
// The button's green window (GREEN_AT_MS/RED_AT_MS below) is derived
// directly from these two entries' own left/width, so moving or resizing
// the ticks automatically keeps the timing in sync.
const TEMP_BAR_TICKS = [
  { key: 'tick-left', left: 52, width: 3.5 },
  { key: 'tick-right', left: 60.5, width: 3.5 },
];

// How long the fill takes to grow from empty to full (see the inline
// transitionDuration on .heater-temp-bar-fill below) -- kept as a single
// JS constant, rather than living only in the CSS, so the button's
// green/red timing below can be scheduled against the exact same number.
// The fill's timing function is linear (see MatchaMaking.css) specifically
// so that "elapsed time / duration" is an accurate stand-in for "how far
// across the bar the fill edge currently is" -- with an eased curve these
// setTimeout delays would drift out of sync with where the color visually
// is.
const FILL_DURATION_MS = 5000;

// The button turns green the moment the fill edge reaches the left edge of
// the first tick, and turns red the moment it passes the right edge of the
// second (last) tick -- i.e. green for exactly as long as the fill is
// touching either tick or the gap between them. Both expressed as a
// fraction of FILL_DURATION_MS since the fill grows linearly.
const GREEN_AT_MS = FILL_DURATION_MS * (TEMP_BAR_TICKS[0].left / 100);
const RED_AT_MS =
  FILL_DURATION_MS *
  ((TEMP_BAR_TICKS[TEMP_BAR_TICKS.length - 1].left + TEMP_BAR_TICKS[TEMP_BAR_TICKS.length - 1].width) / 100);

// Kettle, bowl, and whisk are the first three items made movable -- freely
// draggable (mouse/touch/remote pointer) and D-pad-selectable with the same
// white shape-hugging focus halo used on the Milk Selection screen's glass
// cup / ice cubes. Unlike that screen, there's no destination/drop-zone
// mechanic designed yet for these three, so movement here is intentionally
// free-form (no snapping, no Enter-to-toggle) -- just "pick it up, put it
// down anywhere on the counter". Width/height stay fixed at their starting
// size; only left/top change while dragging.
const MOVABLE_ITEMS = [
  { key: 'kettle', src: './kettle.png', alt: 'Pour-over kettle', left: 3.5, top: 26.1, width: 24, height: 31.4 },
  { key: 'bowl', src: './Bowl.png', alt: 'Matcha mixing bowl', left: 38, top: 33.8, width: 24, height: 45.7 },
  { key: 'whisk', src: './whisk.png', alt: 'Bamboo whisk', left: 66, top: 47, width: 6, height: 21.4 },
];

const MOVABLE_START = MOVABLE_ITEMS.reduce((acc, item) => {
  acc[item.key] = { left: item.left, top: item.top };
  return acc;
}, {});

// Where the kettle steam anchors, as a fraction (0-1) of the kettle's own
// box (its MOVABLE_ITEMS width/height). Horizontally lined up with the
// spout tip's leftmost opaque pixel in the 48x32 kettle.png source (~x4 of
// 48), but pulled up well above the spout opening itself (topFrac 0.4 was
// the actual spout pixel, at y~14 of 32) so the wisps read clearly above
// the kettle's silhouette instead of starting low and getting lost against
// it. Steam wisps anchor here so they track the kettle wherever it's been
// dragged, rather than sitting at a fixed spot on the counter.
const KETTLE_SPOUT_OFFSET = { leftFrac: 0.06, topFrac: 0.08 };

function clampPct(value, size) {
  return Math.min(Math.max(value, 0), 100 - size);
}

// Reads the fill's current live scaleX mid-transition (e.g. computed
// style's transform matrix reports whatever the browser has interpolated
// to at this exact frame) -- this is what lets stopping the gauge freeze
// it exactly where it visually is, rather than snapping to 0 or 1.
function getCurrentScaleX(el) {
  const transform = window.getComputedStyle(el).transform;
  if (!transform || transform === 'none') return 0;
  return new DOMMatrixReadOnly(transform).a;
}

const MatchaMaking = ({ activeStep, customerNumber, onNavigate, onAdvance }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  // ---- Heater power button: on/off toggle, plus a green/red "temp zone"
  // light keyed to how far the temp bar fill has progressed (see
  // GREEN_AT_MS/RED_AT_MS above) -- scheduled with plain timers against
  // the same duration the fill itself animates over. Pressing the button
  // sends focus straight to the gauge (barRef) so the player can stop it
  // with Enter/Space right away -- that's the actual minigame: catch the
  // fill while it's between the two ticks by stopping it there.
  const [heaterOn, setHeaterOn] = useState(false);
  const [tempZone, setTempZone] = useState('below'); // 'below' | 'target' | 'over'
  // Whether the gauge is actively animating right now -- true from the
  // moment the heater is switched on until the player stops it (or the
  // heater is switched off). Enter/Space on the gauge is a no-op once this
  // is false, so it can't be "stopped" twice.
  const [barRunning, setBarRunning] = useState(false);
  const zoneTimersRef = useRef([]);
  const barRef = useRef(null);
  const fillRef = useRef(null);

  useEffect(() => {
    zoneTimersRef.current.forEach(clearTimeout);
    zoneTimersRef.current = [];
    // Clear any freeze left over from a previous run (see stopBar below)
    // so a fresh press of the heater button always restarts the fill from
    // empty instead of resuming from wherever it was last frozen. Only the
    // transitionProperty longhand is touched here (never the `transition`
    // shorthand) -- setting the shorthand also wipes the inline
    // transitionDuration React applies via the style prop below, which
    // silently dropped the duration to CSS's 0s default and made the fill
    // jump straight to full instead of animating.
    if (fillRef.current) {
      fillRef.current.style.transitionProperty = '';
      fillRef.current.style.transform = '';
    }
    setTempZone('below');
    if (heaterOn) {
      setBarRunning(true);
      zoneTimersRef.current = [
        setTimeout(() => setTempZone('target'), GREEN_AT_MS),
        setTimeout(() => setTempZone('over'), RED_AT_MS),
      ];
      barRef.current?.focus();
    } else {
      setBarRunning(false);
    }
    return () => zoneTimersRef.current.forEach(clearTimeout);
  }, [heaterOn]);

  // Freezes the fill exactly where it currently is (see getCurrentScaleX)
  // and stops the zone timers, locking in whatever color the button is
  // showing at that instant as the "reading" the player caught.
  const stopBar = () => {
    if (!barRunning) return;
    zoneTimersRef.current.forEach(clearTimeout);
    zoneTimersRef.current = [];
    const fill = fillRef.current;
    if (fill) {
      const frozenScaleX = getCurrentScaleX(fill);
      // transitionProperty (longhand), not the transition shorthand -- see
      // the comment above in the reset effect for why.
      fill.style.transitionProperty = 'none';
      fill.style.transform = `scaleX(${frozenScaleX})`;
    }
    setBarRunning(false);
  };

  const handleBarKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    stopBar();
  };

  // ---- Movable countertop items: free drag anywhere on the counter -------
  const [itemPositions, setItemPositions] = useState(MOVABLE_START);
  // Which item (if any) is being dragged right now, and its live position.
  const [drag, setDrag] = useState(null); // { key, left, top } | null
  const dragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });

  const handlePointerDown = (item) => (e) => {
    const base = itemPositions[item.key];
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      left: base.left,
      top: base.top,
    };
    setDrag({ key: item.key, left: base.left, top: base.top });
  };

  const handlePointerMove = (item) => (e) => {
    if (!drag || drag.key !== item.key) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - dragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - dragStartRef.current.pointerY) / rect.height) * 100;
    setDrag({
      key: item.key,
      left: clampPct(dragStartRef.current.left + dxPct, item.width),
      top: clampPct(dragStartRef.current.top + dyPct, item.height),
    });
  };

  // Snap back to the item's original counter spot if it's dropped close to
  // it -- "close" is scaled to the item's own footprint (half its width/
  // height) rather than a flat distance, so the tiny whisk needs a
  // reasonably precise drop while the much bigger bowl has a more forgiving
  // catch zone. Dropped anywhere else, it just stays exactly where it landed.
  const SNAP_FRACTION = 0.5;

  const handlePointerUp = (item) => (e) => {
    if (!drag || drag.key !== item.key) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const start = MOVABLE_START[item.key];
    const snapBack =
      Math.abs(drag.left - start.left) < item.width * SNAP_FRACTION &&
      Math.abs(drag.top - start.top) < item.height * SNAP_FRACTION;
    setItemPositions((prev) => ({
      ...prev,
      [item.key]: snapBack ? { left: start.left, top: start.top } : { left: drag.left, top: drag.top },
    }));
    setDrag(null);
  };

  // ---- Matcha tin selection: reveals the scoop gauge -------------------
  // Which tin (if any) has been confirmed -- null hides the scoop gauge
  // entirely. Deliberately not tied to focus (a tin still gets its white
  // halo just from being focused/clicked, via :focus-visible in the CSS,
  // same as any other selectable item) -- the gauge itself only shows up
  // once the player actually presses Enter/Space on a tin, same "confirm"
  // gesture used everywhere else in the game (cup, ice cubes, temp bar).
  // Enter on the already-confirmed tin toggles it back off; Enter on a
  // different tin swaps straight to that one instead.
  const [selectedTin, setSelectedTin] = useState(null);

  const handleTinKeyDown = (item) => (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    setSelectedTin((prev) => (prev === item.key ? null : item.key));
  };

  // ---- Scoop gauge: focuses itself the moment a tin is confirmed --------
  // selectedTin flipping to a real key both reveals the bar (see the JSX
  // below) and sends focus straight to it, so the very next Enter/Space the
  // player presses -- no extra navigating needed -- stops the slider right
  // where it is. If the slider was left frozen from a previous stop, clear
  // that freeze first so switching to a fresh tin always leaves it running.
  const [scoopRunning, setScoopRunning] = useState(false);
  const scoopBarRef = useRef(null);
  const scoopSliderRef = useRef(null);

  useEffect(() => {
    if (selectedTin) {
      if (scoopSliderRef.current) {
        scoopSliderRef.current.style.animation = '';
        scoopSliderRef.current.style.top = '';
      }
      setScoopRunning(true);
      scoopBarRef.current?.focus();
    } else {
      setScoopRunning(false);
    }
  }, [selectedTin]);

  // Freezes the slider exactly where it currently is -- same
  // getComputedStyle-mid-animation trick as the heater's stopBar/
  // getCurrentScaleX above, just reading the live `top` instead of a
  // transform, since that's the property the keyframes animate here.
  const stopScoop = () => {
    if (!scoopRunning) return;
    const el = scoopSliderRef.current;
    if (el) {
      const frozenTop = window.getComputedStyle(el).top;
      el.style.animation = 'none';
      el.style.top = frozenTop;
    }
    setScoopRunning(false);
  };

  const handleScoopKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    stopScoop();
  };

  // ---- Kettle steam: appears once the water's hot enough (tempZone hits
  // 'target', i.e. the button just turned green) and keeps going for as
  // long as it stays hot, rather than cutting off the instant tempZone
  // moves on to 'over' -- reads the kettle's live position (drag position
  // while it's being dragged, its settled position otherwise) so the
  // wisps stay anchored to the spout even after the kettle's been moved.
  const kettleItem = MOVABLE_ITEMS.find((item) => item.key === 'kettle');
  const kettleDragging = drag?.key === 'kettle';
  const kettlePos = kettleDragging ? drag : itemPositions.kettle;
  const showSteam = heaterOn && tempZone !== 'below';
  const steamLeft = kettlePos.left + KETTLE_SPOUT_OFFSET.leftFrac * kettleItem.width;
  const steamTop = kettlePos.top + KETTLE_SPOUT_OFFSET.topFrac * kettleItem.height;

  return (
    <div className="matcha-making-container" ref={containerRef}>
      <h1 className="sr-only">Matcha Base Station</h1>

      <div className="matcha-making-content">
        <img
          src="./MatchaBaseStation.png"
          alt="Matcha base station counter"
          className="matcha-making-art"
        />
        <img
          src="./Heater.png"
          alt="Heater plate"
          className="station-item"
          style={{
            left: `${HEATER_BOX.left}%`,
            top: `${HEATER_BOX.top}%`,
            width: `${HEATER_BOX.width}%`,
            height: `${HEATER_BOX.height}%`,
          }}
        />
        <button
          type="button"
          className={`heater-button${heaterOn ? ' on' : ''}${
            tempZone === 'target' ? ' zone-green' : tempZone === 'over' ? ' zone-red' : ''
          }`}
          data-focusable
          aria-pressed={heaterOn}
          aria-label={heaterOn ? 'Turn heater off' : 'Turn heater on'}
          onClick={() => setHeaterOn((prev) => !prev)}
          style={{
            left: `${HEATER_BUTTON_BOX.left}%`,
            top: `${HEATER_BUTTON_BOX.top}%`,
            width: `${HEATER_BUTTON_BOX.width}%`,
            height: `${HEATER_BUTTON_BOX.height}%`,
          }}
        />
        <div
          ref={barRef}
          className={`heater-temp-bar${heaterOn ? ' on' : ''}`}
          data-focusable
          tabIndex={0}
          role="button"
          aria-label="Temperature gauge. Press Enter to lock in the current temperature."
          onKeyDown={handleBarKeyDown}
          onClick={stopBar}
          style={{
            left: `${TEMP_BAR_BOX.left}%`,
            top: `${TEMP_BAR_BOX.top}%`,
            width: `${TEMP_BAR_BOX.width}%`,
            height: `${TEMP_BAR_BOX.height}%`,
          }}
        >
          <div
            ref={fillRef}
            className="heater-temp-bar-fill"
            style={{ transitionDuration: `${FILL_DURATION_MS}ms` }}
          />
          {TEMP_BAR_TICKS.map((tick) => (
            <span
              key={tick.key}
              className="heater-temp-bar-tick"
              style={{ left: `${tick.left}%`, width: `${tick.width}%` }}
            />
          ))}
        </div>
        {STATIC_ITEMS.map((item) => (
          <img
            key={item.key}
            src={item.src}
            alt={`${item.alt}. Select it and press Enter to measure a scoop.`}
            className="station-item selectable"
            data-focusable
            tabIndex={0}
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              width: `${item.width}%`,
              height: `${item.height}%`,
            }}
            onKeyDown={handleTinKeyDown(item)}
          />
        ))}
        {selectedTin && (
          <>
            <div
              ref={scoopBarRef}
              className="scoop-bar"
              data-focusable
              tabIndex={0}
              role="button"
              aria-label="Scoop gauge. Press Enter to stop the slider at the current line."
              onKeyDown={handleScoopKeyDown}
              onClick={stopScoop}
              style={{
                left: `${SCOOP_BAR_BOX.left}%`,
                top: `${SCOOP_BAR_BOX.top}%`,
                width: `${SCOOP_BAR_BOX.width}%`,
                height: `${SCOOP_BAR_BOX.height}%`,
              }}
            >
              {SCOOP_BAR_MARKERS.map((markerTop) => (
                <span key={markerTop} className="scoop-bar-marker" style={{ top: `${markerTop}%` }} />
              ))}
              <div ref={scoopSliderRef} className="scoop-bar-slider" aria-hidden="true" />
            </div>
            {SCOOP_SPOON_ITEMS.map((item) => (
              <img
                key={item.key}
                src="./Spoon.png"
                alt=""
                aria-hidden="true"
                className="station-item"
                style={{
                  left: `${item.left}%`,
                  top: `${item.top}%`,
                  width: `${item.width}%`,
                  height: `${item.height}%`,
                }}
              />
            ))}
            {SCOOP_SPOON_LABELS.map((label) => (
              <span
                key={label.key}
                className="scoop-spoon-label"
                aria-hidden="true"
                style={{
                  left: `${label.left}%`,
                  top: `${label.top}%`,
                  width: `${label.width}%`,
                }}
              >
                {label.text}
              </span>
            ))}
          </>
        )}
        {MOVABLE_ITEMS.map((item) => {
          const dragging = drag?.key === item.key;
          const pos = dragging ? drag : itemPositions[item.key];
          return (
            <img
              key={item.key}
              src={item.src}
              alt={`${item.alt}. Drag to move.`}
              className={`station-item movable${dragging ? ' dragging' : ''}`}
              data-focusable
              tabIndex={0}
              draggable={false}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${item.width}%`,
                height: `${item.height}%`,
              }}
              onPointerDown={handlePointerDown(item)}
              onPointerMove={handlePointerMove(item)}
              onPointerUp={handlePointerUp(item)}
            />
          );
        })}
        {showSteam && (
          <div
            className="kettle-steam"
            aria-hidden="true"
            style={{ left: `${steamLeft}%`, top: `${steamTop}%` }}
          >
            <span className="kettle-steam-wisp kettle-steam-wisp-1" />
            <span className="kettle-steam-wisp kettle-steam-wisp-2" />
            <span className="kettle-steam-wisp kettle-steam-wisp-3" />
          </div>
        )}
        <OrderReceiptButton />
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

export default MatchaMaking;
