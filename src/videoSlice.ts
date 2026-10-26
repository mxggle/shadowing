// Videos: how the picture above the sentences is shown (components/Picture.tsx).
// The sound is the engine's like any track's; see docs/video-plan.md.
import type { Settings } from "./lib/api";

/** The picture's height can be dragged between these (CSS pixels); the window may still make it smaller. */
export const PICTURE_MIN = 120;
export const PICTURE_MAX = 720;

export const clampPicture = (px: number) => Math.round(Math.min(PICTURE_MAX, Math.max(PICTURE_MIN, px)));

export interface VideoState {
  /** The picture's height, dragged with the bar under it; kept between launches. */
  setPictureHeight(px: number): void;
}

export function createVideoSlice(persistSettings: (patch: Partial<Settings>) => void): VideoState {
  return {
    setPictureHeight(px) {
      persistSettings({ pictureHeight: clampPicture(px) });
    },
  };
}
