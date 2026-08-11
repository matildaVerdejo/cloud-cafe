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
// omitted, and pct() below just reads 1/0 off `correct` instead) -- the
// exceptions today are Matcha Making's own teaspoons and water-temperature
// checks (see scoreMatchaMaking) and Mixing Drink's own milk-pour-amount
// check (see scoreMixingDrink), all three graduated 0-1 credit instead,
// since "how close were you" is a real, continuous thing on each of those
// gauges rather than a simple hit-or-miss.
//
// No known gaps left of the "order form can ask for something the station
// can't actually produce" shape this section used to document -- CUP_OPTIONS'
// 'mug' used to be one (Milk Selection's own CUP_TYPES only implemented
// 'glass'/'plastic'), and 'mint-leaves' used to be another (ToppingsStation
// had no placement mechanic for it) -- both now have real mechanics (see
// MilkSelection.js's own CUP_TYPES.mug and ToppingsStation.js's own
// mint-leaves pot), so scoreMixingDrink/scoreToppings below grade them for
// real instead of the checks being structurally unwinnable.

// ---- Label maps -----------------------------------------------------------
// Small, standalone value->display-name maps, same "own copy per file rather
// than importing another screen's internals for a handful of fixed strings"
// convention CustomerOrdering.js's own TOPPING_SPEECH_NAMES and
// OrderReceiptButton.js's own GRADE_LABELS/CUP_LABELS/BASE_LABELS/
// TOPPING_LABELS already use.
const GRADE_LABEL = { cafe: 'cafe', classic: 'classic', ceremonial: 'ceremonial', hojicha: 'hojicha' };
const CUP_LABEL = { glass: 'glass', mug: 'mug', plastic: 'plastic' };
const BASE_LABEL = {
  dairy: 'dairy milk',
  oat: 'oat milk',
  almond: 'almond milk',
  coconut: 'coconut water',
  strawberry: 'strawberry milk',
  yuzu: 'sparkling yuzu',
};
const TOPPING_LABEL = {
  'guava-syrup': 'guava syrup',
  'mint-syrup': 'mint syrup',
  'honey-syrup': 'honey syrup',
  'reg-foam': 'reg foam',
  'matcha-foam': 'matcha foam',
  'guava-powder': 'guava powder',
  'matcha-powder': 'matcha powder',
  'mint-leaves': 'mint leaves',
  'banana-foam': 'banana foam',
};

// selectedTin (MatchaMaking's own tin keys, e.g. 'cafe-grade') -> the plain
// grade value order.matchaGrade/spokenOrder.grade actually use.
const TIN_TO_ORDER_GRADE = {
  'cafe-grade': 'cafe',
  'classic-grade': 'classic',
  'ceremonial-grade': 'ceremonial',
  'hojicha-grade': 'hojicha',
};

// ToppingsStation's own foam item keys -> the differently-named values
// CustomerOrdering's TOPPING_OPTIONS uses for the same two flavors (its
// speech/order copy reads better as "regular"/"matcha" foam than this
// screen's own "reg-cold-foam"/"matcha-cold-foam" item keys -- see
// CustomerOrdering.js's own TOPPING_SPEECH_NAMES for that same wording
// choice). banana-foam has no entry here -- unlike those two, its
// CustomerOrdering.js TOPPING_OPTIONS value reuses ToppingsStation's own
// item key verbatim ('banana-foam' on both sides, same as honey-syrup/
// mint-leaves), so the `?? foamKey` fallback in scoreToppings below already
// matches it correctly with no mapping needed.
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

// ---- Overall score / tier --------------------------------------------
// Shared by ScoreCard.js (its own total pill) and FinalCombination.js (to
// know whether to show the celebration overlay) so both always agree on the
// exact same number/tier instead of each recomputing its own copy of this
// average and risking drift between them. Plain average of whichever of the
// four category scores are actually present yet (same "don't assume every
// one is non-null" defensiveness as ScoreCard.js's own original version of
// this), tier-bucketed into common letter-grade-ish cutoffs since nothing
// in this project defines an official passing threshold: fail (<60), mid
// (60-79), good (80+). null total (nothing scored yet) gets a null tier.
export function computeOverallScore({ orderTakingScore, matchaScore, mixingScore, toppingsScore }) {
  const percents = [orderTakingScore, matchaScore, mixingScore, toppingsScore]
    .map((s) => s?.percent)
    .filter((p) => typeof p === 'number');
  if (percents.length === 0) return { total: null, tier: null };
  const total = Math.round(percents.reduce((sum, p) => sum + p, 0) / percents.length);
  const tier = total < 60 ? 'fail' : total < 80 ? 'mid' : 'good';
  return { total, tier };
}

