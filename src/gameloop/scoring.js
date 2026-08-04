// Shared scoring helpers for the four graded categories shown on
// FinalCombination's score card (see ScoreCard.js): Order Taking, Matcha
// Making, Mixing Drink, and Toppings. Each scorer below is called from
// whichever station the underlying data actually lives on (CustomerOrdering,
// MatchaMaking, MilkSelection, ToppingsStation respectively), at the exact
// moment that station hands its work off to the next one -- see each file's
// own placeOrder/beginBowlCarry/beginSendDrink/beginSendToFinal -- since
// every station fully unmounts once left behind (App.js only ever renders
// one page-slide's component at a time), so that handoff is the last moment
// any of a station's transient minigame state (tempFillPercent,
// scoopFillPercent, spill count, etc.) still exists to read. The result
// travels the same way
// the carried-over bowl/drink objects already do: lifted up to App.js via a
// new onScored-style prop, stored in state there, and threaded down to
// FinalCombination once the round finishes.
//
// Every category score has the same { percent, checks } shape -- percent is
// the average, across that category's own checks, of each check's own
// credit (equal weight per check, the same "every section counts the same"
// simplification the old placeholder SCORE_SECTIONS in FinalCombination.js
// used before this file replaced it) -- and checks is a list of { key,
// label, correct, detail, credit? } for the score card's own per-category
// expand/collapse view. Most checks are plain all-or-nothing (credit is
// omitted, and pct() below just reads 1/0 off `correct` instead) -- the two
// exceptions today are Matcha Making's own teaspoons and water-temperature
// checks (see scoreMatchaMaking), both graduated 0-1 credit instead, since
// "how close were you" is a real, continuous thing on those two minigames'
// gauges rather than a simple hit-or-miss.
//
// Two known, deliberate gaps, both because the underlying station simply
// doesn't have the mechanic yet (not something this scoring layer can fix on
// its own -- see the user-facing note wherever these come up):
//   - CustomerOrdering's order form can ask for a 'mug' cup (CUP_OPTIONS),
//     but Milk Selection's own CUP_TYPES only ever implements 'glass' and
//     'plastic' -- a mug order can never be matched there. Left as a real
//     (correctly failing) check rather than special-cased away, since it's
//     an honest reflection of what the station can actually do today.
//   - CustomerOrdering's order form can ask for 'mint-leaves' (TOPPING_
//     OPTIONS), but ToppingsStation has no mint-leaves placement mechanic at
//     all (only syrup/foam/powder). scoreToppings below excludes it from the
//     comparison entirely (rather than always failing it) since there's no
//     action the player could ever take to satisfy it -- it's still fully
//     scored, just up in Order Taking, where it's really just a form field.

// ---- Label maps -----------------------------------------------------------
// Small, standalone value->display-name maps, same "own copy per file rather
// than importing another screen's internals for a handful of fixed strings"
// convention CustomerOrdering.js's own TOPPING_SPEECH_NAMES and
// OrderReceiptButton.js's own GRADE_LABELS/CUP_LABELS/BASE_LABELS/
// TOPPING_LABELS already use.
const GRADE_LABEL = { cafe: 'Cafe', classic: 'Classic', ceremonial: 'Ceremonial' };
const CUP_LABEL = { glass: 'Glass', mug: 'Mug', plastic: 'Plastic' };
const BASE_LABEL = {
  dairy: 'Dairy milk',
  oat: 'Oat milk',
  almond: 'Almond milk',
  coconut: 'Coconut water',
  strawberry: 'Strawberry milk',
};
const TOPPING_LABEL = {
  'guava-syrup': 'Guava syrup',
  'mint-syrup': 'Mint syrup',
  'reg-foam': 'Reg cold foam',
  'matcha-foam': 'Matcha cold foam',
  'guava-powder': 'Guava powder',
  'matcha-powder': 'Matcha powder',
  'mint-leaves': 'Mint leaves',
};

