// 等我说完 for 跟读停顿: in the pause after a sentence the microphone listens (Rust,
// record/listen.rs) until you've said it, and the pause ends; said nothing, or no microphone,
// the pause waits for a key instead. Nothing is recorded.
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import type { AppState } from "./store";

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export interface Listening {
  /** Listens until you've said a stretch `length` seconds long (in the track). */
  start(length: number): void;
  /** The pause ended some other way. */
  stop(): void;
}

/** `said`: you've said it; the pause is over. */
export function createListening(get: Get, set: Set, said: () => void): Listening {
  /** Which listening is the latest, so an answer for an older one is ignored. */
  let id = 0;

  /** Nothing said (or no microphone): the pause waits for a key instead. */
  function heardNothing(error?: string | null) {
    const gap = get().paceGap;
    if (!gap?.listening) return;
    set({ paceGap: { ...gap, listening: false } });
    if (error) get().say(error, 8000);
  }

  void listen<{ id: number; stop: "pause" | "nothing" | "long" | null; error: string | null }>("listen:done", ({ payload }) => {
    if (payload.id !== id || !get().paceGap?.listening) return;
    if (payload.stop === "pause" || payload.stop === "long") said();
    else heardNothing(payload.error);
  });

  return {
    start(length) {
      const mine = ++id;
      // Waiting for you to start: a little longer than the longest pause by length would be.
      const wait = Math.max(4, (length / (get().settings.rate || 1)) * 1.5 + 3.5);
      api.record.listen(mine, wait).catch((e) => mine === id && heardNothing(String(e)));
    },
    stop() {
      id++;
      api.record.stopListening().catch(() => {});
    },
  };
}
