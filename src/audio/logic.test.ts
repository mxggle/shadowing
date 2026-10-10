import { describe, expect, it } from "vitest";
import { clampRate, clampSeekStep, cycleLoop, nextPlayMode, NO_LOOP, nudgeLoop, resumePosition, shouldJumpToA, trackAfter } from "./logic";

describe("loop", () => {
  it("cycles A → B → clear", () => {
    const a = cycleLoop(NO_LOOP, 10);
    expect(a).toEqual({ a: 10, b: null });
    const ab = cycleLoop(a, 14);
    expect(ab).toEqual({ a: 10, b: 14 });
    expect(cycleLoop(ab, 20)).toEqual(NO_LOOP);
  });

  it("swaps when B is set before A and ignores too-short loops", () => {
    expect(cycleLoop({ a: 10, b: null }, 6)).toEqual({ a: 6, b: 10 });
    expect(cycleLoop({ a: 10, b: null }, 10.1)).toEqual({ a: 10, b: null });
  });

  it("jumps only when crossing B", () => {
    const loop = { a: 10, b: 14 };
    expect(shouldJumpToA(loop, 13.98, 14.01)).toBe(true);
    expect(shouldJumpToA(loop, 13.5, 13.9)).toBe(false);
    expect(shouldJumpToA(loop, 20, 20.02)).toBe(false); // user sought past B
    expect(shouldJumpToA({ a: 10, b: null }, 13.98, 14.01)).toBe(false);
  });

  it("nudges within bounds", () => {
    const loop = { a: 10, b: 14 };
    expect(nudgeLoop(loop, "a", -0.1, 60).a).toBeCloseTo(9.9);
    expect(nudgeLoop(loop, "a", 10, 60).a).toBeCloseTo(13.7);
    expect(nudgeLoop(loop, "b", 100, 60).b).toBe(60);
  });
});

describe("resume", () => {
  it("rewinds a little, restarts finished tracks", () => {
    expect(resumePosition(undefined)).toBe(0);
    expect(resumePosition({ position: 30, duration: 100, updatedAt: 0 })).toBe(28);
    expect(resumePosition({ position: 1, duration: 100, updatedAt: 0 })).toBe(0);
    expect(resumePosition({ position: 98.5, duration: 100, updatedAt: 0 })).toBe(0);
  });
});

describe("rate", () => {
  it("clamps and snaps to 0.05", () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(3)).toBe(2);
    expect(clampRate(0.87)).toBeCloseTo(0.85);
  });
});

describe("seek step", () => {
  it("keeps whole seconds within 1–60, falls back to 5 on junk", () => {
    expect(clampSeekStep(3)).toBe(3);
    expect(clampSeekStep(2.4)).toBe(2);
    expect(clampSeekStep(0)).toBe(1);
    expect(clampSeekStep(600)).toBe(60);
    expect(clampSeekStep(NaN)).toBe(5);
  });
});

describe("play mode", () => {
  it("at the end of a track", () => {
    expect(trackAfter("next", 0, 3, 1, true)).toBe(1);
    expect(trackAfter("next", 2, 3, 1, true)).toBeNull();
    expect(trackAfter("list", 2, 3, 1, true)).toBe(0);
    expect(trackAfter("one", 1, 3, 1, true)).toBeNull();
    expect(trackAfter("once", 1, 3, 1, true)).toBeNull();
  });

  it("when skipping by hand", () => {
    expect(trackAfter("one", 1, 3, 1, false)).toBe(2);
    expect(trackAfter("once", 1, 3, -1, false)).toBe(0);
    expect(trackAfter("next", 0, 3, -1, false)).toBeNull();
    expect(trackAfter("list", 0, 3, -1, false)).toBe(2);
    expect(trackAfter("list", 0, 1, 1, true)).toBe(0);
  });

  it("never moves off a clip outside the folder", () => {
    expect(trackAfter("list", -1, 3, 1, true)).toBeNull();
    expect(trackAfter("next", 0, 0, 1, true)).toBeNull();
  });

  it("cycles through every mode", () => {
    expect(nextPlayMode("next")).toBe("list");
    expect(nextPlayMode("list")).toBe("one");
    expect(nextPlayMode("one")).toBe("once");
    expect(nextPlayMode("once")).toBe("next");
  });
});
