import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { api } from "../lib/api";
import { mediaAction, stale, type MediaButton, type NowPlaying, type Sent } from "../lib/mediaKeys";
import { playKeyOf, useApp } from "../store";
import { flash } from "./useFlash";

type State = ReturnType<typeof useApp.getState>;

/** What the system shows: the track and its folder; nothing with no track open or 媒体键 off. */
function nowPlayingOf(s: State): NowPlaying | null {
  if (!s.settings.mediaKeys || !s.current) return null;
  const key = playKeyOf(s);
  return {
    title: s.current.name,
    artist: s.folder?.name ?? "Shadowing",
    duration: s.duration,
    position: s.time,
    // A recording or a playback has the key: the track's position stands still meanwhile.
    rate: key.target === "track" && s.playing ? s.settings.rate : 0,
    playing: key.running,
  };
}

/** A button pressed (on the keyboard, a headset, Control Center): what it does now (lib/mediaKeys.ts). */
function press(button: MediaButton) {
  const s = useApp.getState();
  if (!s.settings.mediaKeys) return;
  const action = mediaAction(button, {
    running: playKeyOf(s).running,
    sentences: (s.transcript?.sentences.length ?? 0) > 0,
    reading: !!s.live,
    take: !!s.rec,
  });
  if (!action) return;
  if (action.do === "toggle") {
    s.toggle();
    flash("toggle");
  } else if (action.do === "sentence") {
    s.stepSentence(action.direction);
    flash(action.direction < 0 ? "prevSentence" : "nextSentence");
  } else if (action.do === "reading") {
    s.stepReading(action.direction);
  } else {
    s.jump(action.direction);
    flash(action.direction < 0 ? "back" : "forward");
  }
}

/**
 * 媒体键: tells the system what is playing (only when that changes, see `stale`), which also
 * gives the app the keyboard's ⏯ ⏮ ⏭ and a headset's buttons; and does what they ask.
 */
export function useMediaKeys() {
  useEffect(() => {
    let sent: Sent | null = null;
    const tell = (s: State) => {
      const np = nowPlayingOf(s);
      const now = performance.now();
      if (!stale(sent, np, now)) return;
      sent = np && { np, at: now };
      void api.nowPlaying(np);
    };
    tell(useApp.getState());
    const unsubscribe = useApp.subscribe(tell);
    const unlisten = listen<MediaButton>("media:button", (e) => press(e.payload));
    return () => {
      unsubscribe();
      void unlisten.then((stop) => stop());
    };
  }, []);
}
