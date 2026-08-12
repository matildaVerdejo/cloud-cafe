import React, { useEffect, useRef, useState } from 'react';
import './FinalCombination.css';
import { useFlatFocusNav } from '../gameloop/useFlatFocusNav';
import { getActionFromKeyEvent } from '../gameloop/pal';
import { playButtonClick, playScoreFailSound, playScoreMidSound, playScoreGoodSound } from '../gameloop/sfx';
import { computeOverallScore } from '../gameloop/scoring';
import ProgressBar from './ProgressBar';
import ScoreCard, { SCORE_REVEAL_TOTAL_MS, STICKER_REVEAL_DELAY_MS } from './ScoreCard';
import CelebrationOverlay from './CelebrationOverlay';
import { getMilkBoxFor, getMatchaBoxFor, getIceCupSlotPos, getIceCubeSize, CUP_TYPES } from './MilkSelection';
import {
  getSyrupBoxFor,
  getFoamBoxFor,
  getFoamCapBoxFor,
  getPowderLiquidBoxFor,
  getFleckPositions,
  getLeafBoxFor,
  getChipBoxFor,
  getBlossomBoxFor,
  POWDER_FLECK_OFFSETS_ELLIPSE,
  POWDER_FLECK_OFFSETS_LIQUID,
} from './ToppingsStation';

// Display name per customer character key -- CustomerOrdering.js's own
// CUSTOMER_CHARACTERS only has src/alt (image concerns), not a plain display
// name, and order.customerCharacter (see below) only ever carries the raw
// key ('annie' | 'otto' | 'kitty' | 'teddy' | 'coco'), so this is what turns
// that key into the "<Name> Order" title ScoreCard.js's own score-card-title
// now shows.
const CUSTOMER_CHARACTER_NAME = { annie: 'annie', otto: 'otto', kitty: 'kitty', teddy: 'teddy', coco: 'coco' };

// One "reaction sticker" per character per score tier -- fail -> angry,
// mid -> annoyed, good -> happy, same three tiers computeOverallScore
// (gameloop/scoring.js) already buckets the round's total into for
// ScoreCard's own total-pill coloring, just reused here for which sticker
// shows instead of which color does. Files are the three emotion PNGs per
// character (Annie/Kitty/Otto/Teddy/Coco), each already trimmed to its own
// alpha bounding box -- rendered with object-fit: contain (see .serving-
// reaction-sticker in FinalCombination.css) rather than the shared-canvas
// crop CustomerOrdering.js's own portraits use, since these don't need to
// match each other pixel-for-pixel the way five same-pose ordering
// portraits do -- a sticker propped next to the plate reads fine at its own
// natural aspect ratio.
const REACTION_STICKERS = {
  annie: { fail: './AnnieAngry.png', mid: './AnnieAnnoyed.png', good: './AnnieHappy.png' },
  kitty: { fail: './KittyAngry.png', mid: './KittyAnnoyed.png', good: './KittyHappy.png' },
  otto: { fail: './OttoAngry.png', mid: './OttoAnnoyed.png', good: './OttoHappy.png' },
  teddy: { fail: './TeddyAngry.png', mid: './TeddyAnnoyed.png', good: './TeddyHappy.png' },
  coco: { fail: './CocoAngry.png', mid: './CocoAnnoyed.png', good: './CocoHappy.png' },
};

// Same three tiers as REACTION_STICKERS above, just pointing at the score
// reveal's own one-shot audio stinger (sfx.js) instead of an image -- not
// keyed by character (unlike the stickers), since there's only one clip per
// tier regardless of who's at the counter. Played alongside the reaction
// sticker's own reveal (see showSticker below) rather than any earlier
// score-reveal moment, so the sound lands on the same beat as the visual
// "reaction" it's reinforcing.
const SCORE_TIER_SOUNDS = {
  fail: playScoreFailSound,
  mid: playScoreMidSound,
  good: playScoreGoodSound,
};

