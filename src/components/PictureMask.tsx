import { useEffect, useRef, useState, type RefObject } from "react";
import { t } from "../lib/i18n";
import { contentRect, moveMaskEdge, shiftMask, type Rect } from "../lib/picture";
import { useApp } from "../store";

/**
 * A blurred band over subtitles burned into the picture, so they can't be read
 * while shadowing. Drag its top or bottom edge to fit them, or the band to move it;
 * where it sits is kept (one place for all videos: they usually put subtitles alike).
 */
export function PictureMask({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const on = useApp((s) => s.settings.pictureMask);
  const top = useApp((s) => s.settings.maskTop);
  const bottom = useApp((s) => s.settings.maskBottom);
  const setBand = useApp((s) => s.setMaskBand);
  const rect = usePictureRect(video);
  const drag = useRef<{ what: "top" | "bottom" | "band"; y: number; from: [number, number] } | null>(null);
  if (!on || !rect) return null;

  const move = (y: number) => {
    const d = drag.current;
    if (!d) return;
    const at = (y - (video.current?.getBoundingClientRect().top ?? 0) - rect.top) / rect.height;
    if (d.what === "band") setBand(shiftMask(d.from, (y - d.y) / rect.height));
    else setBand(moveMaskEdge(d.from, d.what, at));
  };
  const grab = (what: "top" | "bottom" | "band") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { what, y: e.clientY, from: [top, bottom] };
  };
  const edge = "absolute inset-x-0 h-2.5 cursor-row-resize touch-none";
  return (
    <div
      title={t("遮住画面里的字幕：拖上下边调整，拖中间移动")}
      onPointerDown={grab("band")}
      onPointerMove={(e) => move(e.clientY)}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      className="absolute cursor-grab touch-none border-y border-white/30 bg-[rgb(20_20_18/0.22)] active:cursor-grabbing"
      style={{
        left: rect.left,
        width: rect.width,
        top: rect.top + top * rect.height,
        height: (bottom - top) * rect.height,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      <span onPointerDown={grab("top")} className={`${edge} -top-1.5`} />
      <span aria-hidden className="absolute -top-[3px] left-1/2 h-[5px] w-9 -translate-x-1/2 rounded-full bg-white/85" />
      <span onPointerDown={grab("bottom")} className={`${edge} -bottom-1.5`} />
    </div>
  );
}

/** Where the picture itself is in its <video> box (object-fit: contain leaves bars around it). */
function usePictureRect(ref: RefObject<HTMLVideoElement | null>): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const measure = () => setRect(contentRect(v.clientWidth, v.clientHeight, v.videoWidth, v.videoHeight));
    const observer = new ResizeObserver(measure);
    observer.observe(v);
    v.addEventListener("loadedmetadata", measure);
    measure();
    return () => {
      observer.disconnect();
      v.removeEventListener("loadedmetadata", measure);
    };
  }, [ref]);
  return rect;
}
