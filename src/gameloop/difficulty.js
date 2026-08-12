// Shared per-order difficulty scaling for this game's timed mini-challenges
// (Matcha Making's scoop gauge/heater gauge/whisk balance minigame, Toppings
// Station's syrup pour balance minigame and foam/powder/leaf/chip/blossom
// lever-catch minigame). Per request: order 1 stays exactly as it already
// was tuned (every BASE_* constant in each of those files is untouched), and
// each order after that nudges every minigame's own "speed"/"target area"
// knobs a bit further, so the run gradually gets harder rather than staying
// flat difficulty the whole way through.
//
// getDifficultyStep turns customerNumber (1-indexed, same prop every station
// already receives) into a 0-indexed step count -- 0 on order 1, 1 on order
// 2, and so on -- clamped at MAX_DIFFICULTY_STEPS so nothing runs away past
// whatever the last order in a run actually is (there are 5 today, so the
// clamp never actually engages, but it's a cheap safety net against a future
// longer run making some knob absurd/unplayable).
const MAX_DIFFICULTY_STEPS = 8;

export function getDifficultyStep(customerNumber) {
  const n = Number.isFinite(customerNumber) ? customerNumber : 1;
  return Math.min(Math.max(n - 1, 0), MAX_DIFFICULTY_STEPS);
}

// Scales `base` up by `perStepFrac` for each difficulty step (e.g. 0.15 ==
// +15% per step), capped so it never exceeds `base * maxMultiplier`. Used
// for "the harder this number, the harder the minigame" knobs -- drift
// strength, sweep amplitude, etc.
export function scaleUp(base, step, perStepFrac, maxMultiplier = Infinity) {
  return base * Math.min(1 + perStepFrac * step, maxMultiplier);
}

// Scales `base` down by `perStepFrac` for each difficulty step, floored so
// it never drops below `base * minMultiplier` (keeps a minigame from
// shrinking/speeding up into genuine unplayability at high order counts).
// Used for "the smaller/faster this number, the harder the minigame" knobs
// -- target zone width, animation duration, fill time, etc.
export function scaleDown(base, step, perStepFrac, minMultiplier = 0) {
  return base * Math.max(1 - perStepFrac * step, minMultiplier);
}
