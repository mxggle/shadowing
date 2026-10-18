import { ArrowDownToLine, ArrowUpToLine, Scissors } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { t } from "../lib/i18n";
import { useApp } from "../store";
import { Button, IconButton } from "./ui";

/** Grows the field to fit its text, so the sentence keeps its shape while you type. */
function fit(el: HTMLTextAreaElement) {
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * The sentence being corrected, as a field set in the same type as the script.
 * ↩ or clicking elsewhere saves, Esc puts it back. ⇧↩ cuts the sentence in two
 * at the cursor; ⌫ at its start joins it to the one before, ⌦ at its end the
 * one after. Buttons don't take focus (see App), so the row's play and loop
 * buttons work without leaving the field, and switching to another app keeps
 * it open (to look a word up).
 */
export function SentenceEditor() {
  // A new field for each sentence opened, so the cursor goes where it should.
  const key = useApp((s) => (s.editing ? `${s.editing.index}\n${s.editing.original}` : ""));
  return <Field key={key} />;
}

function Field() {
  const text = useApp((s) => s.editing?.text ?? "");
  const first = useApp((s) => s.editing?.index === 0);
  const last = useApp((s) => !!s.transcript && s.editing?.index === s.transcript.sentences.length - 1);
  const { setDraft, saveEdit, cancelEdit, splitDraft, mergeDraft, undoEdit } = useApp.getState();
  const field = useRef<HTMLTextAreaElement>(null);
  const empty = !text.trim();

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    fit(el);
    el.focus();
    const at = useApp.getState().editing?.caret ?? el.value.length;
    el.setSelectionRange(at, at);
  }, []);

  const cut = () => field.current && void splitDraft(field.current.selectionStart);

  return (
    <div className="min-w-0">
      <textarea
        ref={field}
        value={text}
        rows={1}
        spellCheck={false}
        aria-label={t("修改这一句", "Edit this sentence")}
        onChange={(e) => {
          setDraft(e.target.value);
          fit(e.target);
        }}
        onKeyDown={(e) => {
          // While an input method is composing, ↩ picks the kanji instead.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          const el = e.currentTarget;
          const caret = el.selectionStart === el.selectionEnd ? el.selectionStart : -1;
          const s = useApp.getState();
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            cut();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (!empty) void saveEdit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelEdit();
          } else if (e.key === "Backspace" && caret === 0 && !first && !e.altKey && !e.metaKey) {
            e.preventDefault();
            void mergeDraft(-1);
          } else if (e.key === "Delete" && caret === el.value.length && !last) {
            e.preventDefault();
            void mergeDraft(1);
          } else if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && text === s.editing?.original && s.undo.length) {
            // Nothing typed here to take back: ⌘Z takes back the last change instead (a cut just made, say).
            e.preventDefault();
            void undoEdit();
          }
        }}
        onBlur={() => document.hasFocus() && void saveEdit()}
        className="-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-[8px] bg-fill px-2 font-script text-[18px] leading-[30px] break-words text-fg outline-none transition-[background-color,box-shadow] duration-150 focus:bg-raised focus:shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_3px_var(--hover)]"
      />
      <div className="mt-2 mb-1 flex items-center gap-1.5">
        <Button primary title={t("保存 (↩)", "Save (↩)")} disabled={empty} className="h-7 px-2.5 text-[12px]" onClick={() => void saveEdit()}>
          {t("保存", "Save")}
        </Button>
        <Button title={t("取消 (Esc)", "Cancel (Esc)")} className="h-7 px-2.5 text-[12px]" onClick={cancelEdit}>
          {t("取消", "Cancel")}
        </Button>
        <span className="ml-auto flex gap-0.5">
          <IconButton title={t("在光标处断开成两句 (⇧↩)", "Split into two sentences at the cursor (⇧↩)")} onClick={cut}>
            <Scissors />
          </IconButton>
          <IconButton title={t("并入上一句（光标在句首时按 ⌫）", "Merge into the sentence before (⌫ at its start)")} disabled={first} className="disabled:opacity-40" onClick={() => void mergeDraft(-1)}>
            <ArrowUpToLine />
          </IconButton>
          <IconButton title={t("并入下一句（光标在句尾时按 ⌦）", "Merge into the sentence after (⌦ at its end)")} disabled={last} className="disabled:opacity-40" onClick={() => void mergeDraft(1)}>
            <ArrowDownToLine />
          </IconButton>
        </span>
      </div>
    </div>
  );
}