// selectedTin (MatchaMaking's own tin keys, e.g. 'cafe-grade') -> the plain
// grade value order.matchaGrade/spokenOrder.grade actually use.
const TIN_TO_ORDER_GRADE = { 'cafe-grade': 'cafe', 'classic-grade': 'classic', 'ceremonial-grade': 'ceremonial' };

// ToppingsStation's own foam item keys -> the differently-named values
// CustomerOrdering's TOPPING_OPTIONS uses for the same two flavors (its
// speech/order copy reads better as "regular"/"matcha" foam than this
// screen's own "reg-cold-foam"/"matcha-cold-foam" item keys -- see
// CustomerOrdering.js's own TOPPING_SPEECH_NAMES for that same wording
// choice). banana-foam has no entry -- it isn't one of TOPPING_OPTIONS at
// all yet (added to the counter, not yet to what a customer can ask for), so
// it's left unmapped and therefore never matches anything a player could
// have been asked to add -- see scoreToppings below.
const FOAM_KEY_TO_ORDER = { 'matcha-cold-foam': 'matcha-foam', 'reg-cold-foam': 'reg-foam' };

// Bucket the matcha scoop gauge's continuous 0-100 "how full" reading
// (MatchaMaking's own scoopFillPercent) back down to the discrete teaspoon
// count it was actually measuring against -- the three tick lines it can be
// caught on (SCOOP_BAR_MARKERS in MatchaMaking.js: top/middle/bottom ==
// 8/50/92 as a *top*-percent, which scoopFillPercent already inverts to
// 92/50/8 -- see that file's own stopScoop) correspond 1:1 to TEASPOON_
// OPTIONS' 3/2/1. Picks whichever of the three the caught reading landed
// closest to, same "closest tick wins" reasoning as any other catch-the-
// line minigame.
const SCOOP_BUCKETS = [
  { teaspoons: 1, fill: 8 },
  { teaspoons: 2, fill: 50 },
  { teaspoons: 3, fill: 92 },
];

function nearestScoopTeaspoons(scoopFillPercent) {
  let best = SCOOP_BUCKETS[0];
  let bestDist = Infinity;
  for (const bucket of SCOOP_BUCKETS) {
    const dist = Math.abs(scoopFillPercent - bucket.fill);
    if (dist < bestDist) {
      bestDist = dist;
      best = bucket;
    }
  }
  return best.teaspoons;
}

// ---- Graduated scoop-amount credit ---------------------------------------
// Per request: the teaspoons check shouldn't be all-or-nothing the way the
// rest of this file's checks are -- catching the gauge close to the right
// line should cost only a little, catching it way off should cost (close
// to) everything, scaling smoothly in between rather than jumping straight
// from full credit to zero the moment it's not the literal nearest bucket.
//
// SCOOP_BUCKET_SPACING (42) is the gap between any two adjacent lines (50-8
// == 92-50 -- see SCOOP_BUCKETS above), so "off by a full bucket-spacing"
// means "drifted exactly as far as the *next* tin's own line" -- past that,
// credit floors at 0 rather than going negative.
//
// SCOOP_EXACT_EPSILON is NOT a "close enough" leniency window -- per
// request, only landing exactly on the line earns full credit/reads as
// correct (✓); being even a little off should always cost at least a
// little (see scoopCredit below, which already scales smoothly with
// distance -- that's what keeps a near-miss from losing much). This is
// purely a floating-point fuzz guard: scoopFillPercent is derived from a
// live CSS pixel measurement (window.getComputedStyle(el).top in
// MatchaMaking.js's own stopScoop), so a genuinely dead-on stop could still
// come back as e.g. 49.9999997 rather than a clean 50 -- without this, that
// kind of sub-pixel rounding noise (not the player being off at all) could
// wrongly deny credit for a stop that, on screen, landed exactly on the
// line.
const SCOOP_BUCKET_SPACING = 42;
const SCOOP_EXACT_EPSILON = 0.05;

