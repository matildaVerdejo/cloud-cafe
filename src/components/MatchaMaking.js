import React, { useRef } from 'react';
import './MatchaMaking.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import ProgressBar from './ProgressBar';
import OrderReceiptButton from './OrderReceiptButton';

// Static (not yet interactive) countertop items, layered on top of the now-
// empty background art. Positions were worked out by compositing each item
// onto the background at a few candidate boxes and eyeballing the result
// (see the process notes -- each box is left/top/width/height as a % of the
// 1394x768 art, matching the milk station's percentage-box convention).
// Each item PNG has already been cropped to its own visible content (no
// leftover transparent padding), so width/height here can use the image's
// own aspect ratio without distortion.
//
// These are purely decorative for now -- no data-focusable, no drag. The
// next step (once the actual matcha-making interaction is designed) is to
// wire each of these up the same way the glass cup / ice cubes work on the
// Milk Selection screen.
const STATION_ITEMS = [
  { key: 'heater', src: './Heater.png', alt: 'Heater plate', left: 3, top: 65.5, width: 25, height: 17.5 },
  { key: 'kettle', src: './kettle.png', alt: 'Pour-over kettle', left: 3.5, top: 40.1, width: 24, height: 31.4 },
  { key: 'bowl', src: './Bowl.png', alt: 'Matcha mixing bowl', left: 38, top: 32.3, width: 24, height: 45.7 },
  { key: 'whisk', src: './whisk.png', alt: 'Bamboo whisk', left: 91, top: 60.6, width: 6, height: 21.4 },
  { key: 'cafe-grade', src: './CafeGrade.png', alt: 'Cafe grade matcha tin', left: 68, top: 55.18, width: 6, height: 16.82 },
  { key: 'classic-grade', src: './ClassicGrade.png', alt: 'Classic grade matcha tin', left: 75, top: 55.02, width: 6, height: 16.98 },
  { key: 'ceremonial-grade', src: './CeremonialGrade.png', alt: 'Ceremonial grade matcha tin', left: 82, top: 55.04, width: 6, height: 16.96 },
];

const MatchaMaking = ({ activeStep, customerNumber, onNavigate, onAdvance }) => {
  const containerRef = useRef(null);
  useFlatFocusNav(containerRef);

  return (
    <div className="matcha-making-container" ref={containerRef}>
      <h1 className="sr-only">Matcha Base Station</h1>

      <div className="matcha-making-content">
        <img
          src="./MatchaBaseStation.png"
          alt="Matcha base station counter"
          className="matcha-making-art"
        />
        {STATION_ITEMS.map((item) => (
          <img
            key={item.key}
            src={item.src}
            alt={item.alt}
            className="station-item"
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              width: `${item.width}%`,
              height: `${item.height}%`,
            }}
          />
        ))}
        <OrderReceiptButton />
        <ProgressBar
          activeStep={activeStep}
          customerNumber={customerNumber}
          onNavigate={onNavigate}
          onAdvance={onAdvance}
        />
      </div>
    </div>
  );
};

export default MatchaMaking;
