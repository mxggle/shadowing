// Text fields and the keyboard shortcuts: keys typed into a field are left to it.

export const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

/** Leaves no text field focused (starting to record: a click on the mic can leave the focus in one, and Space would type). */
export function blurField() {
  const el = document.activeElement;
  if (el instanceof HTMLElement && isTypingTarget(el)) el.blur();
}
