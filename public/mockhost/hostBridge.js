import { appendLog } from './log.js';

export function createHostBridge(iframe, focus) {
  function createUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getOrCreate(key, factory) {
    const cached = localStorage.getItem(key);
    if (cached) return cached;
    const fresh = factory();
    localStorage.setItem(key, fresh);
    return fresh;
  }

  function buildIframeSrc() {
    const playerId = getOrCreate('mockhost-playerId', () => createUuid());
    const sessionId = createUuid();
    const platform = 'gameloop_dev';
    const marketId = 'us';
    const appId = 'dev-app';

    // glQrURL stands in for the QR envelope GameLoop builds. It carries
    // GameLoop identity context ONLY -- no STDB/room info. This game has no
    // multiplayer/companion surface, so the game does not append an appURL;
    // the placeholder just makes the game's QP-read path testable.
    const qrInner =
      `playerId=${encodeURIComponent(playerId)}` +
      `&sessionId=${encodeURIComponent(sessionId)}` +
      `&platform=${encodeURIComponent(platform)}` +
      `&marketId=${encodeURIComponent(marketId)}` +
      `&app_id=${encodeURIComponent(appId)}`;
    const glQrURL = `https://play.gameloop.tv/?${qrInner}`;

    const params = new URLSearchParams({
      playerId, sessionId, platform, marketId, app_id: appId, glQrURL,
    });
    const display = document.getElementById('qp-display');
    if (display) {
      display.textContent =
        `playerId   ${playerId}\n` +
        `sessionId  ${sessionId}\n` +
        `platform   ${platform}\n` +
        `marketId   ${marketId}\n` +
        `app_id     ${appId}\n` +
        `glQrURL    ${glQrURL}`;
    }
    // The mock host is served from public/mockhost/ by the SAME CRA dev
    // server (or the same static host once built) as the game's own
    // index.html at '/'. This keeps mock host and game same-origin, which
    // is what the game's postMessage origin allowlist trusts by default.
    return `/?${params.toString()}`;
  }

  let handoffIntended = false;

  function returnFocusToHost() {
    handoffIntended = false;
    iframe.blur();
    document.body.focus();
    window.focus();
    focus.restoreAfterIframe();
  }

  window.addEventListener('blur', () => {
    if (handoffIntended) return;
    setTimeout(() => {
      if (!handoffIntended && document.activeElement === iframe) returnFocusToHost();
    }, 0);
  });

  // Inbound message listener -- full V1 set + focusHost dev-harness extension.
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    const t = d.type;
    if (t !== 'appReady' && t !== 'adOpportunity' && t !== 'close' && t !== 'focusHost') return;
    appendLog('game->host', `${String(t)} ${JSON.stringify(d)}`);
    if (t === 'close') { iframe.src = 'about:blank'; returnFocusToHost(); }
    if (t === 'focusHost') { returnFocusToHost(); }
  });

  return {
    init() {
      iframe.src = buildIframeSrc();
      appendLog('host', 'host.ready');
    },
    reloadIframe() {
      iframe.src = 'about:blank';
      queueMicrotask(() => {
        iframe.src = buildIframeSrc();
        appendLog('host', 'host.reloadIframe');
        focus.restoreAfterIframe();
      });
    },
    focusIframe() {
      handoffIntended = true;
      document.activeElement?.blur();
      iframe.focus();
      iframe.contentWindow?.focus();
      appendLog('host', 'host.focusIframe');
    },
    sendAdMessage(state) {
      iframe.contentWindow?.postMessage({ type: 'adMessage', message: state }, '*');
      appendLog('host->game', `adMessage ${state}`);
    },
    dispatch(action) {
      if (action === 'reloadIframe') this.reloadIframe();
      else if (action === 'focusIframe') this.focusIframe();
      else if (action.startsWith('adMessage:')) {
        const state = action.split(':')[1];
        this.sendAdMessage(state);
      }
    },
    onBack() { appendLog('host', 'host.back'); },
  };
}