// Where the finished drink (see incomingDrink below), carried over from
// ToppingsStation's own "Send to Serving" drop-zone, comes to rest on top
// of the empty plate in Serving.png -- purely decorative here (no drag/
// Enter interaction; there's nothing left to do with the drink once it's
// served).
//
// PLATE_CENTER_X/PLATE_SURFACE_Y are an eyeballed measurement of the plate
// in Serving.png (1394x768 art, see .serving-art in FinalCombination.css):
// the plate's flat serving surface (its top face, above the thicker rim/
// side wall beneath it, not the outer edge of the rim itself) spans
// roughly image x 215-1055, y 505-640. PLATE_CENTER_X is that span's own
// horizontal midpoint (as a % of the image's width, which maps 1:1 to this
// container's own width since object-fit: contain scales this
// wider-than-16:9 image to exactly 100% width -- see .serving-art).
// PLATE_SURFACE_Y is that span's own vertical midpoint, converted from
// %-of-image to %-of-container via the same (16/9)/(1394/768) ratio
// .score-receipt's own comment uses, since the image itself only fills
// ~97.96% of the container's height (object-fit: contain leaves a small
// letterbox at the bottom, anchored there by object-position: top). Very
// likely needs real tuning once actually seen against the live render,
// same caveat as every other eyeballed box in this project.
//
// The actual drink SIZE (and therefore FINAL_DRINK_SPOT, which depends on
// it) can't be a fixed module constant anymore now that Milk Selection has
// three cup types (glass/plastic/mug) of different widths -- see
// finalDrinkSize/finalDrinkSpot in the component below, computed from
// incomingDrink.cupType via the CUP_TYPES map imported from
// MilkSelection.js, same "read the real cup type instead of always
// assuming glass" fix ToppingsStation.js's own incomingCupType/
// incomingDrinkSize got.
const PLATE_CENTER_X = 45.6;
const PLATE_SURFACE_Y_IMAGE_PCT = 74.5;
const IMAGE_TO_CONTAINER_HEIGHT_SCALE = 16 / 9 / (1394 / 768);
const PLATE_SURFACE_Y = PLATE_SURFACE_Y_IMAGE_PCT * IMAGE_TO_CONTAINER_HEIGHT_SCALE;

