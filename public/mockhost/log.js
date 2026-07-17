const MAX_LINES = 50;
const buf = [];
const arrow = (k) => (k === 'game->host' ? '<- ' : k === 'host->game' ? '-> ' : '   ');

export function appendLog(kind, label) {
  buf.push({ kind, label });
  if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
  const el = document.getElementById('log');
  if (!el) return;
  el.value = buf.map((e) => arrow(e.kind) + e.label).join('\n');
  el.scrollTop = el.scrollHeight;
}
