import { getActionFromKeyEvent } from './pal.js';
import { createFocusController } from './focus.js';
import { createHostBridge } from './hostBridge.js';

const nav = document.getElementById('mockhost-nav');
const iframe = document.getElementById('game-frame');
const splash = document.getElementById('splash');

const focus = createFocusController(nav);
const hostBridge = createHostBridge(iframe, focus);

hostBridge.init();
if (splash) splash.style.display = 'none';
focus.focusFirst();

// The ONE keydown router. Bubble phase. No capture. No click handlers.
window.addEventListener('keydown', (e) => {
  const action = getActionFromKeyEvent(e);
  if (!action) return;
  switch (action) {
    case 'Up': e.preventDefault(); focus.moveBy(-1); break;
    case 'Down': e.preventDefault(); focus.moveBy(1); break;
    case 'Enter': {
      e.preventDefault();
      const target = focus.current();
      if (!target) break;
      const dataAction = target.dataset.action;
      if (dataAction) hostBridge.dispatch(dataAction);
      break;
    }
    case 'Back': e.preventDefault(); hostBridge.onBack(); break;
    default: break;
  }
}, false);
