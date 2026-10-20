// Pump and grab policy for the capture loop -- pure functions so the interesting
// decisions are unit-testable without a DOM.
//
// Why this exists: the render loop used to be clocked only by requestVideoFrameCallback
// (or requestAnimationFrame). Both stop firing when the tab is hidden, so requestFrame()
// was never called and the track we hand Meet froze on its last frame the moment the user
// switched tabs. A Worker's timers are exempt from that throttling, so the filter worker
// doubles as the clock: it posts 'tick' messages and the main thread pumps from a tick
// whenever the render chain has gone silent.
//
// The same literature that surfaced the clock bug also documents engines that stop
// advancing a *hidden* <video> element. Grabbing straight from the MediaStreamTrack
// (ImageCapture) is visibility-independent, so the pipeline can fall back to it while the
// element looks stuck and return when it recovers.

/** A tick only pumps after the render chain misses this many frame periods. */
export const TICK_SLACK = 2

/** How long the element clock may sit still before it counts as stuck. */
export const STALL_MS = 500

/**
 * True when the regular (rVFC/rAF) chain has stalled and a worker tick should draw.
 * @param {{now:number, lastDrawTime:number, interval:number}} args
 */
export function shouldPumpFromTick({ now, lastDrawTime, interval }) {
  if (!(interval > 0)) return true
  if (!Number.isFinite(now) || !Number.isFinite(lastDrawTime)) return true
  return now - lastDrawTime >= interval * TICK_SLACK
}

/**
 * Frame source state machine. 'element' is the normal path (cheap, crop-aware);
 * 'track' grabs from the camera track directly and always works in the background.
 * @param {{mode:'element'|'track', elementStalled:boolean}} args
 * @returns {'element'|'track'}
 */
export function nextGrabMode({ mode, elementStalled }) {
  return elementStalled ? 'track' : 'element'
}

/**
 * Accumulates video.currentTime samples and reports whether the element clock looks
 * stuck. A slow camera legitimately repeats its reading across a couple of grabs, so
 * "stuck" is time-based: the same reading held for STALL_MS milliseconds.
 * @param {{lastTime:number|null, since:number}} state mutable bookkeeping
 * @param {number} time the element's currentTime right now
 * @param {number} now timestamp of this sample
 */
export function noteElementTime(state, time, now) {
  if (state.lastTime === null || time !== state.lastTime) {
    state.lastTime = time
    state.since = now
    return false
  }
  return now - state.since >= STALL_MS
}
