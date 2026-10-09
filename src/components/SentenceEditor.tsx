import { useLayoutEffect, useRef } from "react";
import { useApp } from "../store";
import { Button } from "./ui";

/** Grows the field to fit its text, so the sentence keeps its shape while you type. */
function fit(el: HTMLTextAreaElement) {
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * The sentence being corrected, as a field set in the same type as the script.
 * ↩ or clicking elsewhere saves, Esc puts it back. Buttons don't take focus
 * (see App), so the row's play and loop buttons work without leaving the field,
 * and switching to another app keeps it open (to look a word up).
 */
export function SentenceEditor() {
  const text = useApp((s) => s.editing?.text ?? "");
  const { setDraft, saveEdit, cancelEdit } = useApp.getState();
  const field = useRef<HTMLTextAreaElement>(null);
  const empty = !text.trim();

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    fit(el);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div className="min-w-0">
      <textarea
        ref={field}
        value={text}
        rows={1}
        spellCheck={false}
        aria-label="修改这一句"
        onChange={(e) => {
          setDraft(e.target.value);
          fit(e.target);
        }}
        onKeyDown={(e) => {
          // While an input method is composing, ↩ picks the kanji instead.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter") {
            e.preventDefault();
            if (!empty) void saveEdit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelEdit();
          }
        }}
        onBlur={() => document.hasFocus() && void saveEdit()}
        className="-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-[8px] bg-fill px-2 font-script text-[18px] leading-[30px] break-words text-fg outline-none transition-[background-color,box-shadow] duration-150 focus:bg-raised focus:shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_3px_var(--hover)]"
      />
      <div className="mt-2 mb-1 flex gap-1.5">
        <Button primary title="保存 (↩)" disabled={empty} className="h-7 px-2.5 text-[12px]" onClick={() => void saveEdit()}>
          保存
        </Button>
        <Button title="取消 (Esc)" className="h-7 px-2.5 text-[12px]" onClick={cancelEdit}>
          取消
        </Button>
      </div>
    </div>
  );
}