// ---- Order Taking -----------------------------------------------------
// Compares the order the player actually built in CustomerOrdering's order
// form (order) against what the customer's speech bubble asked for
// (spokenOrder) -- see generateSpokenOrder/buildSpeechSegments in
// CustomerOrdering.js for where each of these two, independently-rolled
// objects comes from. Called from CustomerOrdering's own placeOrder, the one
// place both objects are ever in scope together.
export function scoreOrderTaking(order, spokenOrder) {
  // detail strings are only ever shown for incorrect checks now -- ScoreCard
  // itself hides the detail sentence for anything correct (just the label +
  // green check, no explanation needed for a right answer -- see
  // ScoreCard.js). Order Taking's own checks are specifically about what got
  // written into the order form, so these read as "wrote down X instead of
  // Y" (X = what the order form actually has, Y = what the customer's
  // spokenOrder actually asked for) rather than the more generic "wanted/
  // got" phrasing the other three categories' checks use (those are about
  // physical station actions, not a written-down order field).
  const checks = [
    {
      key: 'grade',
      label: 'matcha grade',
      correct: order.matchaGrade === spokenOrder.grade,
      detail: `wrote down ${GRADE_LABEL[order.matchaGrade]} instead of ${GRADE_LABEL[spokenOrder.grade]}.`,
    },
    {
      key: 'teaspoons',
      label: 'matcha amount',
      correct: order.teaspoons === spokenOrder.teaspoons,
      detail: `wrote down ${order.teaspoons} tsp instead of ${spokenOrder.teaspoons} tsp.`,
    },
    {
      key: 'cup',
      label: 'cup type',
      correct: order.cupType === spokenOrder.cup,
      detail: `wrote down ${CUP_LABEL[order.cupType]} instead of ${CUP_LABEL[spokenOrder.cup]}.`,
    },
    {
      key: 'ice',
      label: 'ice count',
      correct: order.iceCubes === spokenOrder.ice,
      detail: `wrote down ${order.iceCubes} ice instead of ${spokenOrder.ice}.`,
    },
    {
      key: 'base',
      label: 'milk / base',
      correct: order.baseMilk === spokenOrder.milk,
      detail: `wrote down ${BASE_LABEL[order.baseMilk]} instead of ${BASE_LABEL[spokenOrder.milk]}.`,
    },
    {
      key: 'toppings',
      label: 'toppings',
      correct: sameToppingSet(order.toppings, spokenOrder.toppings),
      detail: `wrote down ${toppingListText(order.toppings)} instead of ${toppingListText(spokenOrder.toppings)}.`,
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
      label: 'matcha grade',
      correct: gotGrade === order?.matchaGrade,
      detail: `wanted ${GRADE_LABEL[order?.matchaGrade]}, used ${GRADE_LABEL[gotGrade] ?? '—'}.`,
    },
    {
      key: 'teaspoons',
      label: 'matcha amount',
      correct: teaspoonExact,
      credit: teaspoonCredit,
      // Only ever shown when not exact -- see the ScoreCard.js comment on
      // why correct checks skip their own detail sentence entirely now.
      detail: `wanted ${order?.teaspoons} tsp, landed near ${gotTeaspoons} tsp.`,
    },
    {
      key: 'temp',
      label: 'water temperature',
      correct: tempExact,
      credit: tempCreditValue,
      detail: tempInGreenWindow ? `a touch too ${tempTooHot ? 'hot' : 'cold'}.` : `too ${tempTooHot ? 'hot' : 'cold'}.`,
    },
    {
      key: 'whisk',
      label: 'whisking',
      correct: spillCount === 0,
      detail: `spilled ${spillCount}x while whisking.`,
    },
  ];
  return { percent: pct(checks), checks };
}

