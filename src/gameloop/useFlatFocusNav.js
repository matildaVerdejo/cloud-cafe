import { useEffect } from 'react';
import { getActionFromKeyEvent } from './pal';

// True directional (spatial) D-pad focus navigation within one screen.
// Each Up/Down/Left/Right press measures the on-screen position of every
// [data-focusable] element and moves focus to the nearest one that is
// actually in that direction from the currently focused element.
//
// Deliberately does NOT wrap. The previous version of this hook walked a
// flat DOM-order list (Up/Left -> previous element, Down/Right -> next,
// wrapping at the ends) which is fine only when DOM order happens to match
// on-screen layout -- it doesn't on screens like Milk Selection, where the
// glass cup, ice cubes, and progress bar are scattered around the frame,
// so "wrapping" could jump focus to something on the opposite side of the
// screen with no visual relationship to the direction pressed. Real
// spatial nav fixes that: if nothing qualifies as "in that direction",
// focus simply doesn't move, instead of jumping somewhere unrelated.
//
// (Function/file name kept as useFlatFocusNav for import stability across
// the five screens that already call it -- the behavior is fully spatial
// now, "Flat" is legacy naming only.)
//
// Scoped to containerRef: only acts when focus is already inside the
// container (or nothing is focused yet). Screens are unmounted when not
// current, so there is no cross-screen leakage.
export function useFlatFocusNav(containerRef) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Up' && action !== 'Down' && action !== 'Left' && action !== 'Right') return;

      const container = containerRef.current;
      if (!container) return;

      const list = Array.from(container.querySelectorAll('[data-focusable]')).filter(
        (el) => !el.disabled
      );
      if (list.length === 0) return;

      const current = document.activeElement;
      if (current && current !== document.body && !list.includes(current)) {
        return; // focus is inside a different screen/overlay; not our concern
      }

      e.preventDefault();

      // Nothing focused in this screen yet -- land on the first focusable
      // element (autoFocus on mount normally already handles this; this is
      // just the defensive fallback).
      if (!current || current === document.body || !list.includes(current)) {
        list[0].focus();
        return;
      }

      const currentRect = current.getBoundingClientRect();
      const currentCenter = {
        x: currentRect.left + currentRect.width / 2,
        y: currentRect.top + currentRect.height / 2,
      };

      let best = null;
      let bestScore = Infinity;

      for (const el of list) {
        if (el === current) continue;
        const rect = el.getBoundingClientRect();
        const center = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        const dx = center.x - currentCenter.x;
        const dy = center.y - currentCenter.y;

        // Only candidates actually positioned in the requested direction
        // are considered at all -- this is what makes wrap-to-nowhere
        // impossible.
        let primary; // distance along the direction of travel
        let cross; // perpendicular offset
        if (action === 'Right') {
          if (dx <= 0) continue;
          primary = dx;
          cross = dy;
        } else if (action === 'Left') {
          if (dx >= 0) continue;
          primary = -dx;
          cross = dy;
        } else if (action === 'Down') {
          if (dy <= 0) continue;
          primary = dy;
          cross = dx;
        } else {
          // Up
          if (dy >= 0) continue;
          primary = -dy;
          cross = dx;
        }

        // Standard spatial-nav weighting: penalize perpendicular offset
        // more heavily than primary-direction distance, so it prefers "the
        // nearest thing roughly in line with me" over "the nearest thing
        // in any diagonal direction".
        const score = primary + Math.abs(cross) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      }

      // If no candidate qualifies, focus intentionally stays put -- no
      // wraparound.
      if (best) {
        best.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [containerRef]);
}
