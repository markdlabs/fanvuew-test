import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./rate-limit";

/** A fake clock: `sleep` advances time instead of waiting. */
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

describe("createRateLimiter", () => {
  it("lets the first `perMinute` calls through without waiting", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ perMinute: 3, ...clock });

    for (let i = 0; i < 3; i++) await limiter.acquire();

    expect(clock.sleeps).toEqual([]);
  });

  it("makes the next call wait until the oldest one leaves the 60 s window", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ perMinute: 3, ...clock });

    for (let i = 0; i < 4; i++) await limiter.acquire();

    expect(clock.sleeps).toEqual([60_000]);
    expect(clock.now()).toBe(60_000);
  });

  it("never allows more than `perMinute` calls in any 60 s window", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ perMinute: 200, ...clock });
    const starts: number[] = [];

    for (let i = 0; i < 2_056; i++) {
      await limiter.acquire();
      starts.push(clock.now());
    }

    for (let i = 200; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 200]!).toBeGreaterThanOrEqual(60_000);
    }
    // 41 list + 2,015 detail calls at 200/min: just over ten minutes, as the README says.
    expect(clock.now()).toBe(10 * 60_000);
  });

  it("rejects a non-positive limit", () => {
    expect(() => createRateLimiter({ perMinute: 0 })).toThrow();
  });
});
