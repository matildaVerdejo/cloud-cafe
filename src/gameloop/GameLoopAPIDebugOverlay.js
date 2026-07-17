import React, { useRef, useState } from 'react';
import './GameLoopAPIDebugOverlay.css';
import { sendAdOpportunity, sendClose, sendFocusHost, hasSentAppReady } from './bridge';
import { getActionFromKeyEvent, shouldDebounceEnter } from './pal';

// Removable GameLoop V1 debug overlay — exercises the newly-added bridge
// (adOpportunity reasons, focusHost, close) with real D-pad controls so the
// graft can be validated on a TV remote, not just a mouse. Comment out the
// single <GameLoopAPIDebugOverlay /> line in App.js to hide it; the bridge,
// PAL, and Back handling keep working with it hidden.
//
// Controls: Up/Down move selection, Enter activates. This overlay is a
// plain React DOM component (not a canvas/engine scene graph), so there is
// no autofocus race to guard against — a single ref + keydown listener is
// sufficient.
const ACTIONS = [
  { id: 'adOpportunity:LEVEL_COMPLETE', label: 'Send adOpportunity (LEVEL_COMPLETE)' },
  { id: 'adOpportunity:MENU_RETURN', label: 'Send adOpportunity (MENU_RETURN)' },
  { id: 'focusHost', label: 'Send focusHost' },
  { id: 'close', label: 'Send close' },
];

const GameLoopAPIDebugOverlay = () => {
  const [selected, setSelected] = useState(0);
  const [log, setLog] = useState([]);
  const rootRef = useRef(null);

  const appendLog = (line) => {
    setLog((prev) => [...prev.slice(-6), line]);
  };

  const runAction = (id) => {
    if (id === 'close') {
      sendClose();
      appendLog('-> close');
    } else if (id === 'focusHost') {
      sendFocusHost();
      appendLog('-> focusHost');
    } else if (id.startsWith('adOpportunity:')) {
      const reason = id.split(':')[1];
      sendAdOpportunity(reason);
      appendLog(`-> adOpportunity ${reason}`);
    }
  };

  const handleKeyDown = (e) => {
    const action = getActionFromKeyEvent(e);
    if (!action) return;
    if (action === 'Up') {
      e.preventDefault();
      setSelected((s) => (s - 1 + ACTIONS.length) % ACTIONS.length);
    } else if (action === 'Down') {
      e.preventDefault();
      setSelected((s) => (s + 1) % ACTIONS.length);
    } else if (action === 'Enter') {
      if (shouldDebounceEnter(e)) return;
      e.preventDefault();
      runAction(ACTIONS[selected].id);
    }
    // No Back handler here on purpose: Back bubbles to the game's existing
    // pause/close logic untouched.
  };

  return (
    <div
      className="gl-debug-overlay"
      ref={rootRef}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label="GameLoop API debug overlay"
    >
      <h2>GameLoop Debug Overlay</h2>
      <p className="gl-status-line">appReady sent: {hasSentAppReady() ? 'yes' : 'no'}</p>
      <ul>
        {ACTIONS.map((action, index) => (
          <li key={action.id}>
            <button
              type="button"
              tabIndex={0}
              data-focusable
              aria-pressed={selected === index}
              style={
                selected === index
                  ? { outline: '3px solid #ffd166', outlineOffset: '2px' }
                  : undefined
              }
              onFocus={() => setSelected(index)}
              onClick={() => runAction(action.id)}
            >
              {action.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="gl-log">{log.join('\n')}</div>
    </div>
  );
};

export default GameLoopAPIDebugOverlay;
