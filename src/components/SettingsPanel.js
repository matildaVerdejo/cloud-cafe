import React from 'react';
import './SettingsPanel.css';
import { playButtonClick, playButtonClickOff } from '../gameloop/sfx';

// One label + -/+ stepper + bar/percent readout row -- both Music and
// Sound below are the exact same layout, just pointed at different props,
// so this is factored out rather than duplicated. label/volume/onDown/onUp
// are all owned by whichever App.js state this particular row is showing
// (musicVolume/soundVolume) -- this component has no state of its own.
function VolumeRow({ label, volume, onDown, onUp }) {
  const volumePercent = Math.round(volume * 100);
  return (
    <div className="settings-volume-section">
      <p className="settings-popover-label">{label}</p>
      <div className="settings-volume-row">
        <button
          type="button"
          className="settings-volume-button"
          data-focusable
          onClick={() => {
            playButtonClick();
            onDown?.();
          }}
          aria-label={`Turn ${label.toLowerCase()} down`}
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
          onClick={() => {
            playButtonClick();
            onUp?.();
          }}
          aria-label={`Turn ${label.toLowerCase()} up`}
        >
          +
        </button>
      </div>
    </div>
  );
}

// Small circle button, upper-left corner. Opens a lightweight popover with
// two independent volume controls: Music (background music, App.js's own
// looping <audio ref> element) and Sound (every one-shot SFX/voice clip
// played through gameloop/sfx.js -- button clicks, the character ordering
// voice line, and whatever else gets added there later). Split into two
// controls rather than one shared slider so a player can turn either down
// without the other -- e.g. keep music but mute clicks, or the reverse.
// (MainPage used to have its own separate on/off mute toggle in the
// upper-right corner -- removed once this panel's volume controls shipped,
// since turning a volume down to 0% covers the same need.)
//
// Rendered once in App.js, inside .page-container -- see the big comment
// there -- rather than duplicated into every one of the seven screen
// components, so it shows up in the same corner of every single frame
// automatically. open/onToggleOpen and both volume/onVolumeDown/onVolumeUp
// pairs are all owned by App.js (same "lifted state, this component is
// just the view" pattern as every other screen in this project);
// containerRef is that same App.js's own settingsRef, given its own
// useFlatFocusNav scope there for the same reason the exit-confirm dialog
// needs one.
const SettingsPanel = ({
  containerRef,
  open,
  onToggleOpen,
  volume,
  onVolumeDown,
  onVolumeUp,
  soundVolume,
  onSoundVolumeDown,
  onSoundVolumeUp,
}) => {
  return (
    <div className="settings-panel-anchor" ref={containerRef}>
      <button
        type="button"
        className="settings-toggle-button"
        data-focusable
        onClick={() => {
          // open is this button's state *before* the click -- true here
          // means the click is about to close the popover, so it gets the
          // "off" clip; false means it's about to open, so the regular
          // click. See playButtonClickOff's own doc comment in sfx.js.
          if (open) {
            playButtonClickOff();
          } else {
            playButtonClick();
          }
          onToggleOpen?.();
        }}
        aria-label={open ? 'Close settings' : 'Open settings'}
        aria-expanded={open}
      >
        {/* Hand-built gear shape (8 teeth, single polygon) rather than a
            font character, so sizing/centering is exact and independent of
            whatever font the ⚙ (U+2699) glyph it replaces would've fallen
            back to. Drawn as an outline (fill="none" + stroke) rather than
            solid per request -- hollow in the middle, but still no small
            center hole/dot the way the original glyph had, since there's
            no separate inner shape being cut out, just one open ring. */}
        <svg
          className="settings-gear-icon"
          viewBox="0 0 100 100"
          aria-hidden="true"
          focusable="false"
        >
          <polygon
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinejoin="round"
            points="41.42,17.10 43.70,4.43 56.30,4.43 58.58,17.10 67.19,20.67 77.76,13.32 86.68,22.24 79.33,32.81 82.90,41.42 95.57,43.70 95.57,56.30 82.90,58.58 79.33,67.19 86.68,77.76 77.76,86.68 67.19,79.33 58.58,82.90 56.30,95.57 43.70,95.57 41.42,82.90 32.81,79.33 22.24,86.68 13.32,77.76 20.67,67.19 17.10,58.58 4.43,56.30 4.43,43.70 17.10,41.42 20.67,32.81 13.32,22.24 22.24,13.32 32.81,20.67"
          />
        </svg>
      </button>
      {open && (
        <div className="settings-popover" role="group" aria-label="Settings">
          <VolumeRow label="Music Volume" volume={volume} onDown={onVolumeDown} onUp={onVolumeUp} />
          <VolumeRow
            label="Sound Volume"
            volume={soundVolume}
            onDown={onSoundVolumeDown}
            onUp={onSoundVolumeUp}
          />
        </div>
      )}
    </div>
  );
};

export default SettingsPanel;
