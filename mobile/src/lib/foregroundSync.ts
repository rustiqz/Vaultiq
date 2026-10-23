/**
 * Keeps this device current while the app is open and in front.
 *
 * Nothing here runs in the background: Android can end this process at any
 * moment, a push service would put a third party in the loop, and the vault
 * is only unlocked while the app is up anyway. So the app catches up when it
 * comes back to the foreground, and every few minutes while it stays there.
 *
 * Everything the environment provides (the clock, the timers, whether the app
 * is in front) is passed in, which is what lets this be tested without a device.
 */

export type ForegroundSyncOptions = {
  /** Pulls anything new. Resolves true when something arrived. */
  catchUp: () => Promise<boolean>;
  /** Called after a catch-up that brought something in. */
  announce: () => void;
  /** Whether the app is in the foreground right now. */
  isActive: () => boolean;
  /** Calls `onActive` each time the app returns to the foreground. Returns how to stop. */
  subscribeActive: (onActive: () => void) => () => void;
  /** How often to look while the app stays in front. */
  intervalMs?: number;
  /** The least time between two lookups, however they were triggered. */
  minGapMs?: number;
  now?: () => number;
};

export const DEFAULT_INTERVAL_MS = 5 * 60_000;
export const DEFAULT_MIN_GAP_MS = 30_000;

/** Starts watching. Returns the function that stops it. */
export function startForegroundSync(options: ForegroundSyncOptions): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS;
  const now = options.now ?? Date.now;

  let stopped = false;
  let running = false;
  let lastStart = Number.NEGATIVE_INFINITY;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    // Measured from when a lookup started, not finished: one that keeps failing
    // must not be retried in a tight loop.
    if (now() - lastStart < minGapMs) return;

    running = true;
    lastStart = now();
    try {
      const arrived = await options.catchUp();
      if (arrived && !stopped) options.announce();
    } catch {
      // Offline, or the server is down. The next lookup tries again; nothing
      // here is worth interrupting someone for.
    } finally {
      running = false;
    }
  };

  // `tick` handles its own failures and never rejects, so there is nothing to await.
  const unsubscribe = options.subscribeActive(() => {
    tick();
  });
  const timer = setInterval(() => {
    if (options.isActive()) tick();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
  };
}