function scoopFillForTeaspoons(teaspoons) {
  return SCOOP_BUCKETS.find((bucket) => bucket.teaspoons === teaspoons)?.fill ?? null;
}

// 1 right on the ordered line, falling off linearly to 0 by the time the
// caught reading has drifted a full SCOOP_BUCKET_SPACING away in either
// direction (too few scoops or too many both cost the same for the same
// distance -- there's no "safer" side to miss on).
function scoopCredit(distance) {
  return Math.max(0, 1 - distance / SCOOP_BUCKET_SPACING);
}

// ---- Graduated water-temperature credit ------------------------------
// Per request: full credit only for stopping the heater gauge exactly on
// the thin white line MatchaMaking.js's own TEMP_BAR_EXACT_LINE renders in
// the middle of the two green ticks -- anywhere else inside that green
// window is still a good (but not perfect) score, and anywhere outside the
// green window entirely is a pretty bad one. Same own-copy-of-a-few-numbers
// convention SCOOP_BUCKETS above already uses for the scoop gauge's own
// lines (rather than importing MatchaMaking.js's layout constants directly)
// -- TEMP_ZONE_LEFT/RIGHT mirror that file's own TEMP_BAR_TICKS (52, and
// 60.5 + 3.5 == 64), and TEMP_EXACT_LINE mirrors its own TEMP_BAR_EXACT_LINE
// ((52 + 64) / 2 == 58).
//
// TEMP_ZONE_HALF_WIDTH (6) is the distance from the exact line out to
// either edge of the green window. tempCredit below is two straight-line
// segments stitched together at that edge, not one single slope end to
// end, which is what gives the "still pretty good anywhere in the green,
// pretty bad the instant you're outside it" shape asked for instead of a
// single gentle taper the whole way out:
//   - Inside the green window (distance <= TEMP_ZONE_HALF_WIDTH): tapers
//     gently from 1 at the exact line down to TEMP_GREEN_FLOOR_CREDIT right
//     at the window's own edge -- still a good score anywhere in here.
//   - Outside it (distance > TEMP_ZONE_HALF_WIDTH): tapers steeply the rest
//     of the way from that same floor down to 0, reaching 0 once it's
//     drifted a further TEMP_ZONE_HALF_WIDTH past the edge -- a bad score,
//     and a quickly-worsening one, for anything before or after the window.
//
// TEMP_EXACT_EPSILON is the same kind of floating-point fuzz guard
// SCOOP_EXACT_EPSILON is above (tempFillPercent comes from a live CSS
// scaleX() transform read via getCurrentScaleX in MatchaMaking.js's own
// stopBar, so a genuinely dead-on stop could still read back as e.g.
// 57.9999996 rather than a clean 58) -- not a real leniency margin.
const TEMP_ZONE_LEFT = 52;
const TEMP_ZONE_RIGHT = 64;
const TEMP_EXACT_LINE = (TEMP_ZONE_LEFT + TEMP_ZONE_RIGHT) / 2;
const TEMP_ZONE_HALF_WIDTH = (TEMP_ZONE_RIGHT - TEMP_ZONE_LEFT) / 2;
const TEMP_GREEN_FLOOR_CREDIT = 0.75;
const TEMP_EXACT_EPSILON = 0.05;

function tempCredit(distance) {
  if (distance <= TEMP_ZONE_HALF_WIDTH) {
    return 1 - (distance / TEMP_ZONE_HALF_WIDTH) * (1 - TEMP_GREEN_FLOOR_CREDIT);
  }
  const overshoot = distance - TEMP_ZONE_HALF_WIDTH;
  return Math.max(0, TEMP_GREEN_FLOOR_CREDIT * (1 - overshoot / TEMP_ZONE_HALF_WIDTH));
}

// Order-independent, duplicate-count-sensitive set comparison -- two
// toppings lists count as "the same" only if every value appears the same
// number of times in both (a plain `every value in the other list` check
// would let e.g. two guava syrups silently pass as matching a single one).
function sameToppingSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, i) => value === sortedB[i]);
}

