import React, { useMemo } from 'react';
import './CelebrationOverlay.css';

// Bumped up from the original pastel set to something more saturated/showy
// per request ("brighter... more showy in general") while still staying in
// the same color family (gold/pink/mint/sky-blue/lavender) the rest of this
// app already leans on, rather than jumping to generic primary-color
// confetti colors that would feel out of place here.
const STAR_COLORS = ['#ffcf4d', '#ff6f91', '#5bd68c', '#57b8ea', '#c58cf2'];
// Trimmed down from an original 46 -- per-element filter: drop-shadow (see
// .celebration-star in CelebrationOverlay.css) is expensive to composite,
// and this many of them animating simultaneously, on top of everything
// else already going on on this screen, was almost certainly the dominant
// cost behind a TV-only ANR/crash report right around the score reveal.
// FinalCombination.js's own CELEBRATION_BURST_MS now also bounds how long
// this runs at all, but a lighter particle count keeps even that bounded
// window cheap on weaker CTV hardware.
const STAR_COUNT = 24;

// Small, fast-twinkling white/gold flecks layered in alongside the bigger
// stars -- the actual "glitter" texture requested, distinct from the star
// shapes: denser, smaller, quicker, and plain circles rather than an
// 8-point star, so the two layers read as two different kinds of sparkle
// rather than just one shape at two sizes.
const GLITTER_COLORS = ['#fff6d8', '#ffe89c', '#ffffff'];
// Trimmed down from an original 60, same performance reasoning as
// STAR_COUNT above -- glitter's own box-shadow glow (see
// .celebration-glitter in CelebrationOverlay.css) is cheaper per-element
// than the stars' drop-shadow filter, but 60 of them animating at once was
// still adding real cost on top of everything else.
const GLITTER_COUNT = 32;

// Rolled once per mount (see the empty useMemo dependency arrays in
// CelebrationOverlay below) -- every particle gets a random position/size/
// timing/color so the burst doesn't look like a mechanically repeated
// pattern, but it only ever rolls once per appearance rather than
// re-randomizing on every render.
function rollStars(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: 16 + Math.random() * 34,
    delay: Math.random() * 2.4,
    duration: 1.5 + Math.random() * 1.2,
    color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
  }));
}

function rollGlitter(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: 3 + Math.random() * 6,
    delay: Math.random() * 1.8,
    duration: 0.6 + Math.random() * 0.7,
    color: GLITTER_COLORS[Math.floor(Math.random() * GLITTER_COLORS.length)],
  }));
}

// Full-screen sparkle burst shown over FinalCombination (see
// showCelebration there) once the score card finishes revealing a "good"
// (80+) total -- purely decorative (aria-hidden, no interaction, no layout
// impact on anything beneath it: position: absolute + pointer-events: none
// the whole way down, see CelebrationOverlay.css), sitting on top of
// everything else on that screen. Two layered particle types -- bigger,
// slower 8-point stars (each with its own colored glow, see the inline
// drop-shadow filter below) plus a denser layer of small, fast-twinkling
// white/gold glitter flecks -- rather than just one shape at one size, per
// request for something showier than the original single-star-size pass.
// Both are plain CSS clip-path/border-radius shapes rather than emoji
// glyphs, since emoji font support isn't guaranteed across every CTV
// WebView this game runs in -- a clip-path/CSS shape always renders the
// same regardless of platform.
const CelebrationOverlay = () => {
  const stars = useMemo(() => rollStars(STAR_COUNT), []);
  const glitter = useMemo(() => rollGlitter(GLITTER_COUNT), []);
  return (
    <div className="celebration-overlay" aria-hidden="true">
      {stars.map((s) => (
        <span
          key={`star-${s.key}`}
          className="celebration-star"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            backgroundColor: s.color,
            filter: `drop-shadow(0 0 ${Math.round(s.size * 0.35)}px ${s.color})`,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
          }}
        />
      ))}
      {glitter.map((g) => (
        <span
          key={`glitter-${g.key}`}
          className="celebration-glitter"
          style={{
            left: `${g.left}%`,
            top: `${g.top}%`,
            width: `${g.size}px`,
            height: `${g.size}px`,
            backgroundColor: g.color,
            boxShadow: `0 0 ${Math.round(g.size * 1.5)}px ${g.color}`,
            animationDelay: `${g.delay}s`,
            animationDuration: `${g.duration}s`,
          }}
        />
      ))}
    </div>
  );
};

export default CelebrationOverlay;
