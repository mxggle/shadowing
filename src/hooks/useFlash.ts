import { useEffect, useState } from "react";

// Keyboard shortcuts briefly "press" the matching on-screen button, so an
// action triggered from the keyboard is still visible where it lives.
const EVENT = "shadowing:flash";
const FLASH_MS = 160;

export type FlashId = "toggle" | "back" | "forward" | "prev" | "next" | "loop" | "slower" | "faster";

export function flash(id: FlashId) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

export function useFlash(id: FlashId | undefined): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!id) return;
    let timer = 0;
    const onFlash = (e: Event) => {
      if ((e as CustomEvent<FlashId>).detail !== id) return;
      setOn(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setOn(false), FLASH_MS);
    };
    window.addEventListener(EVENT, onFlash);
    return () => {
      window.removeEventListener(EVENT, onFlash);
      window.clearTimeout(timer);
    };
  }, [id]);
  return on;
}
