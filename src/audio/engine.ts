// Wraps one <audio> element. All playback side effects live here; the store
// only calls these methods and listens to the callbacks.
import { devLog } from "../lib/api";
import { NO_LOOP, shouldJumpToA, type Loop } from "./logic";

export interface EngineEvents {
  onTime(t: number): void;
  onDuration(d: number): void;
  onPlaying(playing: boolean): void;
  onEnded(): void;
  onError(message: string): void;
}

// A timer instead of requestAnimationFrame: rAF pauses when the window is
// hidden, and people often shadow with the window in the background.
const TICK_MS = 20;

export class AudioEngine {
  private audio = new Audio();
  private loop: Loop = NO_LOOP;
  private prevTime = 0;
  private ticker: number | undefined;
  private pendingStart: { at: number; play: boolean } | null = null;
  private loopJumpTarget: number | null = null;

  constructor(private events: EngineEvents) {
    const a = this.audio;
    a.preload = "auto";
    a.preservesPitch = true;
    (a as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;

    a.addEventListener("loadedmetadata", () => {
      this.events.onDuration(a.duration);
      // Seeking before metadata is unreliable, so the start position waits for it.
      const start = this.pendingStart;
      this.pendingStart = null;
      if (start) {
        if (start.at > 0) a.currentTime = start.at;
        this.prevTime = start.at;
        this.events.onTime(start.at);
        if (start.play) void this.play();
      }
    });
    a.addEventListener("durationchange", () => this.events.onDuration(a.duration));
    a.addEventListener("play", () => {
      this.startTicker();
      this.events.onPlaying(true);
    });
    a.addEventListener("pause", () => {
      this.stopTicker();
      this.events.onTime(a.currentTime);
      this.events.onPlaying(false);
    });
    a.addEventListener("ended", () => {
      this.stopTicker();
      this.events.onPlaying(false);
      this.events.onEnded();
    });
    a.addEventListener("seeked", () => {
      if (this.loopJumpTarget !== null) {
        const ms = ((a.currentTime - this.loopJumpTarget) * 1000).toFixed(0);
        devLog(`loop seek landed ${ms}ms from A`);
        this.loopJumpTarget = null;
      }
      this.prevTime = a.currentTime;
      this.events.onTime(a.currentTime);
    });
    a.addEventListener("error", () => {
      const code = a.error?.code;
      this.events.onError(
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? "无法播放此文件格式" : "音频加载失败",
      );
    });
  }

  load(url: string, startAt: number, autoplay: boolean) {
    this.stopTicker();
    this.loop = NO_LOOP;
    this.pendingStart = { at: startAt, play: autoplay };
    this.audio.src = url;
    this.audio.load();
  }

  unload() {
    this.stopTicker();
    this.pendingStart = null;
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  async play() {
    try {
      await this.audio.play();
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") this.events.onError(String(err));
    }
  }

  pause() {
    this.audio.pause();
  }

  toggle() {
    if (this.audio.paused) void this.play();
    else this.pause();
  }

  get paused() {
    return this.audio.paused;
  }

  get time() {
    return this.audio.currentTime;
  }

  get duration() {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }

  seek(t: number) {
    const d = this.duration;
    const target = Math.max(0, d > 0 ? Math.min(t, d - 0.05) : t);
    this.audio.currentTime = target;
    this.prevTime = target;
    this.events.onTime(target);
  }

  setRate(rate: number) {
    this.audio.playbackRate = rate;
    this.audio.defaultPlaybackRate = rate;
  }

  setVolume(v: number) {
    this.audio.volume = v;
  }

  setLoop(loop: Loop) {
    this.loop = loop;
    this.prevTime = this.audio.currentTime;
  }

  private startTicker() {
    if (this.ticker !== undefined) return;
    this.prevTime = this.audio.currentTime;
    this.ticker = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicker() {
    if (this.ticker !== undefined) window.clearInterval(this.ticker);
    this.ticker = undefined;
  }

  private tick() {
    const now = this.audio.currentTime;
    if (shouldJumpToA(this.loop, this.prevTime, now) && this.loop.a !== null) {
      devLog(`loop overshoot ${((now - this.loop.b!) * 1000).toFixed(0)}ms past B`);
      this.loopJumpTarget = this.loop.a;
      this.audio.currentTime = this.loop.a;
      this.prevTime = this.loop.a;
      this.events.onTime(this.loop.a);
      return;
    }
    this.prevTime = now;
    this.events.onTime(now);
  }
}