function toppingListText(values) {
  const names = (values ?? []).map((v) => TOPPING_LABEL[v] ?? v);
  return names.length > 0 ? names.join(', ') : 'nothing extra';
}

// Every category's percent is the average, across its own checks, of each
// check's own credit -- equal weight per check within a category. Plain
// all-or-nothing checks don't set `credit` at all, so this reads 1 or 0 off
// `correct` for those (same result as before this became credit-aware);
// scoreMatchaMaking's own teaspoons check is the one place that sets a real
// 0-1 `credit` instead (see scoopCredit above).
function pct(checks) {
  if (!checks || checks.length === 0) return 100;
  const totalCredit = checks.reduce(
    (sum, c) => sum + (typeof c.credit === 'number' ? c.credit : c.correct ? 1 : 0),
    0
  );
  return Math.round((totalCredit / checks.length) * 100);
}

// ---- Order Taking -----------------------------------------------------
// Compares the order the player actually built in CustomerOrdering's order
// form (order) against what the customer's speech bubble asked for
// (spokenOrder) -- see generateSpokenOrder/buildSpeechSegments in
// CustomerOrdering.js for where each of these two, independently-rolled
// objects comes from. Called from CustomerOrdering's own placeOrder, the one
// place both objects are ever in scope together.
export function scoreOrderTaking(order, spokenOrder) {
  const checks = [
    {
      key: 'grade',
      label: 'Matcha grade',
      correct: order.matchaGrade === spokenOrder.grade,
      detail: `Customer asked for ${GRADE_LABEL[spokenOrder.grade]}, order says ${GRADE_LABEL[order.matchaGrade]}.`,
    },
    {
      key: 'teaspoons',
      label: 'Matcha amount',
      correct: order.teaspoons === spokenOrder.teaspoons,
      detail: `Customer asked for ${spokenOrder.teaspoons} tsp, order says ${order.teaspoons} tsp.`,
    },
    {
      key: 'cup',
      label: 'Cup type',
      correct: order.cupType === spokenOrder.cup,
      detail: `Customer asked for a ${CUP_LABEL[spokenOrder.cup]} cup, order says ${CUP_LABEL[order.cupType]}.`,
    },
    {
      key: 'ice',
      label: 'Ice count',
      correct: order.iceCubes === spokenOrder.ice,
      detail: `Customer asked for ${spokenOrder.ice} ice, order says ${order.iceCubes} ice.`,
    },
    {
      key: 'base',
      label: 'Milk / base',
      correct: order.baseMilk === spokenOrder.milk,
      detail: `Customer asked for ${BASE_LABEL[spokenOrder.milk]}, order says ${BASE_LABEL[order.baseMilk]}.`,
    },
    {
      key: 'toppings',
      label: 'Toppings',
      correct: sameToppingSet(order.toppings, spokenOrder.toppings),
      detail: `Customer asked for: ${toppingListText(spokenOrder.toppings)}. Order has: ${toppingListText(
        order.toppings
      )}.`,
    },
  ];
  return { percent: pct(checks), checks };
}

