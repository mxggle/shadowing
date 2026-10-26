import { describe, expect, it } from "vitest";
import { nextLead, soundJumped, syncPicture, type PictureState, type Playhead } from "./videoSync";

const head = (time: number, playing = true, rate = 1): Playhead => ({ time, playing, rate });
const pic = (time: number, more: Partial<PictureState> = {}): PictureState => ({
  time,
  paused: false,
  seeking: false,
  rate: 1,
  duration: 60,
  settled: Infinity,
  seekingFor: 0,
  soundMoved: false,
  ...more,
});

describe("syncPicture", () => {
  it("leaves a picture in step alone", () => {
    expect(syncPicture(head(10), pic(10.05))).toEqual({});
    expect(syncPicture(head(10, false), pic(10.02, { paused: true }))).toEqual({});
  });

  it("starts and stops with the sound", () => {
    expect(syncPicture(head(10), pic(10, { paused: true }))).toEqual({ play: true });
    expect(syncPicture(head(10, false), pic(10))).toEqual({ pause: true });
  });

  it("shows the exact frame while paused", () => {
    expect(syncPicture(head(12, false), pic(10, { paused: true }), 0.2)).toEqual({ seek: 12 });
  });

  it("jumps ahead by the time a jump takes, at the sound's speed", () => {
    expect(syncPicture(head(30), pic(10), 0.2)).toEqual({ seek: 30.2 });
    expect(syncPicture(head(30, true, 0.5), pic(10, { rate: 0.5 }), 0.2)).toEqual({ seek: 30.1 });
  });

  it("corrects only by jumping, never by changing its speed (WebKit stalls)", () => {
    expect(syncPicture(head(10.2), pic(10))).toEqual({ seek: 10.2 });
    expect(syncPicture(head(10), pic(10.2))).toEqual({ seek: 10 });
    expect(syncPicture(head(10.1), pic(10))).toEqual({});
  });

  it("lets a picture that just jumped get going, unless the sound moved", () => {
    expect(syncPicture(head(10.3), pic(10, { settled: 0.4 }))).toEqual({});
    expect(syncPicture(head(4.1), pic(9.6, { settled: 0.2, soundMoved: true }))).toEqual({ seek: 4.1 });
    expect(syncPicture(head(10.3), pic(10, { settled: 1.2 }))).toEqual({ seek: 10.3 });
  });

  it("takes a new speed together with a jump", () => {
    expect(syncPicture(head(10, true, 0.75), pic(10), 0.2)).toEqual({ rate: 0.75, seek: 10.15 });
    expect(syncPicture(head(10, false, 0.75), pic(10, { paused: true }))).toEqual({ rate: 0.75 });
  });

  it("asks nothing of a picture mid-jump but to play or pause", () => {
    expect(syncPicture(head(30), pic(10, { seeking: true, seekingFor: 0.5 }))).toEqual({});
    expect(syncPicture(head(30), pic(10, { seeking: true, paused: true }))).toEqual({ play: true });
  });

  it("asks again for a jump that hasn't landed", () => {
    expect(syncPicture(head(30), pic(10, { seeking: true, seekingFor: 2.5 }), 0.2)).toEqual({ seek: 30.2 });
  });

  it("holds the last frame when the sound runs past the picture", () => {
    expect(syncPicture(head(61), pic(59.95))).toEqual({ pause: true });
    expect(syncPicture(head(61), pic(59.95, { paused: true }))).toEqual({});
    expect(syncPicture(head(70, false), pic(20, { paused: true }))).toEqual({ seek: 59.95 });
    expect(syncPicture(head(59.9), pic(50), 0.5)).toEqual({ seek: 59.95 });
  });

  it("waits for the length before treating any time as past the end", () => {
    expect(syncPicture(head(100), pic(100, { duration: NaN, paused: true }))).toEqual({ play: true });
  });
});

describe("nextLead", () => {
  it("jumps further after landing behind, less after landing ahead, within bounds", () => {
    expect(nextLead(0.15, 0)).toBeCloseTo(0.15);
    expect(nextLead(0.15, 0.1)).toBeCloseTo(0.22);
    expect(nextLead(0.3, -0.19)).toBeCloseTo(0.167);
    expect(nextLead(0.05, -0.5)).toBe(0);
    expect(nextLead(0.5, 3)).toBe(0.6);
  });
});

describe("soundJumped", () => {
  it("tells a seek or a loop going round from playing on", () => {
    expect(soundJumped(head(10), head(10.05), 0.05)).toBe(false);
    expect(soundJumped(head(10, true, 0.75), head(10.0375, true, 0.75), 0.05)).toBe(false);
    expect(soundJumped(head(4.28), head(3.08), 0.05)).toBe(true);
    expect(soundJumped(head(10, false), head(15, false), 0.05)).toBe(true);
    expect(soundJumped(head(10, false), head(10, true), 0.05)).toBe(false);
  });
});
