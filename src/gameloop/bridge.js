// GameLoop V1 Messaging bridge.
//
// The game runs in a nested iframe inside the GameLoop launcher. All
// communication with the host goes through window.parent.postMessage.
// This module owns that surface so the rest of the app only calls plain
// functions (sendAppReady, sendClose, sendAdOpportunity) and subscribes to
// inbound ad lifecycle via onAdMessage.
//
// Origin policy: inbound messages are only acted on if event.origin is in
// HOST_ORIGINS. Same-origin covers the dev mock host (served as a sibling
// static page during local testing). Production/staging launcher origins
// are added below, per the GameLoop messaging guide -- note the parent is
// GameLoop Main rather than the Launcher in the direct-hosting topology, so
// confirm the full current domain list with GameLoop developer support
// before relying on this allowlist in production.
const HOST_ORIGINS = [window.location.origin];
HOST_ORIGINS.push(
  'https://gameloop-launcher.gameloop.tv',
  'https://gameloop-launcher.dev.gameloop.tv',
  'https://gameloop-launcher.stage.gameloop.tv',
);

function isTrustedOrigin(origin) {
  return HOST_ORIGINS.includes(origin);
}

// ---- Inbound query parameters (read once at startup) ----------------------
// GameLoop passes exactly six QPs on iframe load. Unknown QPs are ignored;
// missing QPs must not throw (mock hosts may inject only a subset).
export function readGameLoopQueryParams() {
  const qs = new URLSearchParams(window.location.search);
  return {
    playerId: qs.get('playerId'),
    sessionId: qs.get('sessionId'),
    platform: qs.get('platform'),
    marketId: qs.get('marketId'),
    appId: qs.get('app_id'),
    glQrURL: qs.get('glQrURL'),
  };
}

// publisherUserId vs playerId: this game has no auth system of its own, so
// per the GameLoop contract we copy playerId and use it as publisherUserId.
// Fall back to a locally-generated id so the bridge still works outside the
// launcher/mock host (e.g. `npm start` opened directly in a tab).
function resolvePublisherUserId(playerId) {
  if (playerId) return playerId;
  const key = 'cloud-cafe-publisherUserId';
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = 'local-' + Math.random().toString(36).slice(2);
    window.localStorage.setItem(key, id);
  }
  return id;
}

let publisherUserId = null;
let appReadySent = false;

export function initGameLoopBridge() {
  const { playerId } = readGameLoopQueryParams();
  publisherUserId = resolvePublisherUserId(playerId);
  return publisherUserId;
}

function post(payload) {
  // Games always target '*' for postMessage per the V1 integration guide —
  // the iframe does not know the launcher's exact origin in advance. Inbound
  // validation (isTrustedOrigin) is what protects us from spoofed messages.
  window.parent.postMessage(payload, '*');
}

export function sendAppReady() {
  if (appReadySent) return; // appReady is emitted once
  appReadySent = true;
  post({ type: 'appReady', publisherUserId });
}

// close MUST be the bare string 'close' -- it is the only form the deployed
// production launcher relays (object-form close is dropped). Do not wrap
// this in an object, even though appReady/adOpportunity are objects.
export function sendClose() {
  post('close');
}

// adOpportunity MUST carry both source: 'APPSHELL' (the launcher relay's
// gate/round-trip routing key) and ad_platform: 'playerwon' (GameLoop Main
// drops object-branch requests missing this) -- this is the only shape that
// fires in both hosting topologies (direct and launcher-wrapped). reason
// examples used in this game: 'MENU_RETURN', 'DRINK_COMPLETE'.
export function sendAdOpportunity(reason) {
  post({
    type: 'adOpportunity',
    publisherUserId,
    reason,
    source: 'APPSHELL',
    ad_platform: 'playerwon',
  });
}

// Dev-harness extension (not part of production V1). Starter mock hosts
// handle this by releasing iframe focus and restoring host focus. Real
// launchers are not required to act on it, so it is safe to send.
export function sendFocusHost() {
  post({ type: 'focusHost', publisherUserId });
}

// Subscribe to inbound adMessage lifecycle. Returns an unsubscribe function.
// handler receives one of: 'ads.started' | 'ads.inProgress' | 'ads.completed' | 'ads.skipped'
export function onAdMessage(handler) {
  const listener = (event) => {
    if (!isTrustedOrigin(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'adMessage') return;
    handler(data.message, data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export function getPublisherUserId() {
  return publisherUserId;
}

export function hasSentAppReady() {
  return appReadySent;
}