// ---- Matcha Making ------------------------------------------------------
// Grades the four beats of MatchaMaking's own sequence -- tin (grade)
// picked, teaspoon amount caught on the scoop gauge, water temperature
// caught on the heater gauge, and whisking without spilling -- against the
// placed order. Called from MatchaMaking's own beginBowlCarry, right as the
// finished bowl is handed off to Milk Selection.
//   selectedTin: MatchaMaking's own selectedTin state ('cafe-grade' | ...).
//   scoopFillPercent: MatchaMaking's own scoopFillPercent state (0-100).
//   tempFillPercent: MatchaMaking's own tempFillPercent state (0-100, same
//     percent-space TEMP_ZONE_LEFT/RIGHT/EXACT_LINE above use) -- how far
//     across the heater gauge the fill actually was the instant the player
//     stopped it, frozen at that reading via getCurrentScaleX in that
//     file's own stopBar.
//   spillCount: MatchaMaking's own messUpCountRef.current -- the raw count
//     of every mess-up during whisking, not spills.length (which caps at
//     however many puddle images exist -- see that ref's own comment).
//   order: the placed order from CustomerOrdering.
export function scoreMatchaMaking({ selectedTin, scoopFillPercent, tempFillPercent, spillCount, order }) {
  const gotGrade = TIN_TO_ORDER_GRADE[selectedTin] ?? null;
  const gotTeaspoons = nearestScoopTeaspoons(scoopFillPercent);
  // Graduated, not all-or-nothing -- see scoopCredit's own comment above.
  // targetFill is null if order.teaspoons is somehow missing (defensive
  // only -- isOrderComplete already requires it before an order can ever be
  // placed), in which case this just floors to 0 credit/max distance rather
  // than throwing.
  const targetFill = scoopFillForTeaspoons(order?.teaspoons);
  const teaspoonDistance = targetFill === null ? Infinity : Math.abs(scoopFillPercent - targetFill);
  const teaspoonCredit = targetFill === null ? 0 : scoopCredit(teaspoonDistance);
  // Exact line only -- see SCOOP_EXACT_EPSILON's own comment above for why
  // this isn't a real leniency margin.
  const teaspoonExact = teaspoonDistance <= SCOOP_EXACT_EPSILON;
  // Graduated the same way, just with tempCredit's own two-segment "still
  // good anywhere in the green, bad outside it" shape instead of
  // scoopCredit's single taper -- see that function's own comment above.
  const tempDistance = Math.abs(tempFillPercent - TEMP_EXACT_LINE);
  const tempCreditValue = tempCredit(tempDistance);
  const tempExact = tempDistance <= TEMP_EXACT_EPSILON;
  const tempInGreenWindow = tempDistance <= TEMP_ZONE_HALF_WIDTH;
  const tempTooHot = tempFillPercent > TEMP_EXACT_LINE;
  const checks = [
    {
      key: 'grade',
      label: 'Matcha grade',
      correct: gotGrade === order?.matchaGrade,
      detail: `Order calls for ${GRADE_LABEL[order?.matchaGrade]}, scooped from the ${GRADE_LABEL[gotGrade] ?? '—'} tin.`,
    },
    {
      key: 'teaspoons',
      label: 'Matcha amount',
      correct: teaspoonExact,
      credit: teaspoonCredit,
      detail: teaspoonExact
        ? `Caught the gauge right on the ${order?.teaspoons} tsp line.`
        : `Order calls for ${order?.teaspoons} tsp -- caught the gauge closer to ${gotTeaspoons} tsp, ${
            scoopFillPercent > targetFill ? 'a bit over' : 'a bit under'
          } (${Math.round(teaspoonCredit * 100)}% credit for how close it was).`,
    },
    {
      key: 'temp',
      label: 'Water temperature',
      correct: tempExact,
      credit: tempCreditValue,
      detail: tempExact
        ? 'Caught the water right on the exact temperature line.'
        : tempInGreenWindow
        ? `Caught it inside the target window, but a touch ${
            tempTooHot ? 'over' : 'under'
          } the exact line (${Math.round(tempCreditValue * 100)}% credit).`
        : `Missed the target window, running too ${tempTooHot ? 'hot' : 'cold'} (${Math.round(
            tempCreditValue * 100
          )}% credit).`,
    },
    {
      key: 'whisk',
      label: 'Whisking',
      correct: spillCount === 0,
      detail:
        spillCount === 0
          ? 'Whisked clean, no spills.'
          : `Spilled ${spillCount} time${spillCount === 1 ? '' : 's'} while whisking.`,
    },
  ];
  return { percent: pct(checks), checks };
}