const FinalCombination = ({
  activeStep,
  customerNumber,
  onNavigate,
  onAdvance,
  // This round's placed order (App.js's own currentOrder) -- only actually
  // needed here for its customerCharacter field (see placeOrder in
  // CustomerOrdering.js), so ScoreCard's title can name whichever character
  // this round's customer was, same "read the real state" reasoning as
  // incomingDrink itself.
  order,
  incomingDrink,
  // Whether there's actually a next order this session (App.js's own
  // customerNumber < ORDERS_PER_SESSION) -- true for the first
  // ORDERS_PER_SESSION - 1 orders, false for the last one (which instead
  // returns to the main menu, unchanged). Drives the "Start order N" button below and
  // disables the ProgressBar's own Right-arrow/current-dot "advance"
  // gesture while true, so starting a new round is only ever done through
  // that dedicated button -- see its own comment further down.
  hasNextOrder = false,
  // Per-category score results (see ScoreCard.js and gameloop/scoring.js) --
  // each null until the station that produces it hands it off, same "lifted
  // through App.js state, threaded down as a prop" shape incomingDrink
  // itself already uses.
  orderTakingScore,
  matchaScore,
  mixingScore,
  toppingsScore,
  // Whether App.js currently has a blocking adOpportunity in flight (see
  // its own adGate comment) -- disables the "Start order N+1" button below
  // for the duration, same reasoning as MainPage's own Play button.
  adGate = false,
  // Requests the between-order adOpportunity and, once the host resolves
  // it, actually advances to the next order (App.js's requestAd wraps
  // handleAdvance as the deferred continuation) -- called from the "Start
  // order N+1" button below instead of onAdvance directly. Only ever
  // invoked once dwellElapsed is true (see below), which is what keeps the
  // ad request itself from ever firing before the required outcome-
  // comprehension dwell has actually finished.
  onStartNextOrder,
}) => {
  const containerRef = useRef(null);
  // Remembers whichever element focus jumped to Settings FROM, whenever
  // that happens (see the bridge effect further down, right after
  // showNextOrderSpotlight's own focus effect) -- read back by that same
  // bridge's own "gear -> Down" leg so coming back down from Settings
  // always lands wherever the player actually left from (the first score-
  // card row, or the start-next-order button), same "ref declared early,
  // synced late" pattern every other station's own preSettingsFocusRef
  // uses (see e.g. MilkSelection.js's own copy).
  const preSettingsFocusRef = useRef(null);

  // ---- Celebration overlay (see CelebrationOverlay.js) ---------------------
  // Shown once the round's overall score lands in the "good" tier (80+, see
  // computeOverallScore in gameloop/scoring.js -- the exact same helper
  // ScoreCard.js's own total pill uses, so this can never disagree with
  // what the card itself is showing). Timed to appear right as ScoreCard's
  // own staggered count-up reveal actually finishes (SCORE_REVEAL_TOTAL_MS,
  // exported from ScoreCard.js) rather than popping in immediately alongside
  // the rest of this screen -- the sparkles are the payoff at the end of the
  // reveal, not competing with it. Reset back to false (and the timer
  // re-armed) any time the tier changes, which in practice only really
  // matters going from one customer's round to the next.
  const { tier: scoreTier } = computeOverallScore({ orderTakingScore, matchaScore, mixingScore, toppingsScore });
  // Which reaction sticker (see REACTION_STICKERS above) actually shows,
  // combining that same tier with this round's own customerCharacter (see
  // order above) -- null (nothing rendered) until both are known, same
  // "don't assume, read the real state" caution the rest of this file
  // already takes with e.g. incomingDrink.
  const reactionSticker = order?.customerCharacter ? REACTION_STICKERS[order.customerCharacter]?.[scoreTier] ?? null : null;
  const [showCelebration, setShowCelebration] = useState(false);
  useEffect(() => {
    setShowCelebration(false);
    if (scoreTier !== 'good') return undefined;
    const timeoutId = setTimeout(() => setShowCelebration(true), SCORE_REVEAL_TOTAL_MS);
    return () => clearTimeout(timeoutId);
  }, [scoreTier]);
  // Reaction sticker doesn't mount until STICKER_REVEAL_DELAY_MS (imported
  // from ScoreCard.js) -- that's timed to land right after the score
  // card's own total pill finishes changing color (see that constant's own
  // comment), so the sticker reads as a reaction to the color, not
  // something that was just sitting there the whole time. Gated on
  // mounting the <img> itself (rather than always rendering it and toggling
  // a class) so its own CSS "slam" entrance animation (see
  // .serving-reaction-sticker in FinalCombination.css) genuinely restarts
  // from the beginning at that moment instead of needing an animation-delay
  // guess.
  const [showSticker, setShowSticker] = useState(false);
  useEffect(() => {
    setShowSticker(false);
    if (!reactionSticker) return undefined;
    const timeoutId = setTimeout(() => {
      setShowSticker(true);
      // Fires right alongside the sticker's own reveal (see
      // SCORE_TIER_SOUNDS above) so the sound and the visual land on the
      // exact same beat, off the exact same timeout, rather than two
      // separate effects that could theoretically drift. scoreTier is
      // listed alongside reactionSticker below even though the two always
      // change together (both derive from the same round's score) --
      // react-hooks/exhaustive-deps flags any value read inside an effect
      // that isn't in its own dependency array regardless of that kind of
      // logical relationship, and this project's CI build treats that as a
      // hard error, not just a lint warning.
      SCORE_TIER_SOUNDS[scoreTier]?.();
    }, STICKER_REVEAL_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [reactionSticker, scoreTier]);

  // ---- Between-order adOpportunity dwell gate -------------------------
  // GameLoop's ad policy requires an outcome-triggered adOpportunity (this
  // round's result, i.e. the score reveal) to not fire synchronously with
  // the triggering event -- the player needs to actually see the result
  // first, for at least STICKER_REVEAL_DELAY_MS-worth of reveal (which
  // itself already clears the >=3-4s floor in tv-gameplay-envelopes.md
  // "Timing envelopes", see that constant's own comment in ScoreCard.js).
  // The "Start order N+1" button below stays disabled until this flips
  // true, which is what actually enforces the dwell -- onStartNextOrder
  // (and therefore the adOpportunity request it makes) is only reachable
  // through that button, so it can never fire early. Reset on every fresh
  // round (customerNumber changing) the same way showSticker/showCelebration
  // reset above; only armed at all when hasNextOrder is true, since the
  // button (and therefore this gate) doesn't exist on the 7th/last order.
  const [dwellElapsed, setDwellElapsed] = useState(false);
  useEffect(() => {
    setDwellElapsed(false);
    if (!hasNextOrder) return undefined;
    const timeoutId = setTimeout(() => setDwellElapsed(true), STICKER_REVEAL_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [hasNextOrder, customerNumber]);

  // ---- First-order-only walkthrough (see e.g. showSyrupSpotlight in
  // ToppingsStation.js for the established shape this mirrors) ------------
  // Two beats: first, everything but the drink/sticker/score card is dimmed
  // and the score card itself flashes white with a callout pointing at it,
  // until the player actually opens one of its four sections; then that
  // callout is replaced by a second one pointing at the "start order N+1"
  // button, with everything but the drink/score card/that button dimmed,
  // until the player presses it. hasOpenedScoreSection is what pivots
  // between the two -- flipped true by ScoreCard's own onSectionOpen below,
  // reset back to false on every fresh round the same way
  // dwellElapsed/showSticker/showCelebration already reset above (only
  // actually matters for going into a customerNumber === 1 round more than
  // once wouldn't normally happen, but keeps this state honest either way).
  const [hasOpenedScoreSection, setHasOpenedScoreSection] = useState(false);
  useEffect(() => {
    setHasOpenedScoreSection(false);
  }, [customerNumber]);
  const showScoreSpotlight = customerNumber === 1 && !hasOpenedScoreSection;
  // Gated on hasNextOrder too -- the "start order N+1" button this beat
  // points at doesn't even render on the final order (see hasNextOrder's
  // own comment above), so there's nothing for this second beat to spotlight
  // in that case. In practice customerNumber === 1 always has a next order
  // (it's the first of several), but this keeps the flag honest regardless.
  const showNextOrderSpotlight = customerNumber === 1 && hasOpenedScoreSection && hasNextOrder;
  // Shorthand for "exempt from the pink tint in either beat" -- the drink
  // cup, its contents, and the score card all stay visible the whole
  // walkthrough (unlike the sticker/start-next-order-button, which are only
  // exempt in one beat each -- see their own classNames further down).
  const finalSpotlightExempt = showScoreSpotlight || showNextOrderSpotlight;

  // Moves focus onto the first score-card row the instant the first beat
  // goes live, same "auto-focus the beat's own target" pattern every other
  // station's own walkthrough uses (see e.g. the syrup-bottle focus effect
  // in ToppingsStation.js). Queried off containerRef rather than a fresh
  // ref of its own since ScoreCard doesn't otherwise need to forward one out
  // -- the row's own [data-focusable] is already unique enough to find here.
  useEffect(() => {
    if (showScoreSpotlight) {
      containerRef.current?.querySelector('.score-card-row')?.focus();
    }
  }, [showScoreSpotlight]);
  // Same idea for the second beat's own target, once it goes live.
  useEffect(() => {
    if (showNextOrderSpotlight) {
      containerRef.current?.querySelector('.start-next-order-button')?.focus();
    }
  }, [showNextOrderSpotlight]);

  // Bridges this screen's own container to the Settings gear (rendered
  // once in App.js, outside this screen's own containerRef) -- per
  // request, the player should always be able to go Up from the
  // walkthrough's own currently-focused item to Settings, and back down
  // again. Two legs: Up from the first score-card row (the only row that
  // could ever have nowhere else to go Up to within the card itself, so
  // this can never collide with ordinary Up/Down movement BETWEEN rows,
  // which the generic useFlatFocusNav(containerRef) hook below already
  // handles on its own) while showScoreSpotlight is up; and Up from the
  // start-next-order button (a single item, no siblings to collide with
  // either) while showNextOrderSpotlight is up. Neither beat has a mini-
  // challenge of its own on this screen (unlike e.g. ToppingsStation's
  // pour/lever-catch minigames), so unlike those stations' own versions of
  // this bridge there's no extra guard needed here beyond the beat flag
  // itself. Registered here, before useFlatFocusNav(containerRef) right
  // below, for the same "sees focus as it was before any handler for this
  // keypress has run" reasoning every other station's own bridge effect
  // documents.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = getActionFromKeyEvent(e);
      if (action !== 'Up' && action !== 'Down') return;
      const active = document.activeElement;
      const gearButton = document.querySelector('.settings-toggle-button');

      if (action === 'Up' && showScoreSpotlight && active === containerRef.current?.querySelector('.score-card-row')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        preSettingsFocusRef.current = active;
        gearButton?.focus();
        return;
      }

      if (action === 'Up' && showNextOrderSpotlight && active === document.querySelector('.start-next-order-button')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        preSettingsFocusRef.current = active;
        gearButton?.focus();
        return;
      }

      if (active === gearButton && action === 'Down' && !document.querySelector('.settings-popover')) {
        const target = preSettingsFocusRef.current;
        if (target && document.contains(target) && !target.disabled) {
          e.preventDefault();
          e.stopImmediatePropagation();
          target.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showScoreSpotlight, showNextOrderSpotlight]);

  useFlatFocusNav(containerRef);

  // ---- Carried-over drink from Toppings Station (see incomingDrink above)
  // Which cup type this actually is -- ToppingsStation's own
  // beginSendToFinal forwards cupType straight through from what Milk
  // Selection originally set, same "read the real type instead of always
  // assuming glass" fix as that screen's own incomingCupType. Defaults to
  // 'glass' if it's ever missing (incomingDrink is null before the
  // player's first order this round).
  const finalCupType = incomingDrink?.cupType ?? 'glass';
  const finalDrinkSize = CUP_TYPES[finalCupType].tableSize;
  // FINAL_DRINK_SPOT.top is backed out from PLATE_SURFACE_Y so the cup's
  // own BOTTOM edge (not its vertical center -- there's a lot of empty
  // glass headroom above the liquid in this art, same as every other
  // screen) lands on the plate's surface, rather than the cup floating
  // with its middle pinned there -- see the big comment on
  // PLATE_CENTER_X/PLATE_SURFACE_Y above. Computed here (rather than as a
  // fixed module constant) since it depends on finalDrinkSize, which
  // varies by cup type.
  const finalDrinkSpot = {
    left: PLATE_CENTER_X - finalDrinkSize.width / 2,
    top: PLATE_SURFACE_Y - finalDrinkSize.height,
  };

  // Same box math ToppingsStation.js uses for its own carried-over cup,
  // just computed against this screen's own fixed finalDrinkSpot/
  // finalDrinkSize instead of that screen's own (draggable)
  // incomingDrinkRenderPos/incomingDrinkSize -- the drink doesn't move
  // once it's arrived here, so there's no render-position state to thread
  // through the way that screen needs for its own drag/carry. incomingDrink
  // shape is whatever ToppingsStation's beginSendToFinal hands off: milk/
  // matcha are the same { type }/{ grade } shapes Milk Selection's own
  // cupMilk/cupMatcha use, foam/syrup/powder are that screen's own cupFoam/
  // cupSyrup/cupPowder shapes ({ key } | null each), and cupType is which
  // cup this all needs to render inside of.
  const incomingMilkBox = incomingDrink?.milk ? getMilkBoxFor(finalDrinkSpot, finalDrinkSize, CUP_TYPES[finalCupType].bodyFrac) : null;
  const incomingMatchaBox = incomingDrink?.matcha && incomingMilkBox ? getMatchaBoxFor(incomingMilkBox) : null;
  const incomingSyrupBox = incomingDrink?.syrup && incomingMilkBox ? getSyrupBoxFor(incomingMilkBox) : null;
  const incomingTopBox = incomingMatchaBox || incomingMilkBox;
  const incomingFoamBox = incomingDrink?.foam && incomingTopBox ? getFoamBoxFor(incomingTopBox) : null;
  const incomingFoamCapBox = incomingFoamBox ? getFoamCapBoxFor(incomingFoamBox) : null;
  const incomingPowderLiquidBox =
    incomingDrink?.powder && incomingTopBox && incomingMilkBox
      ? getPowderLiquidBoxFor(incomingTopBox, incomingMilkBox)
      : null;
  // Same "settle on the foam's own top ellipse if there's foam to catch it,
  // otherwise scatter through the whole liquid column instead" choice as
  // ToppingsStation.js's own powderLandingBox/powderFleckOffsets.
  const powderLandingBox =
    incomingDrink?.powder && incomingDrink?.foam && incomingFoamCapBox ? incomingFoamCapBox : incomingPowderLiquidBox;
  const powderFleckOffsets =
    incomingDrink?.foam && incomingFoamCapBox ? POWDER_FLECK_OFFSETS_ELLIPSE : POWDER_FLECK_OFFSETS_LIQUID;
  const powderFleckPositions =
    incomingDrink?.powder && powderLandingBox ? getFleckPositions(powderLandingBox, powderFleckOffsets) : [];
  // Same "settle on the foam's own top ellipse if there's foam to catch it,
  // otherwise the plain top layer instead" choice as powderLandingBox just
  // above -- see ToppingsStation.js's own leafLandingBox/getLeafBoxFor for
  // the full reasoning (this is that same box, just recomputed here against
  // this screen's own fixed finalDrinkSpot-based boxes instead).
  const leafLandingBox = incomingDrink?.foam && incomingFoamCapBox ? incomingFoamCapBox : incomingTopBox;
  const incomingLeafBox = incomingDrink?.leaf && leafLandingBox ? getLeafBoxFor(leafLandingBox) : null;
  // Same "settle on the foam's own top ellipse if there's foam to catch it"
  // choice as incomingLeafBox above, for the two newer standalone garnishes
  // (see ToppingsStation.js's own chipLandingBox/blossomLandingBox).
  const chipLandingBox = incomingDrink?.foam && incomingFoamCapBox ? incomingFoamCapBox : incomingTopBox;
  const incomingChipBox = incomingDrink?.chip && chipLandingBox ? getChipBoxFor(chipLandingBox) : null;
  const blossomLandingBox = incomingDrink?.foam && incomingFoamCapBox ? incomingFoamCapBox : incomingTopBox;
  const incomingBlossomBox = incomingDrink?.blossom && blossomLandingBox ? getBlossomBoxFor(blossomLandingBox) : null;

  return (
    <div className="final-combination-container" ref={containerRef}>
      <h1 className="sr-only">Serving</h1>

      <div className="final-combination-content">
        <img
          src="./Serving.jpg"
          alt="Serving counter with an empty plate, ready to serve the finished drink"
          className="serving-art"
        />

        {/* Reaction sticker -- one of the three emotion PNGs for whichever
            character placed this order (see REACTION_STICKERS above),
            picked by the round's own overall score tier: angry for a
            failing total, annoyed for a middling one, happy for a good one.
            Purely decorative (aria-hidden, no interaction), propped on the
            counter to the left of the drink -- see .serving-reaction-
            sticker in FinalCombination.css for its own positioning. Doesn't
            mount until showSticker flips true (see that state's own
            comment above) -- appears with a "slam" entrance right after the
            score card's own total pill finishes changing color. */}
        {showSticker && reactionSticker && (
          <img
            src={reactionSticker}
            alt=""
            aria-hidden="true"
            draggable={false}
            // First-order-only walkthrough, first beat ONLY -- see
            // showScoreSpotlight above. Per request the sticker stays clear
            // of the pink tint while the player's first learning to read
            // the score sections, but isn't listed among the things still
            // exempt in the second beat (that one's about the drink/score
            // card/next-order button instead), so this doesn't also check
            // showNextOrderSpotlight the way the drink/score-card classes
            // below do.
            className={`serving-reaction-sticker${showScoreSpotlight ? ' final-spotlight-exempt' : ''}`}
          />
        )}

        {/* The finished drink, carried over from Toppings Station and set
            down on the plate -- purely decorative (aria-hidden, no drag/
            Enter interaction, same treatment ToppingsStation's own
            carried-over cup had before that screen's own drink became
            draggable), just displaying the drink exactly as it was built.
            Reuses MilkSelection.css's .cup-milk-fill/.cup-matcha-fill and
            ToppingsStation.css's .cup-foam-fill/.cup-foam-cap/
            .cup-syrup-fill/.cup-powder-fleck classes directly -- all
            already loaded globally, since App.js imports every screen's
            component (and therefore every screen's CSS) up front
            regardless of which page is actually showing, same reasoning
            ToppingsStation.js itself uses for reusing MilkSelection.css's
            classes. */}
        {incomingDrink && (
          <>
            <img
              src={CUP_TYPES[finalCupType].src}
              alt=""
              aria-hidden="true"
              draggable={false}
              // First-order-only walkthrough, BOTH beats -- see
              // showScoreSpotlight/showNextOrderSpotlight above. The drink
              // and everything in it stays visible/clear of the pink tint
              // the whole walkthrough, not just its own first beat, per
              // request ("except for the cup, it's contents..." is named in
              // both beats' own exemption lists).
              className={`final-drink-cup${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
              style={{
                left: `${finalDrinkSpot.left}%`,
                top: `${finalDrinkSpot.top}%`,
                width: `${finalDrinkSize.width}%`,
                height: `${finalDrinkSize.height}%`,
              }}
            />
            {/* Ice cubes carried over from Toppings Station (which itself
                forwards them straight through from Milk Selection's own
                iceCubes count -- see that station's own beginSendToFinal
                comment) -- same "don't silently drop them" fix, and the
                same getIceCupSlotPos/getIceCubeSize reuse, as that screen's
                own decorative ice-cube block. Purely decorative here, same
                as everything else on this screen -- no drag/Enter
                interaction, nothing left to do with the drink once it's
                served. Rendered before the milk fill below, same paint-
                order reasoning as every other screen's own ice cubes. */}
            {Array.from({ length: incomingDrink.iceCubes ?? 0 }).map((_, index) => {
              const iceCubeSize = getIceCubeSize(finalCupType);
              const iceSlotPos = getIceCupSlotPos(
                index,
                finalDrinkSpot,
                finalDrinkSize,
                CUP_TYPES[finalCupType].bodyFrac,
                CUP_TYPES[finalCupType].iceYOffsetFrac,
                CUP_TYPES[finalCupType].iceSpreadScale,
                iceCubeSize
              );
              return (
                <img
                  key={index}
                  src="./IceCube.png"
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className={`ice-cube placed${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
                  style={{
                    left: `${iceSlotPos.left}%`,
                    top: `${iceSlotPos.top}%`,
                    width: `${iceCubeSize.width}%`,
                    height: `${iceCubeSize.height}%`,
                    pointerEvents: 'none',
                  }}
                />
              );
            })}
            {incomingMilkBox && (
              <div
                className={`cup-milk-fill ${incomingDrink.milk.type}${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
                aria-hidden="true"
                style={{
                  left: `${incomingMilkBox.left}%`,
                  top: `${incomingMilkBox.top}%`,
                  width: `${incomingMilkBox.width}%`,
                  height: `${incomingMilkBox.height}%`,
                }}
              />
            )}
            {incomingMatchaBox && (
              <div
                className={`cup-matcha-fill ${incomingDrink.matcha.grade}${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
                aria-hidden="true"
                style={{
                  left: `${incomingMatchaBox.left}%`,
                  top: `${incomingMatchaBox.top}%`,
                  width: `${incomingMatchaBox.width}%`,
                  height: `${incomingMatchaBox.height}%`,
                }}
              />
            )}
            {incomingDrink.foam && incomingFoamBox && (
              <div
                className={`cup-foam-fill ${incomingDrink.foam.key}${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
                aria-hidden="true"
                style={{
                  left: `${incomingFoamBox.left}%`,
                  top: `${incomingFoamBox.top}%`,
                  width: `${incomingFoamBox.width}%`,
                  height: `${incomingFoamBox.height}%`,
                }}
              />
            )}
            {incomingDrink.foam && incomingFoamCapBox && (
              <div
                className={`cup-foam-cap ${incomingDrink.foam.key}${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
                aria-hidden="true"
                style={{
                  left: `${incomingFoamCapBox.left}%`,
                  top: `${incomingFoamCapBox.top}%`,
                  width: `${incomingFoamCapBox.width}%`,
                  height: `${incomingFoamCapBox.height}%`,
                }}
              />
            )}
            {incomingDrink.syrup && incomingSyrupBox && (
              <div
                className={`cup-syrup-fill ${incomingDrink.syrup.key}${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
                aria-hidden="true"
                style={{
                  left: `${incomingSyrupBox.left}%`,
                  top: `${incomingSyrupBox.top}%`,
                  width: `${incomingSyrupBox.width}%`,
                  height: `${incomingSyrupBox.height}%`,
                }}
              />
            )}
            {incomingDrink.powder &&
              powderFleckPositions.map((pos, index) => (
                <span
                  key={index}
                  className={`cup-powder-fleck ${incomingDrink.powder.key}${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
                  aria-hidden="true"
                  style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                />
              ))}
            {/* Mint-leaf garnish, carried over from ToppingsStation's own
                incomingDrink.leaf flag -- see incomingLeafBox above and
                that screen's own matching render block for the reasoning. */}
            {incomingLeafBox && (
              <img
                src="./MintLeaf.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                className={`cup-leaf-garnish${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
                style={{
                  left: `${incomingLeafBox.left}%`,
                  top: `${incomingLeafBox.top}%`,
                  width: `${incomingLeafBox.width}%`,
                  height: `${incomingLeafBox.height}%`,
                }}
              />
            )}
            {/* Banana chip/cherry blossom garnishes, carried over from
                ToppingsStation's own incomingDrink.chip/blossom flags --
                same shape as the mint-leaf garnish just above. */}
            {incomingChipBox && (
              <img
                src="./BananaChip.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                className={`cup-leaf-garnish${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
                style={{
                  left: `${incomingChipBox.left}%`,
                  top: `${incomingChipBox.top}%`,
                  width: `${incomingChipBox.width}%`,
                  height: `${incomingChipBox.height}%`,
                }}
              />
            )}
            {incomingBlossomBox && (
              <img
                src="./CherryBlossom.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                className={`cup-leaf-garnish${finalSpotlightExempt ? ' final-spotlight-exempt' : ''}`}
                style={{
                  left: `${incomingBlossomBox.left}%`,
                  top: `${incomingBlossomBox.top}%`,
                  width: `${incomingBlossomBox.width}%`,
                  height: `${incomingBlossomBox.height}%`,
                }}
              />
            )}
          </>
        )}

        {/* Replaces the old hardcoded AnnieOrder1.png receipt + per-section
            badge overlay -- see ScoreCard.js's own comment for the
            placeholder this grew out of. Real per-station accuracy now,
            computed as the player actually plays (gameloop/scoring.js) and
            threaded down through App.js the same way incomingDrink is. */}
        <ScoreCard
          customerNumber={customerNumber}
          characterName={CUSTOMER_CHARACTER_NAME[order?.customerCharacter] ?? null}
          orderTakingScore={orderTakingScore}
          matchaScore={matchaScore}
          mixingScore={mixingScore}
          toppingsScore={toppingsScore}
          // First-order-only walkthrough -- see showScoreSpotlight/
          // showNextOrderSpotlight above. onSectionOpen is what actually
          // pivots from the first beat into the second (see
          // hasOpenedScoreSection); exempt/highlight are read by ScoreCard
          // itself to punch its own root through the pink tint (both beats)
          // and flash it white (first beat only) -- see that component's
          // own comment on these two props.
          onSectionOpen={() => setHasOpenedScoreSection(true)}
          exempt={finalSpotlightExempt}
          highlight={showScoreSpotlight}
        />

        {/* Full-screen sparkle burst for a "good" (80+) total -- see the
            showCelebration effect above for exactly when this actually
            mounts. Rendered last (of the screen's own content, before
            ProgressBar) so it paints on top of everything above it, same
            "later in DOM order + no z-index conflicts" reasoning the rest
            of this project already relies on. */}
        {showCelebration && <CelebrationOverlay />}

        {/* First-order-only walkthrough, first beat -- see
            showScoreSpotlight above. Row layout (text then arrow, arrow
            pointing right), same "callout sits to the target's left" shape
            as .topping-order-callout in ToppingsStation.css, pointing at
            the score card beside it. */}
        {showScoreSpotlight && (
          <div className="final-score-callout">
            <p className="final-score-callout-text">use the arrows to navigate through the different score sections</p>
            <svg className="final-score-callout-arrow" viewBox="0 0 40 24" preserveAspectRatio="none" aria-hidden="true">
              <polygon points="38,12 2,2 2,22" />
            </svg>
          </div>
        )}

        {/* First-order-only walkthrough, second beat -- see
            showNextOrderSpotlight above. Column layout (text above, arrow
            below pointing down), same shape as .topping-send-callout in
            ToppingsStation.css, pointing down at the start-next-order
            button beneath it. */}
        {showNextOrderSpotlight && (
          <div className="final-next-callout">
            <p className="final-next-callout-text">select the button to move to the next order</p>
            <svg className="final-next-callout-arrow" viewBox="0 0 24 40" preserveAspectRatio="none" aria-hidden="true">
              <polygon points="12,38 22,4 2,4" />
            </svg>
          </div>
        )}

        <ProgressBar
          activeStep={activeStep}
          customerNumber={customerNumber}
          onNavigate={onNavigate}
          onAdvance={onAdvance}
          disableAdvance={hasNextOrder}
          suppressInitialFocus={showScoreSpotlight}
        />

        {/* Starting the next order used to happen via this same
            ProgressBar (Right-arrow or clicking the current/Serve dot,
            same "I'm done here" gesture every other station's own advance
            uses) -- per request, that's now this dedicated button instead
            (disableAdvance above turns the bar's own version of it off
            while this is showing), since jumping into a whole new round
            through the exact same widget the player was just blocked from
            stepping backward through read as confusing. onAdvance itself
            is unchanged -- App.js's handleAdvance already does everything
            needed (resets the order/bowl/drink state, bumps
            customerNumber, sends the player back to 'ordering'); this
            button just calls the very same handler from a clearer,
            explicit spot instead of through the bar. Only rendered when
            there's actually a next order (hasNextOrder) -- the final
            (3rd) order's own completion still returns to the main menu
            via the bar as before. */}
        {hasNextOrder && (
          <button
            type="button"
            // First-order-only walkthrough, second beat ONLY -- see
            // showNextOrderSpotlight above. Exempt punches the button
            // through the pink tint, -highlight gives it the same static
            // white glow every other station's own one-off item/button
            // highlight uses (not the flashing treatment reserved for the
            // three minigame gauges + this screen's own score card).
            className={`start-next-order-button${
              showNextOrderSpotlight ? ' final-spotlight-exempt start-next-order-button-highlight' : ''
            }`}
            data-focusable
            tabIndex={0}
            // Disabled until the score/sticker reveal has actually finished
            // (dwellElapsed) AND, once that request goes out, until the host
            // resolves it (adGate) -- see both props/state's own comments
            // above. useFlatFocusNav already filters [data-focusable] on
            // !el.disabled, so this also removes the button from D-pad focus
            // (not just click) for the duration, same as MainPage's Play
            // button.
            disabled={!dwellElapsed || adGate}
            onClick={() => {
              playButtonClick();
              onStartNextOrder();
            }}
          >
            start order {customerNumber + 1}
          </button>
        )}

        {/* Shared pink tint for both walkthrough beats above -- rendered
            LAST (after ProgressBar and the start-next-order-button) so it
            paints on top of everything else in DOM order, same z-index-tie
            fix every other station's own -spotlight-overlay already
            documents (see e.g. .topping-spotlight-overlay's own comment in
            ToppingsStation.js). The settings gear needs no exemption of its
            own -- SettingsPanel is rendered once, globally, in App.js's own
            .page-container at z-index: 50, already above this overlay's
            z-index: 25 on every screen including this one. */}
        {(showScoreSpotlight || showNextOrderSpotlight) && <div className="final-spotlight-overlay" aria-hidden="true" />}
      </div>
    </div>
  );
};

export default FinalCombination;
