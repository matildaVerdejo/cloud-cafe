import React from 'react';
import './MainPage.css';

const MainPage = ({ onPlayClick, musicOn, onToggleMusic }) => {
  return (
    <div className="main-container">
      {/* Visually hidden; the storefront art below already shows the "Cloud
          Cafe" sign, this just keeps the page title available to screen
          readers / the document outline. */}
      <h1 className="sr-only">Cloud Cafe</h1>

      <div className="main-content">
        <img
          src="./CloudCafeHome.png"
          alt="Cloud Cafe storefront"
          className="home-art"
        />
        {/* Music on/off toggle -- only rendered here, top-right corner, per
            the request. The music itself is a single <audio> element that
            lives in App.js (outside this component) so it keeps looping
            across every screen regardless of whether this button is ever
            revisited; this just flips the shared musicOn flag. */}
        <button
          type="button"
          className={`music-toggle-button${musicOn ? '' : ' muted'}`}
          data-focusable
          onClick={onToggleMusic}
          aria-label={musicOn ? 'Turn music off' : 'Turn music on'}
          aria-pressed={musicOn}
        >
          <span aria-hidden="true">♪</span>
        </button>
        {/* Visible button positioned over the "PLAY" sign drawn onto the
            door art (see MainPage.css). Styled to match the Back button on
            the Customer Ordering screen. Percentage-based so it stays
            aligned with the art at any render size. */}
        <button
          type="button"
          className="play-button"
          data-focusable
          autoFocus
          onClick={onPlayClick}
        >
          Start
        </button>
      </div>
    </div>
  );
};

export default MainPage;
