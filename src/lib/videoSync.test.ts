import { describe, expect, it } from "vitest";
import { nextLead, syncPicture, type PictureState, type Playhead } from "./videoSync";

const head = (time: number, playing = true, rate = 1): Playhead => ({ time, playing, rate });
const pic = (time: number, more: Partial<PictureState> = {}): PictureState => ({
  time,
  paused: false,
  seeking: false,
  rate: 1,
  duration: 60,
  settled: Infinity,
  seekingFor: 0,
  nudgedFor: 0,
  ...more,
});

describe("syncPicture", () => {
  it("leaves a picture in step alone", () => {
    expect(syncPicture(head(10), pic(10.02))).toEqual({});
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

  it("catches up by running 10% faster or slower when a little off", () => {
    expect(syncPicture(head(10.1), pic(10)).rate).toBeCloseTo(1.1);
    expect(syncPicture(head(10), pic(10.1)).rate).toBeCloseTo(0.9);
    expect(syncPicture(head(10.1, true, 0.8), pic(10, { rate: 0.8 })).rate).toBeCloseTo(0.88);
    expect(syncPicture(head(10.05), pic(10))).toEqual({});
  });

  it("keeps the same speed until caught up, then goes back: two changes per correction", () => {
    expect(syncPicture(head(10.03), pic(10, { rate: 1.1, nudgedFor: 1 }))).toEqual({});
    expect(syncPicture(head(10.005), pic(10, { rate: 1.1, nudgedFor: 1 }))).toEqual({ rate: 1 });
    expect(syncPicture(head(9.98), pic(10, { rate: 1.1, nudgedFor: 1 }))).toEqual({ rate: 1 });
    expect(syncPicture(head(9.97), pic(10, { rate: 0.9, nudgedFor: 1 }))).toEqual({});
    expect(syncPicture(head(10), pic(10, { rate: 0.9, nudgedFor: 1 }))).toEqual({ rate: 1 });
  });

  it("jumps when catching up hasn't worked", () => {
    const act = syncPicture(head(10.2), pic(10, { rate: 1.1, nudgedFor: 3.5 }), 0.1);
    expect(act.seek).toBeCloseTo(10.3);
    expect(act.rate).toBe(1);
  });

  it("lets a picture that just jumped settle instead of jumping again", () => {
    expect(syncPicture(head(10.6), pic(10, { settled: 0.3 })).rate).toBeCloseTo(1.1);
    expect(syncPicture(head(10.6), pic(10, { settled: 1.5 })).seek).toBeCloseTo(10.6);
  });

  it("jumps at once when the sound itself moved: a loop going back, a seek ahead", () => {
    expect(syncPicture(head(4.1), pic(9.6, { settled: 0.2 }))).toEqual({ seek: 4.1 });
    expect(syncPicture(head(15), pic(10, { settled: 0.2 }))).toEqual({ seek: 15 });
  });

  it("goes back to the sound's speed once in step, and follows it", () => {
    expect(syncPicture(head(10), pic(10, { rate: 1.05 }))).toEqual({ rate: 1 });
    expect(syncPicture(head(10, true, 0.75), pic(10))).toEqual({ rate: 0.75 });
  });

  it("asks nothing of a picture mid-jump but to play or pause", () => {
    expect(syncPicture(head(30), pic(10, { seeking: true, rate: 1.1, seekingFor: 0.5 }))).toEqual({});
    expect(syncPicture(head(30), pic(10, { seeking: true, paused: true }))).toEqual({ play: true });
  });

  it("asks again for a jump that hasn't landed", () => {
    expect(syncPicture(head(30), pic(10, { seeking: true, seekingFor: 2.5 }), 0.2)).toEqual({ seek: 30.2 });
  });

  it("drops a speed-up when the sound's speed changes", () => {
    expect(syncPicture(head(10, true, 0.75), pic(10, { rate: 1.1, nudgedFor: 1 }))).toEqual({ rate: 0.75 });
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
  it("follows how long jumps take, within bounds", () => {
    expect(nextLead(0.15, 0.15)).toBeCloseTo(0.15);
    expect(nextLead(0.15, 0.4)).toBeCloseTo(0.25);
    expect(nextLead(0.1, 0)).toBe(0.06);
    expect(nextLead(0.6, 3)).toBe(0.6);
  });
});
