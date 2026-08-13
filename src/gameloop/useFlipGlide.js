import { useRef, useLayoutEffect } from 'react';

// FLIP (First-Last-Invert-Play) glide for station items.
//
// PERF background: every movable station item (tin/kettle/whisk/bowl/spoon
// on MatchaMaking, the pour bottles/cups/toppings on ToppingsStation and
// MilkSelection) used to move by animating its own `left`/`top` CSS via a
// plain `transition: left 0.2s ease, top 0.2s ease`. `left`/`top` are
// layout-affecting properties -- every frame of that 0.2s glide forced the
// browser to recompute layout AND repaint the item's filter: drop-shadow
// (a real, per-pixel alpha-blur recompute, not something the compositor can
// fast-path the way transform/opacity can) at its new position. On the TV
// hardware the perf-fix logs were captured on, this lines up with the
// AmazonKeyEventLogging "remote_perf key event latency" entries (500ms-1.8s
// to process a single button press) and the platform's own FLUIDITY_CRITICAL
// dropped-frame warnings -- picking up/moving/pouring an item is one of the
// single most common actions in this game, and it was paying this cost
// every time.
//
// The straightforward fix -- switch the moving element straight over to
// `transform: translate()` -- collides with something every one of these
// items already does: the kettle tilts while pouring, the whisk flips
// upside-down, every bottle tilts while pouring, all via their own inline
// `transform: rotate(...)`. Writing a FLIP translate onto that same
// element's `transform` would silently clobber whichever rotation is
// currently applied.
//
// FLIP sidesteps that by animating a separate wrapping element instead of
// the rotated one: the wrapper (`station-item-wrap`, see MatchaMaking.css)
// carries the actual left/top position -- set once per logical move, not
// transitioned, so it "jumps" instantly and cheaply, no repaint-per-frame --
// while this hook immediately (in the same paint) offsets that jump right
// back to where the item visually *was* via a one-shot inline
// `transform: translate()`, then clears it, letting the wrapper's own CSS
// `transition: transform` animate that offset back down to zero. The
// rotated <img> inside the wrapper never has its own `transform` touched by
// any of this, so the kettle tilt / whisk flip / bottle tilt keep working
// exactly as before, on a completely different element.
//
// Usage: call useFlipGlide() ONCE per component (top-level, unconditional,
// same as any other hook), then attach the returned `registerFlip` to each
// wrapper's `ref` -- `ref={(el) => registerFlip('kettle', el)}` -- even
// from inside a .map(). registerFlip itself is a plain ref-callback
// closure, not a hook, so calling it per-iteration inside a loop is safe
// and doesn't run into the Rules of Hooks the way calling useLayoutEffect
// itself per-item would.
export function useFlipGlide() {
  const prevRectsRef = useRef(new Map()); // key -> DOMRect from the last commit
  const nodesRef = useRef(new Map()); // key -> currently-mounted wrapper node

  // No dependency array -- deliberately runs after every commit (cheap: a
  // handful of getBoundingClientRect reads plus a numeric compare, not a
  // full pass over anything expensive), since a moved item can result from
  // any number of different state changes across these large components and
  // there's no single dependency list that would reliably cover all of them.
  useLayoutEffect(() => {
    nodesRef.current.forEach((node, key) => {
      if (!node || !node.isConnected) {
        prevRectsRef.current.delete(key);
        return;
      }
      const prevRect = prevRectsRef.current.get(key);
      const newRect = node.getBoundingClientRect();
      if (prevRect) {
        const dx = prevRect.left - newRect.left;
        const dy = prevRect.top - newRect.top;
        // Sub-pixel jitter (layout rounding, not an actual move) isn't
        // worth animating -- also guards against re-triggering a FLIP off
        // of its own already-in-flight transition settling.
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          node.style.transition = 'none';
          node.style.transform = `translate(${dx}px, ${dy}px)`;
          // Force a synchronous style/layout flush so the browser commits
          // the offset above as a real starting frame before the next two
          // lines change it again -- without this, the browser would
          // coalesce all three writes into one and there'd be nothing to
          // animate from.
          // eslint-disable-next-line no-unused-expressions
          node.offsetHeight;
          node.style.transition = '';
          node.style.transform = '';
        }
      }
      prevRectsRef.current.set(key, newRect);
    });
  });

  return (key, node) => {
    if (node) {
      nodesRef.current.set(key, node);
    } else {
      nodesRef.current.delete(key);
      prevRectsRef.current.delete(key);
    }
  };
}
