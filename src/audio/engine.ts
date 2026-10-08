// Thin client for the native Rust player (src-tauri/src/audio). Decoding,
// speed, looping and output all happen in Rust; this class forwards commands
// and turns `player:*` events into callbacks for the store.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Loop } from "./logic";

export interface EngineEvents {
  onTime(t: number): void;
  onDuration(d: number): void;
  onPlaying(playing: boolean): void;
  onRepeats(repeats: number): void;
  onEnded(): void;
  onError(message: string): void;
}

export interface PlayerStatus {
  path: string | null;
  time: number;
  duration: number;
  playing: boolean;
  /** Passes the current A–B loop has completed (0 without a loop). */
  repeats: number;
  /** Snapshot order from Rust; events may arrive out of order. */
  seq: number;
}

export class AudioEngine {
  private status: PlayerStatus = { path: null, time: 0, duration: 0, playing: false, repeats: 0, seq: 0 };
  private statusAt = performance.now();
  private rate = 1;
  /** Track we last asked for; events for any other path are stale. */
  private path: string | null = null;
  private lastSeq = 0;
  /** Playhead commands awaiting their reply; events meanwhile are stale. */
  private inflight = 0;

  constructor(private events: EngineEvents) {
    void listen<PlayerStatus>("player:status", (e) => {
      if (this.inflight === 0) this.apply(e.payload);
    });
    void listen<{ path: string }>("player:ended", (e) => {
      if (e.payload.path === this.path) this.events.onEnded();
    });
    void listen<{ path: string | null; message: string }>("player:error", (e) => {
      if (!e.payload.path || e.payload.path === this.path) this.events.onError(e.payload.message);
    });
  }

  private apply(s: PlayerStatus) {
    if (s.path !== this.path || s.seq <= this.lastSeq) return;
    this.lastSeq = s.seq;
    const prev = this.status;
    this.status = s;
    this.statusAt = performance.now();
    if (s.duration !== prev.duration) this.events.onDuration(s.duration);
    if (s.playing !== prev.playing) this.events.onPlaying(s.playing);
    if (s.repeats !== prev.repeats) this.events.onRepeats(s.repeats);
    this.events.onTime(s.time);
  }

  private send(cmd: string, args?: Record<string, unknown>) {
    invoke(cmd, args).catch((err) => this.events.onError(String(err)));
  }

  /** Sends a command that moves the playhead and applies the status it returns. */
  private async command(cmd: string, args?: Record<string, unknown>) {
    this.inflight++;
    try {
      this.apply(await invoke<PlayerStatus>(cmd, args));
    } catch (err) {
      this.events.onError(String(err));
    } finally {
      this.inflight--;
    }
  }

  async load(path: string, startAt: number, autoplay: boolean) {
    this.path = path;
    this.status = { path, time: startAt, duration: 0, playing: false, repeats: 0, seq: this.lastSeq };
    this.statusAt = performance.now();
    await this.command("player_load", { path, startAt, autoplay });
  }

  unload() {
    this.path = null;
    this.status = { path: null, time: 0, duration: 0, playing: false, repeats: 0, seq: this.lastSeq };
    this.send("player_unload");
  }

  play() {
    void this.command("player_play");
  }

  pause() {
    void this.command("player_pause");
  }

  toggle() {
    void this.command("player_toggle");
  }

  get paused() {
    return !this.status.playing;
  }

  /** Last reported time, extrapolated between ~30 Hz status events. */
  get time() {
    const { time, duration, playing } = this.status;
    if (!playing) return time;
    const t = time + ((performance.now() - this.statusAt) / 1000) * this.rate;
    return duration > 0 ? Math.min(t, duration) : t;
  }

  get duration() {
    return this.status.duration;
  }

  seek(t: number) {
    const d = this.duration;
    const target = Math.max(0, d > 0 ? Math.min(t, d - 0.05) : t);
    this.status = { ...this.status, time: target };
    this.statusAt = performance.now();
    this.events.onTime(target);
    void this.command("player_seek", { time: target });
  }

  setRate(rate: number) {
    this.rate = rate;
    this.send("player_set_rate", { rate });
  }

  setVolume(volume: number) {
    this.send("player_set_volume", { volume });
  }

  setLoop(loop: Loop) {
    this.send("player_set_loop", { a: loop.a, b: loop.b });
  }

  /** Authoritative status straight from Rust (used by the smoke test). */
  statusNow() {
    return invoke<PlayerStatus>("player_status");
  }
}
