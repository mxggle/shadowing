import { describe, expect, it } from "vitest";
import { mediaAction, stale, type MediaState, type NowPlaying } from "./mediaKeys";

const idle: MediaState = { running: false, sentences: true, reading: false, take: false };
const at = (s: Partial<MediaState>) => ({ ...idle, ...s });

describe("mediaAction", () => {
  it("⏯ is the deck's play key, whatever is going on", () => {
    expect(mediaAction("toggle", idle)).toEqual({ do: "toggle" });
    expect(mediaAction("toggle", at({ running: true, take: true }))).toEqual({ do: "toggle" });
  });

  it("play and pause on their own only change what needs changing", () => {
    expect(mediaAction("play", idle)).toEqual({ do: "toggle" });
    expect(mediaAction("play", at({ running: true }))).toBeNull();
    expect(mediaAction("pause", at({ running: true }))).toEqual({ do: "toggle" });
    expect(mediaAction("pause", idle)).toBeNull();
  });

  it("⏮ ⏭ step through the sentences, as [ ] do", () => {
    expect(mediaAction("next", idle)).toEqual({ do: "sentence", direction: 1 });
    expect(mediaAction("previous", at({ running: true }))).toEqual({ do: "sentence", direction: -1 });
  });

  it("with no sentences, jump back and on", () => {
    expect(mediaAction("previous", at({ sentences: false }))).toEqual({ do: "jump", direction: -1 });
    expect(mediaAction("next", at({ sentences: false }))).toEqual({ do: "jump", direction: 1 });
  });

  it("reading a paragraph aloud: put the highlight right; recording a take: nothing", () => {
    expect(mediaAction("next", at({ reading: true, running: true }))).toEqual({ do: "reading", direction: 1 });
    expect(mediaAction("previous", at({ take: true, running: true }))).toBeNull();
  });
});

describe("stale", () => {
  const np: NowPlaying = { title: "02 天気の話", artist: "日本語ポッドキャスト", duration: 200, position: 10, rate: 0.85, playing: true };
  const sent = { np, at: 1000 };

  it("tells the system the first time, and once more when there is nothing to show", () => {
    expect(stale(null, np, 0)).toBe(true);
    expect(stale(sent, null, 2000)).toBe(true);
    expect(stale(null, null, 0)).toBe(false);
  });

  it("doesn't while the position moves on as the rate says", () => {
    // 4 s later at 0.85×: 13.4 s in.
    expect(stale(sent, { ...np, position: 13.4 }, 5000)).toBe(false);
    expect(stale(sent, { ...np, position: 13.9 }, 5000)).toBe(false);
  });

  it("does after a seek or a loop going round", () => {
    expect(stale(sent, { ...np, position: 2 }, 5000)).toBe(true);
    expect(stale({ np: { ...np, rate: 0, playing: false }, at: 1000 }, { ...np, rate: 0, playing: false, position: 30 }, 5000)).toBe(true);
  });

  it("does when what it shows changes", () => {
    expect(stale(sent, { ...np, playing: false, rate: 0 }, 1000)).toBe(true);
    expect(stale(sent, { ...np, rate: 1 }, 1000)).toBe(true);
    expect(stale(sent, { ...np, title: "03 駅で" }, 1000)).toBe(true);
    expect(stale(sent, { ...np, duration: 0 }, 1000)).toBe(true);
    expect(stale(sent, { ...np, duration: 200.2 }, 1000)).toBe(false);
  });
});
