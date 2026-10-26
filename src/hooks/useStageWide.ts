import { useEffect, useState } from "react";
import { isWide } from "../lib/picture";
import { useApp } from "../store";

/** Whether the main area is wide enough to put a video's picture beside the sentences. */
export function useStageWide(): boolean {
  const shelfOpen = useApp((s) => s.shelfOpen);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resized = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  return isWide(width, shelfOpen);
}
