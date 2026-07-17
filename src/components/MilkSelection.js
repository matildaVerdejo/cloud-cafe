import React, { useRef, useState } from 'react';
import './MilkSelection.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { getActionFromKeyEvent, shouldDebounceEnter } from '../gameloop/pal';

// Container-relative percentage boxes for the two places the glass cup can
// sit (see the pixel math in MilkSelection.css above .glass-cup). The cup
// is bigger once it's on the table (as if set down closer to camera) and
// its bottom edge lands at the same level the milk bottles stand at,
// centered horizontally on the table.
const CUP_SPOTS = {
  shelf: { left: 71.12, top: 26.75 },
  table: { left: 40.30, top: 41.06 },
};
const SHELF_SIZE = { width: 6.47, height: 12.39 };
const TABLE_SIZE = { width: 19.40, height: 37.16 }; // same aspect ratio, 3x

// Three ice cubes start scattered inside the ice box (see the pixel math in
// MilkSelection.css above .ice-cube). Each cube has its own fixed "in cup"
// slot (near the rim) so placement order doesn't matter -- cube 0 always
// ends up in slot 0, etc.
const ICE_BOX_SPOTS = [
  { left: 6.825, top: 74.26 },
  { left: 11.135, top: 78.11 },
  { left: 15.445, top: 74.26 },
];
const ICE_BOX_SIZE = { width: 5.03, height: 9.196 };
const ICE_CUP_SIZE = { width: 4, height: 4.11 };
const ICE_CUP_SLOT_FRACTIONS = [
  { x: 0.32, y: 0.2 },
  { x: 0.5, y: 0.14 },
  { x: 0.68, y: 0.2 },
];

function getIceCupSlotPos(index) {
  const cup = CUP_SPOTS.table;
  const frac = ICE_CUP_SLOT_FRACTIONS[index % ICE_CUP_SLOT_FRACTIONS.length];
  const centerX = cup.left + frac.x * TABLE_SIZE.width;
  const centerY = cup.top + frac.y * TABLE_SIZE.height;
  return {
    left: centerX - ICE_CUP_SIZE.width / 2,
    top: centerY - ICE_CUP_SIZE.height / 2,
  };
}

// Generous hit-test box for "is this drop point inside the cup" -- the cup
// itself only counts as a valid target while it's on the table (there's
// nothing to drop ice into while it's still up on the shelf).
function isOverCup(leftPct, topPct, cupSpot) {
  if (cupSpot !== 'table') return false;
  const cup = CUP_SPOTS.table;
  const margin = 3; // percentage points of extra forgiveness on each side
  return (
    leftPct >= cup.left - margin &&
    leftPct <= cup.left + TABLE_SIZE.width + margin &&
    topPct >= cup.top - margin &&
    topPct <= cup.top + TABLE_SIZE.height + margin
  );
}

