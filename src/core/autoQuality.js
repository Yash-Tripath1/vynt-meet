// Lightweight, opt-out frame-rate guard.
//
// The filter loop is CPU-bound, and weak laptops can dip below a smooth 30 fps on the
// heavier filters. Rather than let a call degrade, we nudge pixelation up (which shrinks
// the working canvas and is the single biggest cost lever) when the measured frame rate
// stays low. We only ever *increase* pixelation and never auto-reduce it: dropping back
// down when the load is transient would cause visible flapping mid-call, and a slightly
// softer image is always preferable to a stuttering one.
//
// Kept as a pure function so the decision rule is unit-testable in isolation.

export const AUTO_QUALITY = {
  // Below this sustained fps we step pixelation up.
  lowFps: 22,
  // Hard cap on how many pixelation steps we may add on top of the user's choice.
  maxBoost: 4,
}

/**
 * @param {{fps:number, currentBoost:number}} args
 * @returns {number} the next boost (0..maxBoost)
 */
export function decideBoost({ fps, currentBoost }) {
  const boost = Number.isFinite(currentBoost) ? currentBoost : 0
  if (!Number.isFinite(fps)) return boost
  if (fps < AUTO_QUALITY.lowFps && boost < AUTO_QUALITY.maxBoost) return boost + 1
  return boost
}
