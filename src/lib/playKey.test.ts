import { describe, expect, it } from "vitest";
import { goingOn, playKey, playKeyTitle, type PlayKeyState } from "./playKey";

const idle: PlayKeyState = { rec: null, live: null, drill: null, playingTake: null, playingReading: null, playing: false, hasTracks: true };
const at = (s: Partial<PlayKeyState>) => playKey({ ...idle, ...s });

describe("playKey", () => {
  it("with nothing else going on, plays / pauses the track as always", () => {
    expect(at({})).toEqual({ target: "track", running: false, enabled: true });
    expect(at({ playing: true })).toEqual({ target: "track", running: true, enabled: true });
    expect(at({ hasTracks: false }).enabled).toBe(false);
  });

  it("recording a take: pauses it, then goes on with it", () => {
    for (const phase of ["listening", "speaking"] as const) {
      expect(at({ rec: { phase, paused: false }, playing: phase === "listening" })).toEqual({ target: "take", running: true, enabled: true });
      expect(at({ rec: { phase, paused: true } })).toEqual({ target: "take", running: false, enabled: true });
    }
  });

  it("opening the mic or saving: nothing to pause just then (still shows it's going)", () => {
    expect(at({ rec: { phase: "starting", paused: false } })).toEqual({ target: "take", running: true, enabled: false });
    expect(at({ rec: { phase: "saving", paused: true } })).toEqual({ target: "take", running: true, enabled: false });
    expect(at({ live: { phase: "saving", paused: false } })).toEqual({ target: "reading", running: true, enabled: false });
  });

  it("逐句跟读: the take of the sentence; between two, nothing to pause", () => {
    expect(at({ drill: {}, rec: { phase: "speaking", paused: true } })).toEqual({ target: "take", running: false, enabled: true });
    expect(at({ drill: {} })).toEqual({ target: "take", running: true, enabled: false });
  });

  it("recording a paragraph: pauses it, then goes on with it", () => {
    expect(at({ live: { phase: "reading", paused: false } })).toEqual({ target: "reading", running: true, enabled: true });
    expect(at({ live: { phase: "reading", paused: true } })).toEqual({ target: "reading", running: false, enabled: true });
  });

  it("a take or a reading playing back: pauses it rather than playing the track", () => {
    expect(at({ playingTake: { paused: false } })).toEqual({ target: "takePlayback", running: true, enabled: true });
    expect(at({ playingTake: { paused: true }, playing: false })).toEqual({ target: "takePlayback", running: false, enabled: true });
    expect(at({ playingReading: { paused: false } })).toEqual({ target: "readingPlayback", running: true, enabled: true });
    expect(at({ playingReading: { paused: true } }).running).toBe(false);
  });

  it("says what it does", () => {
    expect(playKeyTitle(at({ rec: { phase: "speaking", paused: false } }))).toBe("暂停录音");
    expect(playKeyTitle(at({ live: { phase: "reading", paused: true } }))).toBe("继续录音");
    expect(playKeyTitle(at({ playingTake: { paused: false } }))).toBe("暂停回放");
    expect(playKeyTitle(at({ playingReading: { paused: true } }))).toBe("继续回放");
    expect(playKeyTitle(at({}))).toBe("播放 / 暂停 (空格)");
  });
});

describe("goingOn", () => {
  const take = { phase: "listening", along: false, going: false, waiting: null } as const;

  it("the original was playing: it plays on, nothing else to do", () => {
    expect(goingOn({ ...take, going: true })).toBe(null);
    expect(goingOn({ ...take, phase: "speaking", along: true, going: true })).toBe(null);
  });

  it("the original had ended (or ended as you paused): your turn", () => {
    expect(goingOn(take)).toBe("turn");
    expect(goingOn({ ...take, phase: "speaking", along: true })).toBe("turn");
  });

  it("your turn already: just goes on", () => {
    expect(goingOn({ ...take, phase: "speaking" })).toBe(null);
  });

  it("again and again: the next time through starts now, or by itself once ready", () => {
    expect(goingOn({ ...take, waiting: "start" })).toBe("start");
    expect(goingOn({ ...take, waiting: "round" })).toBe(null);
  });
});
