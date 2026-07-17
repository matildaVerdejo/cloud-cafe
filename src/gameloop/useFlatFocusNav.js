import { useEffect } from 'react';
import { getActionFromKeyEvent } from './pal';

// Sequential (non-spatial) D-pad focus navigation within one screen.
// Up/Left move to the previous [data-focusable] element in DOM order,
// Down/Right move to the next, wrapping at the ends. Enter/Space activation
// is native browser behavior for real <button> elements, so this hook does
// not handle Enter — only focus movement.
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

      const activeIndex = list.indexOf(document.activeElement);
      if (document.activeElement && document.activeElement !== document.body && activeIndex === -1) {
        return; // focus is inside a different screen/overlay; not our concern
      }

      let nextIndex;
      if (action === 'Up' || action === 'Left') {
        nextIndex = activeIndex <= 0 ? list.length - 1 : activeIndex - 1;
      } else {
        nextIndex = activeIndex === -1 || activeIndex >= list.length - 1 ? 0 : activeIndex + 1;
      }
      e.preventDefault();
      list[nextIndex].focus();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [containerRef]);
}
