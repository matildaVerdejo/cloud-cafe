import React from 'react';
import './MainPage.css';

const MainPage = ({ onPlayClick }) => {
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
