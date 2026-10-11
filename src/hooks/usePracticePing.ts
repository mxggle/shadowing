import { useEffect } from "react";
import { api } from "../lib/api";
import { useApp } from "../store";

/** One ping per this long is enough: Rust only needs to know the learner is still here. */
const PING_EVERY_MS = 10_000;
const EVENTS = ["keydown", "pointerdown", "pointermove", "wheel"] as const;

/**
 * Tells Rust the learner is still at it while the audio is paused (saying the
 * sentence, reading an explanation), so the pause counts as practice. Only with
 * an audio open, the window focused and no settings or records sheet in front.
 */
export function usePracticePing() {
  useEffect(() => {
    let last = 0;
    const onActivity = () => {
      const s = useApp.getState();
      if (!s.current || s.settingsOpen || s.wizardOpen || s.statsOpen || !document.hasFocus()) return;
      const now = Date.now();
      if (now - last < PING_EVERY_MS) return;
      last = now;
      void api.practice.ping();
    };
    for (const e of EVENTS) window.addEventListener(e, onActivity, { capture: true, passive: true });
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity, { capture: true });
    };
  }, []);
}
