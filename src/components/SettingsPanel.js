import React from 'react';
import './SettingsPanel.css';

// Small circle button, upper-left corner. Opens a lightweight popover with
// the one thing this panel has for now: music volume up/down. (MainPage
// used to have its own separate on/off mute toggle in the upper-right
// corner -- removed once this panel's volume control shipped, since
// turning the volume down to 0% covers the same need.)
//
// Rendered once in App.js, inside .page-container -- see the big comment
// there -- rather than duplicated into every one of the seven screen
// components, so it shows up in the same corner of every single frame
// automatically. open/onToggleOpen/volume/onVolumeDown/onVolumeUp are all
// owned by App.js (same "lifted state, this component is just the view"
// pattern as every other screen in this project); containerRef is that
// same App.js's own settingsRef, given its own useFlatFocusNav scope there
// for the same reason the exit-confirm dialog needs one.
const SettingsPanel = ({ containerRef, open, onToggleOpen, volume, onVolumeDown, onVolumeUp }) => {
  const volumePercent = Math.round(volume * 100);
  return (
    <div className="settings-panel-anchor" ref={containerRef}>
      <button
        type="button"
        className="settings-toggle-button"
        data-focusable
        onClick={onToggleOpen}
        aria-label={open ? 'Close settings' : 'Open settings'}
        aria-expanded={open}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open && (
        <div className="settings-popover" role="group" aria-label="Settings">
          <p className="settings-popover-label">Music Volume</p>
          <div className="settings-volume-row">
            <button
              type="button"
              className="settings-volume-button"
              data-focusable
              onClick={onVolumeDown}
              aria-label="Turn music volume down"
            >
              −
            </button>
            <div className="settings-volume-readout">
              <div className="settings-volume-bar">
                <div className="settings-volume-bar-fill" style={{ width: `${volumePercent}%` }} />
              </div>
              <span className="settings-volume-percent" aria-live="polite">
                {volumePercent}%
              </span>
            </div>
            <button
              type="button"
              className="settings-volume-button"
              data-focusable
              onClick={onVolumeUp}
              aria-label="Turn music volume up"
            >
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPanel;
