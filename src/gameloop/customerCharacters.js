// Shared list of the five customer characters that can show up at the
// counter (see CUSTOMER_CHARACTERS in CustomerOrdering.js for each
// character's actual image/ordering-audio assets). Kept here, in its own
// tiny module, rather than imported directly from CustomerOrdering.js,
// because App.js (which needs the key list to build a session's shuffled
// rotation -- see buildSessionCharacterOrder below) loads CustomerOrdering
// via lazy(() => import(...)) for code-splitting; a static import of that
// component from App.js would pull its whole bundle in eagerly and defeat
// that split.
export const CUSTOMER_CHARACTER_KEYS = ['annie', 'otto', 'katie', 'teddy', 'coco'];

// Plain Fisher-Yates shuffle.
function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// A fresh, randomized order of all five characters -- one per session (see
// startNewSession in App.js, the sole place this is called). Per request:
// each of a session's ORDERS_PER_SESSION orders should show a different
// character, with every character showing up exactly once by the end of the
// session, rather than each order independently rolling any of the five
// (which could repeat one character and skip another). Index this array by
// customerNumber - 1 to get that order's character.
export function buildSessionCharacterOrder() {
  return shuffle(CUSTOMER_CHARACTER_KEYS);
}