const MilkSelection = ({ onBack }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  // ---- Glass cup: shelf <-> table --------------------------------------
  const [cupSpot, setCupSpot] = useState('shelf');
  const [cupDragPos, setCupDragPos] = useState(null);
  const cupDragStartRef = useRef({ pointerX: 0, pointerY: 0, cupLeft: 0, cupTop: 0 });

  const handleCupPointerDown = (e) => {
    const base = CUP_SPOTS[cupSpot];
    e.currentTarget.setPointerCapture(e.pointerId);
    cupDragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      cupLeft: base.left,
      cupTop: base.top,
    };
    setCupDragPos({ left: base.left, top: base.top });
  };

  const handleCupPointerMove = (e) => {
    if (!cupDragPos) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - cupDragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - cupDragStartRef.current.pointerY) / rect.height) * 100;
    setCupDragPos({
      left: cupDragStartRef.current.cupLeft + dxPct,
      top: cupDragStartRef.current.cupTop + dyPct,
    });
  };

  const handleCupPointerUp = (e) => {
    if (!cupDragPos) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const midpoint = (CUP_SPOTS.shelf.top + CUP_SPOTS.table.top) / 2;
    setCupSpot(cupDragPos.top > midpoint ? 'table' : 'shelf');
    setCupDragPos(null);
  };

  const handleCupKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    e.preventDefault();
    setCupSpot((prev) => (prev === 'shelf' ? 'table' : 'shelf'));
  };

  const cupRenderPos = cupDragPos || CUP_SPOTS[cupSpot];
  const cupRenderSize = !cupDragPos && cupSpot === 'table' ? TABLE_SIZE : SHELF_SIZE;

  // ---- Ice cubes: ice box -> cup ----------------------------------------
  // Whether each of the 3 cubes has been placed in the cup yet.
  const [icePlaced, setIcePlaced] = useState([false, false, false]);
  // Which cube (if any) is being dragged right now, and its live position.
  const [iceDrag, setIceDrag] = useState(null); // { index, left, top } | null
  const iceDragStartRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 });

  const handleIcePointerDown = (index) => (e) => {
    if (icePlaced[index]) return;
    const base = ICE_BOX_SPOTS[index];
    e.currentTarget.setPointerCapture(e.pointerId);
    iceDragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      left: base.left,
      top: base.top,
    };
    setIceDrag({ index, left: base.left, top: base.top });
  };

  const handleIcePointerMove = (e) => {
    if (!iceDrag) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxPct = ((e.clientX - iceDragStartRef.current.pointerX) / rect.width) * 100;
    const dyPct = ((e.clientY - iceDragStartRef.current.pointerY) / rect.height) * 100;
    setIceDrag((prev) => ({
      ...prev,
      left: iceDragStartRef.current.left + dxPct,
      top: iceDragStartRef.current.top + dyPct,
    }));
  };

  const handleIcePointerUp = (e) => {
    if (!iceDrag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (isOverCup(iceDrag.left, iceDrag.top, cupSpot)) {
      setIcePlaced((prev) => {
        const next = [...prev];
        next[iceDrag.index] = true;
        return next;
      });
    }
    // Whether placed or not, clear the drag -- an unplaced cube's render
    // falls straight back to its ICE_BOX_SPOTS position.
    setIceDrag(null);
  };

  // D-pad / keyboard equivalent of dragging a cube: select it, press Enter
  // to place it in the cup. Only works once the cup is actually on the
  // table, same precondition as the drag-and-drop path.
  const handleIceKeyDown = (index) => (e) => {
    if (icePlaced[index]) return;
    const action = getActionFromKeyEvent(e);
    if (action !== 'Enter') return;
    if (shouldDebounceEnter(e)) return;
    if (cupSpot !== 'table') return;
    e.preventDefault();
    setIcePlaced((prev) => {
      const next = [...prev];
      next[index] = true;
      return next;
    });
  };

  return (
    <div className="milk-selection-container" ref={containerRef}>
      <h1 className="sr-only">Milk Mixing Station</h1>

      <div className="milk-selection-content">
        <img
          src="./MilkMixingStation.png"
          alt="Milk mixing station with sink, cabinet, and oat, dairy, almond, and coconut milk"
          className="milk-selection-art"
        />
        <img
          src="./GlassCup.png"
          alt="Glass cup. Drag from the shelf to the table, or select it and press Enter."
          className={`glass-cup${cupDragPos ? ' dragging' : ''}`}
          data-focusable
          tabIndex={0}
          draggable={false}
          style={{
            left: `${cupRenderPos.left}%`,
            top: `${cupRenderPos.top}%`,
            width: `${cupRenderSize.width}%`,
            height: `${cupRenderSize.height}%`,
          }}
          onPointerDown={handleCupPointerDown}
          onPointerMove={handleCupPointerMove}
          onPointerUp={handleCupPointerUp}
          onKeyDown={handleCupKeyDown}
        />

        {ICE_BOX_SPOTS.map((boxSpot, index) => {
          const placed = icePlaced[index];
          const dragging = iceDrag?.index === index;
          const pos = dragging ? iceDrag : placed ? getIceCupSlotPos(index) : boxSpot;
          const size = placed ? ICE_CUP_SIZE : ICE_BOX_SIZE;
          return (
            <img
              key={index}
              src="./IceCube.png"
              alt={placed ? 'Ice cube in the cup' : 'Ice cube. Drag it into the cup, or select it and press Enter.'}
              className={`ice-cube${dragging ? ' dragging' : ''}${placed ? ' placed' : ''}`}
              data-focusable={placed ? undefined : true}
              tabIndex={placed ? undefined : 0}
              draggable={false}
              style={{
                left: `${pos.left}%`,
                top: `${pos.top}%`,
                width: `${size.width}%`,
                height: `${size.height}%`,
              }}
              onPointerDown={placed ? undefined : handleIcePointerDown(index)}
              onPointerMove={placed ? undefined : handleIcePointerMove}
              onPointerUp={placed ? undefined : handleIcePointerUp}
              onKeyDown={placed ? undefined : handleIceKeyDown(index)}
            />
          );
        })}

        <button
          type="button"
          className="milk-back-button"
          data-focusable
          autoFocus
          onClick={onBack}
        >
          Back
        </button>
      </div>
    </div>
  );
};

export default MilkSelection;
