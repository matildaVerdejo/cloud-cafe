import { useEffect, useRef, useState } from 'react';
import './SettingsPanel.css';
import { playButtonClick, playButtonClickOff } from '../gameloop/sfx';
import { getActionFromKeyEvent } from '../gameloop/pal';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';

// Third settings-popover section, alongside Music/Sound volume above --
// credits for third-party assets used in the game, surfaced through their
// own "attributions" button + medium centered dialog (see showAttributions
// below) rather than crammed into the popover itself, since license text
// needs real room to breathe. One entry per asset; each renders as its own
// header + a few plain lines of credit/license/source text. Kept as data
// here (not hardcoded JSX) so adding a future third-party asset is just
// another object in this array, not a markup change.
const ATTRIBUTIONS = [
  {
    header: 'Background Music',
    lines: [
      '“Young Jazzman’s Grin” — Anima & Animus',
      'Licensed under CC0 (No Rights Reserved).',
      'Source: https://archive.org/details/jamendo-455478',
    ],
  },
  {
    header: 'Customer Voices',
    lines: ['animalese.js by Acedio — MIT License', 'Source: https://github.com/Acedio/animalese.js'],
  },
];

// One label + -/+ stepper + bar/percent readout row -- both Music and
// Sound below are the exact same layout, just pointed at different props,
// so this is factored out rather than duplicated. label/volume/onDown/onUp
// are all owned by whichever App.js state this particular row is showing
// (musicVolume/soundVolume) -- this component has no state of its own.
// minusRef/plusRef are forwarded onto the two buttons so the parent's own
// keydown handler (see the big comment above SettingsPanel below) can
// address each one directly by identity, rather than trying to re-derive
// "which button is this" from the DOM.
function VolumeRow({ label, volume, onDown, onUp, minusRef, plusRef }) {
  const volumePercent = Math.round(volume * 100);
  return (
    <div className="settings-volume-section">
      <p className="settings-popover-label">{label}</p>
      <div className="settings-volume-row">
        <button
          ref={minusRef}
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
          ref={plusRef}
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
  const gearRef = useRef(null);
  const musicMinusRef = useRef(null);
  const musicPlusRef = useRef(null);
  const soundMinusRef = useRef(null);
  const soundPlusRef = useRef(null);
  const attributionsButtonRef = useRef(null);

  // Attributions dialog -- local to this component (not lifted to App.js
  // the way showSettings/showExitConfirm are) since nothing outside this
  // widget needs to know about it; the shared keydown effect below handles
  // its own Back-to-close directly instead, same "one widget, one effect"
  // shape the rest of this component already uses for its own nav graph.
  const [showAttributions, setShowAttributions] = useState(false);
  // Scopes the dialog's own (single-button) focus the same way App.js's
  // exitDialogRef scopes the exit-confirm dialog -- safe to call
  // unconditionally; when the dialog isn't rendered, dialogRef.current is
  // null and the hook's handler just returns early (see that ref's own
  // comment in App.js).
  const attributionsDialogRef = useRef(null);
  useFlatFocusNav(attributionsDialogRef);
  const attributionsCloseRef = useRef(null);
  // Moves focus onto the dialog's own close button the instant it opens --
  // same "auto-focus the thing that just appeared" idea as every other
  // freshly-shown overlay in this project.
  useEffect(() => {
    if (showAttributions) {
      attributionsCloseRef.current?.focus();
    }
  }, [showAttributions]);

  // Exact button-to-button keyboard graph for this widget, per request --
  // deliberately its own fixed path rather than the generic spatial
  // useFlatFocusNav nearest-neighbor matching every screen's own container
  // uses (which used to also govern this widget via App.js's old
  // settingsRef hook, now removed): Down from the gear (while open) always
  // goes to music minus; Right from music minus goes to music plus, Left
  // from music plus goes back to music minus; Down from EITHER music
  // button always goes to sound minus (not whichever sound button happens
  // to sit closest, which is what spatial matching would do); Right from
  // sound minus goes to sound plus, Left from sound plus goes back to
  // sound minus; Up from EITHER sound button always goes back to music
  // minus; Up from music minus goes back to the gear. Enter activating
  // whichever button currently has focus (volume buttons' own onClick, or
  // the gear's own open/close toggle) is unaffected -- that's native
  // <button> behavior, nothing here needs to handle it.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (!action) return;

      // Attributions dialog gets first say, same "the topmost overlay
      // handles Back before anything underneath it gets a chance"
      // convention App.js's own showExitConfirm/showSettings checks use.
      // stopImmediatePropagation keeps this same keydown event from also
      // reaching App.js's own Back handler (attached in its own, separate
      // window-level listener) -- without it, closing this dialog on Back
      // would also pop the "exit cloud cafe?" confirm dialog open right
      // behind it, since that handler has no idea this one exists.
      if (showAttributions) {
        if (action === 'Back') {
          e.preventDefault();
          e.stopImmediatePropagation();
          playButtonClickOff();
          setShowAttributions(false);
          attributionsButtonRef.current?.focus();
        }
        return;
      }

      const active = document.activeElement;

      if (active === gearRef.current) {
        if (open && action === 'Down') {
          e.preventDefault();
          musicMinusRef.current?.focus();
        }
        return;
      }

      if (active === musicMinusRef.current) {
        if (action === 'Right') {
          e.preventDefault();
          musicPlusRef.current?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          soundMinusRef.current?.focus();
        } else if (action === 'Up') {
          e.preventDefault();
          gearRef.current?.focus();
        }
        return;
      }

      if (active === musicPlusRef.current) {
        if (action === 'Left') {
          e.preventDefault();
          musicMinusRef.current?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          soundMinusRef.current?.focus();
        }
        return;
      }

      if (active === soundMinusRef.current) {
        if (action === 'Right') {
          e.preventDefault();
          soundPlusRef.current?.focus();
        } else if (action === 'Up') {
          e.preventDefault();
          musicMinusRef.current?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          attributionsButtonRef.current?.focus();
        }
        return;
      }

      if (active === soundPlusRef.current) {
        if (action === 'Left') {
          e.preventDefault();
          soundMinusRef.current?.focus();
        } else if (action === 'Up') {
          e.preventDefault();
          musicMinusRef.current?.focus();
        } else if (action === 'Down') {
          e.preventDefault();
          attributionsButtonRef.current?.focus();
        }
        return;
      }

      // Third section, below the two volume rows -- Down from EITHER sound
      // button lands here (see both branches just above), Up from here
      // always goes back to sound minus, same "always the same fixed
      // button, not whichever happens to sit closest" reasoning every other
      // leg of this graph already uses.
      if (active === attributionsButtonRef.current) {
        if (action === 'Up') {
          e.preventDefault();
          soundMinusRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, showAttributions]);

  return (
    <div className="settings-panel-anchor" ref={containerRef}>
      <button
        ref={gearRef}
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
          <VolumeRow
            label="music volume"
            volume={volume}
            onDown={onVolumeDown}
            onUp={onVolumeUp}
            minusRef={musicMinusRef}
            plusRef={musicPlusRef}
          />
          <VolumeRow
            label="sound volume"
            volume={soundVolume}
            onDown={onSoundVolumeDown}
            onUp={onSoundVolumeUp}
            minusRef={soundMinusRef}
            plusRef={soundPlusRef}
          />
          {/* Third settings-popover section -- see ATTRIBUTIONS/
              showAttributions above. Reuses .settings-volume-section purely
              for its adjacent-sibling spacing rule (see that class's own
              comment in SettingsPanel.css) even though this section has no
              volume row of its own. */}
          <div className="settings-volume-section">
            <button
              ref={attributionsButtonRef}
              type="button"
              className="settings-attributions-button"
              data-focusable
              onClick={() => {
                playButtonClick();
                setShowAttributions(true);
              }}
            >
              attributions
            </button>
          </div>
        </div>
      )}

      {/* Third-party credits -- see ATTRIBUTIONS above. A medium dialog
          centered over the whole screen (same fixed-backdrop shape as
          App.js's own .gl-exit-confirm-backdrop/-dialog, just sized for a
          few short paragraphs of credit text instead of one line + two
          buttons) rather than another popover, since license text needs
          real room. Rendered here (inside .settings-panel-anchor) rather
          than lifted up into App.js the way the exit-confirm dialog is --
          nothing outside this component needs to know it's open, see
          showAttributions's own comment above. */}
      {showAttributions && (
        <div className="settings-attributions-backdrop">
          <div className="settings-attributions-dialog" ref={attributionsDialogRef}>
            <h2 className="settings-attributions-title">attributions</h2>
            {ATTRIBUTIONS.map((credit) => (
              <div className="settings-attributions-credit" key={credit.header}>
                <p className="settings-attributions-credit-header">{credit.header}</p>
                {credit.lines.map((line) => (
                  <p className="settings-attributions-credit-line" key={line}>
                    {line}
                  </p>
                ))}
              </div>
            ))}
            <button
              ref={attributionsCloseRef}
              type="button"
              className="settings-attributions-close-button"
              data-focusable
              onClick={() => {
                playButtonClickOff();
                setShowAttributions(false);
                attributionsButtonRef.current?.focus();
              }}
            >
              close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPanel;
