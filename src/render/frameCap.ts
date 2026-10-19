// The frame-rate cap.
//
// The desktop shell launches Chromium with vsync OFF and its frame-rate limit OFF
// (electron/main.mjs), because a vsynced page is at least a refresh behind the mouse and the
// DOM overlays that follow the pointer showed it. Off, requestAnimationFrame stops meaning "once
// per refresh" and fires back to back — measured at ~6,300 Hz on an empty WebGL page on the
// dev box — so every loop in the page, ours and the throwaway polls alike, would spin the GPU
// and a CPU core flat out drawing frames nobody can see.
//
// Chromium has no switch for "uncapped, but no faster than N", so the cap is kept HERE, and it is
// kept on requestAnimationFrame itself rather than in each loop: the page has half a dozen rAF
// loops (the match, the menu clock, the loading screen, the model viewers) and several one-off
// polls, and a cap each of them had to remember is a cap the next one forgets. Patched, every
// caller sees an ordinary display that happens to refresh at the cap. Callbacks queued in the
// same interval run together on one real frame with one timestamp, which is exactly what a
// display's refresh does.
//
// TWO OWNERS, and they are different things:
//   • the SHELL's initial number (`ow3native.maxFps`, arming at import), which is ours and
//     comes from an Electron launch switch — a browser tab never has it;
//   • the console's `maxfps <n>` cheat, which is the GAME's (`RegisterMaxFPS`, preference 22
//     `PREF_VIDEO_MAXFPS`) and may change at runtime. `setMaxFps` is that door. Setting it to
//     0 removes the cap (the shell's own uncapped mode), which is what `maxfps 0` meant in the
//     original — the preference is a display limit, and 0 disables it.

let capFps = 0;
let interval = 0;
let installed = false;
/** Re-arm the cadence after the rate changes: `due` lives in the closure below. */
let resetDue: (() => void) | null = null;

/** Install the rAF patch once. Safe to call before or after a cap exists: while `capFps` is
 *  0 the patched rAF is a straight pass-through to the real one. */
function installCap(): void {
  if (installed) return;
  installed = true;

  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);

  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  /** When the next batch may run, on performance.now()'s clock. */
  let due = 0;
  let rafHandle = 0;
  let timer = 0;
  resetDue = () => {
    due = performance.now();
  };

  const run = (t: number): void => {
    rafHandle = 0;
    const now = performance.now();
    // Step the deadline by whole intervals so the average holds at the cap, but never let it
    // fall behind the clock — after a long frame the page gets the next frame promptly, not a
    // burst of catch-up frames.
    if (interval > 0) due = Math.max(due + interval, now);
    const batch = [...queue];
    queue.clear();
    for (const [, cb] of batch) {
      try {
        cb(t);
      } catch (err) {
        // One throwing callback must not swallow the rest of the frame, as it would not in
        // the browser's own rAF either.
        setTimeout(() => {
          throw err;
        });
      }
    }
    if (queue.size) schedule();
  };

  // Every real frame asked for RUNS the batch; the wait before the deadline is a timer, never a
  // real frame that goes unused. That is not tidiness: with the limit off, Chromium follows a
  // frame that drew nothing with a ~16 ms pause before the next (measured on a bare WebGL page),
  // so a cap that polled real frames until one was due held the game at ~110 fps, not 300. A
  // timer armed from a frame callback is not a nested timer, so it is not clamped to 4 ms.
  const schedule = (): void => {
    if (rafHandle || timer) return;
    const wait = interval > 0 ? due - performance.now() : 0;
    if (wait > 0.5) {
      timer = window.setTimeout(() => {
        timer = 0;
        rafHandle = realRaf(run);
      }, wait);
    } else {
      rafHandle = realRaf(run);
    }
  };

  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    if (interval <= 0) return realRaf(cb); // uncapped: no queue, no bookkeeping
    const id = nextId++;
    queue.set(id, cb);
    schedule();
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    if (!queue.delete(id)) {
      realCancel(id);
      return;
    }
    if (queue.size) return;
    if (rafHandle) realCancel(rafHandle);
    if (timer) clearTimeout(timer);
    rafHandle = timer = 0;
  };
}

/** Arm the cap if the desktop shell asked for one. Run as a side-effect import at the very top
 *  of main.ts, so it is in place before any module schedules a frame. */
function installFrameCap(): void {
  const maxFps = (window as unknown as { ow3native?: { maxFps?: number } }).ow3native?.maxFps;
  if (!maxFps || !(maxFps > 0)) return;
  setMaxFps(maxFps);
}

/**
 * `maxfps <n>` — the console's runtime cap (the game's `PREF_VIDEO_MAXFPS`). `n <= 0` removes
 * it, handing rAF back to the display; any positive number caps the page at that rate. The
 * patch stays installed either way.
 */
export function setMaxFps(fps: number): void {
  capFps = Number.isFinite(fps) && fps > 0 ? fps : 0;
  interval = capFps > 0 ? 1000 / capFps : 0;
  installCap();
  // The new cadence starts from now rather than inheriting the old rate's next deadline:
  // going from `maxfps 1` to `maxfps 300` must not wait out the second that was already due.
  resetDue?.();
}

/** The cap currently in force, 0 when uncapped — for the options panel and a test. */
export function currentMaxFps(): number {
  return capFps;
}

installFrameCap();