// ---- Graduated milk-pour credit -------------------------------------------
// Per request: the new hold-to-fill milk pour gauge (MilkSelection.js's own
// MILK_FILL_DURATION_MS/milkPourZoneFor) shouldn't be all-or-nothing either
// -- releasing right in the middle of the yellow band is full credit,
// releasing further off (into green/underfilled or red/overfilled) costs
// progressively more, same graduated shape as tempCredit above rather than a
// flat pass/fail. MILK_ZONE_GREEN_END/MILK_ZONE_RED_START are this file's own
// small copy of MilkSelection.js's identically-named constants -- same "own
// copy rather than importing a sibling screen's layout constants" convention
// TEMP_ZONE_LEFT/RIGHT above already documents. They're derived off
// MilkSelection.js's own MILK_GAUGE_SECTIONS (7) the same way that file
// derives them, rather than copied as bare numbers, so this stays in sync
// with wherever the bar's actual 4th (yellow) section boundary sits instead
// of drifting if that ever changes. MILK_EXACT_LINE/MILK_ZONE_HALF_WIDTH are
// derived from them the same way TEMP_EXACT_LINE/TEMP_ZONE_HALF_WIDTH are
// derived from TEMP_ZONE_LEFT/RIGHT.
const MILK_GAUGE_SECTIONS = 7;
const MILK_ZONE_GREEN_END = (100 / MILK_GAUGE_SECTIONS) * 3;
const MILK_ZONE_RED_START = (100 / MILK_GAUGE_SECTIONS) * 4;
const MILK_EXACT_LINE = (MILK_ZONE_GREEN_END + MILK_ZONE_RED_START) / 2;
const MILK_ZONE_HALF_WIDTH = (MILK_ZONE_RED_START - MILK_ZONE_GREEN_END) / 2;
const MILK_GREEN_FLOOR_CREDIT = 0.75;
// Wider fuzz guard than SCOOP_EXACT_EPSILON/TEMP_EXACT_EPSILON above -- this
// reading comes from a requestAnimationFrame loop timing a held key against
// MILK_FILL_DURATION_MS (see pal.js's heldDurationMs), not a live CSS pixel/
// transform measurement, so it's noisier frame-to-frame than either of those
// two gauges' own readings; a dead-on release could still land a percentage
// point or so off the mathematical center.
const MILK_EXACT_EPSILON = 1;