// ---- Mixing Drink ---------------------------------------------------------
// Grades Milk Selection's own contribution -- cup type, ice count, and
// milk/base -- against the placed order. Called from MilkSelection's own
// beginSendDrink, right as the finished cup is handed off to Toppings.
// Matcha grade isn't re-checked here -- it's already graded once, on the
// Matcha Making station where it was actually chosen (see scoreMatchaMaking
// above); Milk Selection only ever carries that same grade straight through
// (incomingBowl.grade), it doesn't let the player change it.
//   cupType: Milk Selection's own activeCup state ('glass' | 'plastic').
//   iceCubes: Milk Selection's own icePlaced.filter(Boolean).length.
//   milkType: Milk Selection's own cupMilk?.type.
//   order: the placed order from CustomerOrdering.
export function scoreMixingDrink({ cupType, iceCubes, milkType, order }) {
  const checks = [
    {
      key: 'cup',
      label: 'Cup type',
      correct: cupType === order?.cupType,
      detail: `Order calls for a ${CUP_LABEL[order?.cupType]} cup, used ${CUP_LABEL[cupType] ?? '—'}.`,
    },
    {
      key: 'ice',
      label: 'Ice count',
      correct: iceCubes === order?.iceCubes,
      detail: `Order calls for ${order?.iceCubes} ice, used ${iceCubes} ice.`,
    },
    {
      key: 'base',
      label: 'Milk / base',
      correct: milkType === order?.baseMilk,
      detail: `Order calls for ${BASE_LABEL[order?.baseMilk]}, used ${BASE_LABEL[milkType] ?? '—'}.`,
    },
  ];
  return { percent: pct(checks), checks };
}

// ---- Toppings ---------------------------------------------------------
// Grades ToppingsStation's own syrup/foam/powder picks against the placed
// order's toppings list, one check per topping the order actually asks for
// (correct if it was applied) plus one more for any applied topping the
// order never asked for (always incorrect -- an unrequested extra). Called
// from ToppingsStation's own beginSendToFinal, right as the finished drink
// is handed off to Serving.
//
// order.toppings can include 'mint-leaves' (a valid CustomerOrdering.js
// TOPPING_OPTIONS value), but this station has no mint-leaves placement
// mechanic at all yet -- filtered out of `requested` below so this category
// only ever grades toppings the player could actually have added; see this
// file's own top-of-file note.
//   syrupKey: ToppingsStation's own cupSyrup?.key ('guava-syrup' | 'mint-syrup' | null).
//   foamKey: ToppingsStation's own cupFoam?.key ('matcha-cold-foam' | 'reg-cold-foam' | 'banana-foam' | null).
//   powderKey: ToppingsStation's own cupPowder?.key ('guava-powder' | 'matcha-powder' | null).
//   order: the placed order from CustomerOrdering.
export function scoreToppings({ syrupKey, foamKey, powderKey, order }) {
  const applied = [syrupKey, foamKey ? FOAM_KEY_TO_ORDER[foamKey] ?? foamKey : null, powderKey].filter(Boolean);
  const requested = (order?.toppings ?? []).filter((value) => value !== 'mint-leaves');

  const checks = [];
  requested.forEach((value) => {
    const wasApplied = applied.includes(value);
    checks.push({
      key: `wanted-${value}`,
      label: TOPPING_LABEL[value] ?? value,
      correct: wasApplied,
      detail: wasApplied ? 'Added, as requested.' : 'Requested, but never added.',
    });
  });
  applied
    .filter((value) => !requested.includes(value))
    .forEach((value) => {
      checks.push({
        key: `extra-${value}`,
        label: TOPPING_LABEL[value] ?? value,
        correct: false,
        detail: "Added, but the customer didn't ask for this.",
      });
    });
  if (checks.length === 0) {
    checks.push({
      key: 'none',
      label: 'Toppings',
      correct: true,
      detail: 'No toppings requested, none added.',
    });
  }
  return { percent: pct(checks), checks };
}
