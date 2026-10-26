// How a video's picture is laid out (docs/video-plan.md): above the sentences, beside
// them, or large on its own ("theater"); and the band that can cover subtitles burned
// into it.
import type { PictureLayout } from "./api";

/** Side by side needs this much width in the main area for both the picture and the sentences. */
export const SIDE_MIN = 1100;
/** The list on the left, when open (App.tsx). */
export const SHELF_WIDTH = 248;

export const isWide = (windowWidth: number, shelfOpen: boolean) => windowWidth - (shelfOpen ? SHELF_WIDTH : 0) >= SIDE_MIN;

/** The layout shown: side by side only where it fits, else above the sentences (the choice is kept). */
export const layoutShown = (chosen: PictureLayout, wide: boolean): PictureLayout => (chosen === "side" && !wide ? "stack" : chosen);

/** V: on to the next layout that fits. */
export function nextLayout(shown: PictureLayout, wide: boolean): PictureLayout {
  const order: PictureLayout[] = wide ? ["stack", "side", "theater"] : ["stack", "theater"];
  return order[(order.indexOf(shown) + 1) % order.length];
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a picture of `w` × `h` sits in a box of `boxW` × `boxH` when fitted whole (object-fit: contain). */
export function contentRect(boxW: number, boxH: number, w: number, h: number): Rect {
  if (!(w > 0 && h > 0 && boxW > 0 && boxH > 0)) return { left: 0, top: 0, width: boxW, height: boxH };
  const scale = Math.min(boxW / w, boxH / h);
  const [width, height] = [w * scale, h * scale];
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

/** The band is never thinner than this (a fraction of the picture's height). */
export const MASK_MIN = 0.05;
export const MASK_DEFAULT: [number, number] = [0.74, 0.96];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** One edge of the band dragged to `to` (a fraction of the picture's height). */
export function moveMaskEdge([top, bottom]: [number, number], edge: "top" | "bottom", to: number): [number, number] {
  return edge === "top" ? [clamp(to, 0, bottom - MASK_MIN), bottom] : [top, clamp(to, top + MASK_MIN, 1)];
}

/** The whole band moved by `by`, staying inside the picture. */
export function shiftMask([top, bottom]: [number, number], by: number): [number, number] {
  const d = clamp(by, -top, 1 - bottom);
  return [top + d, bottom + d];
}
