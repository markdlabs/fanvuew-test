/**
 * Sliding-window rate limiter: at most `perMinute` calls in any 60 seconds.
 *
 * The live Fanvue API allows 200 calls a minute (README, "The task"). The mock
 * states that limit but does not enforce it, so the job has to.
 *
 * `now` and `sleep` are injectable so tests can drive a fake clock.
 */

const WINDOW_MS = 60_000;

export type RateLimiter = {
  /** Resolves when one more call fits in the window, and records that call. */
  acquire(): Promise<void>;
};

export type RateLimiterOptions = {
  perMinute: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export function createRateLimiter({
  perMinute,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: RateLimiterOptions): RateLimiter {
  if (!Number.isFinite(perMinute) || perMinute < 1) {
    throw new Error(`perMinute must be a positive number, got ${perMinute}`);
  }

  /** Start times of the calls in the current window, oldest first. */
  const calls: number[] = [];

  return {
    async acquire() {
      for (;;) {
        const t = now();
        while (calls.length > 0 && (calls[0] ?? Infinity) <= t - WINDOW_MS) calls.shift();
        const oldest = calls[0];
        if (oldest === undefined || calls.length < perMinute) {
          calls.push(t);
          return;
        }
        // Wait until the oldest call leaves the window, then check again.
        await sleep(oldest + WINDOW_MS - t);
      }
    },
  };
}
