// Videos: how the picture is shown (components/Picture.tsx, VideoStage.tsx).
// The sound is the engine's like any track's; see docs/video-plan.md.
import type { PictureLayout, Settings } from "./lib/api";
import { isWide, layoutShown, nextLayout } from "./lib/picture";
import type { AppState } from "./store";

/** The picture's height can be dragged between these (CSS pixels); the window may still make it smaller. */
export const PICTURE_MIN = 120;
export const PICTURE_MAX = 720;

export const clampPicture = (px: number) => Math.round(Math.min(PICTURE_MAX, Math.max(PICTURE_MIN, px)));

/** "shown": the video has a picture that plays here; "none": it has only sound; "failed": this webview can't decode it. */
export type PictureLook = "loading" | "shown" | "none" | "failed";

export interface VideoState {
  /** What the current video's picture turned out to be; the layouts need one that's shown. */
  pictureLook: PictureLook;
  /** The picture's height, dragged with the bar under it; kept between launches. */
  setPictureHeight(px: number): void;
  setPictureLayout(layout: PictureLayout): void;
  /** V: on to the next layout that fits the window. */
  cyclePictureLayout(): void;
  setPictureMask(on: boolean): void;
  setMaskBand(band: [number, number]): void;
  setPictureHidden(hidden: boolean): void;
  setPictureLook(look: PictureLook): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createVideoSlice(set: Set, get: Get, persistSettings: (patch: Partial<Settings>) => void): VideoState {
  return {
    pictureLook: "loading",
    setPictureHeight(px) {
      persistSettings({ pictureHeight: clampPicture(px) });
    },
    setPictureLayout(pictureLayout) {
      persistSettings({ pictureLayout });
    },
    cyclePictureLayout() {
      const { current, settings, shelfOpen, pictureLook } = get();
      if (current?.kind !== "video" || settings.pictureHidden || pictureLook !== "shown") return;
      const wide = isWide(window.innerWidth, shelfOpen);
      persistSettings({ pictureLayout: nextLayout(layoutShown(settings.pictureLayout, wide), wide) });
    },
    setPictureMask(pictureMask) {
      persistSettings({ pictureMask });
    },
    setMaskBand([maskTop, maskBottom]) {
      persistSettings({ maskTop, maskBottom });
    },
    setPictureHidden(pictureHidden) {
      persistSettings({ pictureHidden });
    },
    setPictureLook(pictureLook) {
      if (pictureLook !== get().pictureLook) set({ pictureLook });
    },
  };
}
