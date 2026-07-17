export function createFocusController(root) {
  const buttons = () => Array.from(root.querySelectorAll('button[data-focusable]'));

  let last = null;

  const focusAt = (idx) => {
    const list = buttons();
    if (list.length === 0) return;
    const i = ((idx % list.length) + list.length) % list.length;
    list[i].focus();
    last = list[i];
  };

  return {
    focusFirst() { focusAt(0); },
    moveBy(delta) {
      const list = buttons();
      const current = document.activeElement ?? list[0];
      const idx = list.indexOf(current);
      focusAt(idx < 0 ? 0 : idx + delta);
    },
    restoreAfterIframe() {
      if (last && document.body.contains(last)) last.focus();
      else focusAt(0);
    },
    current() { return document.activeElement ?? null; },
  };
}
