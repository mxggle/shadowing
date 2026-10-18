// Playing takes back (part of the 跟读录音 slice): a take is an engine clip
// over the paused track; at its end it goes on to the next recorded sentence,
// the same way (一起听 / 对比 / 原句 / 我的), so a whole text can be listened
// through. Playing the track stops it; the deck's play key pauses it where it is.
import { listen } from "@tauri-apps/api/event";
import type { AudioEngine } from "./audio/engine";
import { isLoopActive } from "./audio/logic";
import { api, type ClipPart, type TakePart } from "./lib/api";
import { t } from "./lib/i18n";
import { comparePart, nextTake, sentenceOf } from "./lib/takes";
import type { Get, Set } from "./recordSlice";

export interface PlayingTake {
  id: string;
  what: TakePart;
  /** At its end, go on to the next recorded sentence (not after a fresh recording's replay). */
  chain: boolean;
  clip: number;
  parts: ClipPart[];
  duration: number;
  secs: number;
  /** Paused where it is (the deck's play key). */
  paused: boolean;
}

export interface TakePlayback {
  playingTake: PlayingTake | null;
  /** Plays a take, then (`chain`, the default) each recorded sentence after it the same way. */
  playTake(id: string, what: TakePart, chain?: boolean): Promise<void>;
  stopTake(): void;
  /** Pauses the take playing back where it is, or goes on with it. */
  pausePlayingTake(paused: boolean): void;
  /** The track started playing: a take playing, or about to, gives way to it. */
  trackPlaying(): void;
}

export function createTakePlayback(set: Set, get: Get, engine: AudioEngine): TakePlayback {
  void listen<{ clip: number; secs: number; playing: boolean; ended: boolean }>("recorder:clip", ({ payload }) => {
    const p = get().playingTake;
    if (!p || p.clip !== payload.clip) return;
    set({ playingTake: payload.playing ? { ...p, secs: payload.secs } : null });
    // Only a take that played to its end goes on; playing the track stops it short.
    if (payload.ended && p.chain) playOn(p);
  });

  /** Bumped by every play and stop; `stoppedAt` is the bump of the last stop. A play
   *  that was stopped while it started is stopped once it has (`resume`: by playing
   *  the track, which it paused); one that another play took over from is left to it. */
  let playing = 0;
  let stoppedAt = -1;
  let resume = false;

  /**
   * A take played to its end: the next recorded sentence, the same way. Its
   * card, left behind, closes; the track moves along (unless looping), so
   * stopping leaves you on the sentence you got to.
   */
  function playOn(p: PlayingTake) {
    const s = get();
    const sentences = s.transcript?.sentences ?? [];
    const take = s.takes.find((t) => t.id === p.id);
    const from = take ? sentenceOf(take, sentences) : -1;
    const next = from < 0 ? null : nextTake(s.takes, sentences, from, take?.group);
    if (!next || s.rec || s.live) return;
    if (s.recordAt === from) set({ recordAt: null, recError: null });
    if (!isLoopActive(s.loop)) get().seek(sentences[next.index].start);
    // Both voices: each take the way it has them (一起听 over 边听边说, 对比 one after the other).
    const what = p.what === "together" || p.what === "compare" ? comparePart(next.take) : p.what;
    void get().playTake(next.take.id, what);
  }

  return {
    playingTake: null,

    async playTake(id, what, chain = true) {
      const path = get().current?.path;
      // Not while recording: the clip would pause the original being shadowed.
      if (!path || get().rec || get().live) return;
      const mine = ++playing;
      // Playing from now (clip −1 until it starts): the list moves to its sentence
      // without a gap, and the end of the clip it replaces isn't one to go on from.
      set({ playingTake: { id, what, chain, clip: -1, parts: [], duration: 0, secs: 0, paused: false }, shownTake: id, recError: null });
      try {
        const p = await api.record.play(path, id, what);
        if (mine !== playing) {
          if (stoppedAt === playing) void (resume ? engine.play() : api.record.stop());
          return;
        }
        // Paused while it started: the pause reached Rust after it, and holds it.
        set((s) => ({ playingTake: { id, what, chain, ...p, secs: 0, paused: s.playingTake?.paused ?? false } }));
      } catch (e) {
        if (mine !== playing) return;
        set({ playingTake: null });
        // In the card when it's open; played from the sentence (or listening on), above the deck.
        if (get().recordAt !== null) set({ recError: String(e) });
        else get().say(t("录音放不出来：{error}", { error: String(e) }));
      }
    },

    stopTake() {
      stoppedAt = ++playing;
      resume = false;
      if (!get().playingTake) return;
      set({ playingTake: null });
      void api.record.stop();
    },

    pausePlayingTake(paused) {
      const p = get().playingTake;
      if (!p || p.paused === paused) return;
      set({ playingTake: { ...p, paused } });
      void api.record.pauseClip(paused);
    },

    trackPlaying() {
      const p = get().playingTake;
      if (!p) return;
      // The engine has stopped the clip already; one still starting pauses the track, so play it again then.
      stoppedAt = ++playing;
      resume = p.clip === -1;
      set({ playingTake: null });
    },
  };
}