function milkPourCredit(distance) {
  if (distance <= MILK_ZONE_HALF_WIDTH) {
    return 1 - (distance / MILK_ZONE_HALF_WIDTH) * (1 - MILK_GREEN_FLOOR_CREDIT);
  }
  const overshoot = distance - MILK_ZONE_HALF_WIDTH;
  return Math.max(0, MILK_GREEN_FLOOR_CREDIT * (1 - overshoot / MILK_ZONE_HALF_WIDTH));
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
//   milkFillPercent: Milk Selection's own milkFillPercent state (0-100, same
//     percent-space MILK_ZONE_GREEN_END/RED_START above use) -- wherever the
//     pour gauge's needle landed the instant the player released it, frozen
//     the same "rAF loop just stops updating it" way MatchaMaking's own
//     tempFillPercent freezes on stopBar. null when no milk was ever poured
//     (cupMilk itself never got set), in which case the check below just
//     reads as "no reading" rather than crediting/blaming a specific side.
//   order: the placed order from CustomerOrdering.
export function scoreMixingDrink({ cupType, iceCubes, milkType, milkFillPercent, order }) {
  // Graduated the same way scoreMatchaMaking's own teaspoons/temperature
  // checks are -- see milkPourCredit's own comment above.
  const milkPourDistance = typeof milkFillPercent === 'number' ? Math.abs(milkFillPercent - MILK_EXACT_LINE) : null;
  const milkPourCreditValue = milkPourDistance === null ? 0 : milkPourCredit(milkPourDistance);
  const milkPourExact = milkPourDistance !== null && milkPourDistance <= MILK_EXACT_EPSILON;
  const milkPourInBand = milkPourDistance !== null && milkPourDistance <= MILK_ZONE_HALF_WIDTH;
  const milkPourTooMuch = typeof milkFillPercent === 'number' && milkFillPercent > MILK_EXACT_LINE;
  const checks = [
    {
      key: 'cup',
      label: 'cup type',
      correct: cupType === order?.cupType,
      detail: `wanted ${CUP_LABEL[order?.cupType]}, used ${CUP_LABEL[cupType] ?? '—'}.`,
    },
    {
      key: 'ice',
      label: 'ice count',
      correct: iceCubes === order?.iceCubes,
      detail: `wanted ${order?.iceCubes} ice, used ${iceCubes}.`,
    },
    {
      key: 'base',
      label: 'milk / base',
      correct: milkType === order?.baseMilk,
      detail: `wanted ${BASE_LABEL[order?.baseMilk]}, used ${BASE_LABEL[milkType] ?? '—'}.`,
    },
    {
      key: 'milk-pour',
      label: 'milk pour amount',
      correct: milkPourExact,
      credit: milkPourCreditValue,
      detail:
        milkPourDistance === null
          ? 'no milk was poured.'
          : milkPourInBand
          ? `a touch ${milkPourTooMuch ? 'over' : 'under'}filled.`
          : `${milkPourTooMuch ? 'overfilled and spilled' : 'underfilled'}.`,
    },
  ];
  return { percent: pct(checks), checks };
}

// ---- Graduated topping-placement credit ------------------------------
// Per request: the new foam/powder/mint-leaves aim-lever minigame
// (ToppingsStation.js's own leverStage/LEVER_CENTER_TOLERANCE) shouldn't be
// all-or-nothing either -- catching the marker right on the middle is full
// credit, catching it further off (however far it drifted before the
// player pressed Enter) costs progressively more, same two-segment
// "still good near the middle, bad the further out you go" shape as
// tempCredit/milkPourCredit above. LEVER_CENTER_TOLERANCE is this file's
// own copy of ToppingsStation.js's identically-named/-valued constant (same
// "own copy rather than importing a sibling screen's layout constants"
// convention every other graduated check in this file already follows).
//
// Unlike tempFillPercent/milkFillPercent (raw 0-100 gauge readings this
// file re-derives its own distance-from-center math for), the caller here
// passes an already-normalized distance -- *PlacementFrac below, -1..1,
// where 0 is dead center and +/-1 is the full swing to either edge of the
// lever's own travel (see ToppingsStation.js's own offsetFrac, computed off
// leverPositionRef at the instant of the catch) -- so leverCredit only ever
// needs the single 0-1 |distance| shape, not a second copy of the lever's
// own amplitude/move-range numbers.
const LEVER_CENTER_TOLERANCE = 0.12;
const LEVER_GREEN_FLOOR_CREDIT = 0.75;

function leverCredit(distanceFrac) {
  if (distanceFrac <= LEVER_CENTER_TOLERANCE) {
    return 1 - (distanceFrac / LEVER_CENTER_TOLERANCE) * (1 - LEVER_GREEN_FLOOR_CREDIT);
  }
  const overshoot = distanceFrac - LEVER_CENTER_TOLERANCE;
  const span = 1 - LEVER_CENTER_TOLERANCE;
  return Math.max(0, LEVER_GREEN_FLOOR_CREDIT * (1 - overshoot / span));
}

// ---- Toppings ---------------------------------------------------------
// Grades ToppingsStation's own syrup/foam/powder/mint-leaves picks against
// the placed order's toppings list, one check per topping the order
// actually asks for (correct if it was applied) plus one more for any
// applied topping the order never asked for (always incorrect -- an
// unrequested extra). Called from ToppingsStation's own beginSendToFinal,
// right as the finished drink is handed off to Serving.
//   syrupKey: ToppingsStation's own cupSyrup?.key ('guava-syrup' | 'mint-syrup' | 'honey-syrup' | null).
//   foamKey: ToppingsStation's own cupFoam?.key ('matcha-cold-foam' | 'reg-cold-foam' | 'banana-foam' | null).
//   powderKey: ToppingsStation's own cupPowder?.key ('guava-powder' | 'matcha-powder' | null).
//   mintLeavesApplied: ToppingsStation's own cupMintLeaf boolean.
//   syrupSpillCount: ToppingsStation's own syrupMessUpCountRef.current -- the
//     raw count of every mess-up during the syrup pour's own balance
//     minigame (ball drifted out of the green zone), same "raw ref count,
//     not the capped spills array length" reasoning as scoreMatchaMaking's
//     own spillCount. Only actually graded (see the 'syrup-pour' check
//     below) when syrupKey is set -- no syrup poured means nothing to grade
//     here, same as every other check in this file only applying when its
//     own underlying action actually happened.
//   foamPlacementFrac/powderPlacementFrac/leafPlacementFrac: ToppingsStation's
//     own offsetFrac at the instant each topping's aim-lever was caught
//     (-1..1, 0 == dead center -- see leverCredit's own comment above), or
//     null if that topping was never applied. Each only actually graded (see
//     the '*-placement' checks below) when its own topping key/flag is set,
//     same "nothing to grade if it never happened" reasoning as syrupKey/
//     syrupSpillCount above.
//   order: the placed order from CustomerOrdering.
export function scoreToppings({
  syrupKey,
  foamKey,
  powderKey,
  mintLeavesApplied,
  syrupSpillCount,
  foamPlacementFrac,
  powderPlacementFrac,
  leafPlacementFrac,
  order,
}) {
  const applied = [
    syrupKey,
    foamKey ? FOAM_KEY_TO_ORDER[foamKey] ?? foamKey : null,
    powderKey,
    mintLeavesApplied ? 'mint-leaves' : null,
  ].filter(Boolean);
  const requested = order?.toppings ?? [];

  const checks = [];
  requested.forEach((value) => {
    const wasApplied = applied.includes(value);
    checks.push({
      key: `wanted-${value}`,
      label: TOPPING_LABEL[value] ?? value,
      correct: wasApplied,
      detail: 'missing.',
    });
  });
  applied
    .filter((value) => !requested.includes(value))
    .forEach((value) => {
      checks.push({
        key: `extra-${value}`,
        label: TOPPING_LABEL[value] ?? value,
        correct: false,
        detail: 'not requested.',
      });
    });
  // Graded like MatchaMaking's own 'whisk' check (correct only with zero
  // mess-ups) -- but, unlike whisking (which always happens once per
  // round), this only shows up at all if a syrup was actually poured.
  if (syrupKey) {
    checks.push({
      key: 'syrup-pour',
      label: 'syrup pour',
      correct: syrupSpillCount === 0,
      detail: `spilled ${syrupSpillCount}x while pouring.`,
    });
  }
  // Graded like the milk-pour-amount check above (correct only right on the
  // middle, graduated credit tapering off the further the lever was caught
  // from center) -- but, like syrup-pour above, only shows up if that
  // topping was actually applied.
  if (foamKey) {
    const distance = Math.min(1, Math.abs(foamPlacementFrac ?? 1));
    checks.push({
      key: 'foam-placement',
      label: 'foam placement',
      correct: distance <= LEVER_CENTER_TOLERANCE,
      credit: leverCredit(distance),
      detail: distance <= LEVER_CENTER_TOLERANCE ? 'landed clean.' : 'spilled off to the side while placing.',
    });
  }
  if (powderKey) {
    const distance = Math.min(1, Math.abs(powderPlacementFrac ?? 1));
    checks.push({
      key: 'powder-placement',
      label: 'powder placement',
      correct: distance <= LEVER_CENTER_TOLERANCE,
      credit: leverCredit(distance),
      detail: distance <= LEVER_CENTER_TOLERANCE ? 'landed clean.' : 'spilled off to the side while placing.',
    });
  }
  if (mintLeavesApplied) {
    const distance = Math.min(1, Math.abs(leafPlacementFrac ?? 1));
    checks.push({
      key: 'leaf-placement',
      label: 'mint leaf placement',
      correct: distance <= LEVER_CENTER_TOLERANCE,
      credit: leverCredit(distance),
      detail: distance <= LEVER_CENTER_TOLERANCE ? 'landed clean.' : 'spilled off to the side while placing.',
    });
  }
  if (checks.length === 0) {
    checks.push({
      key: 'none',
      label: 'toppings',
      correct: true,
      detail: 'no toppings requested, none added.',
    });
  }
  return { percent: pct(checks), checks };
}
