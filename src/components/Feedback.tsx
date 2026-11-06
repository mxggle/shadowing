import { listen } from "@tauri-apps/api/event";
import { ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type FeedbackLine } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { asText, canSend, counter } from "../lib/feedback";
import { t } from "../lib/i18n";
import { isMod, shortcut } from "../lib/platform";
import { useApp } from "../store";
import { Button, fieldClass, IconButton, TextLink } from "./ui";

/** The shared field look, without its single-line height. */
const noHeight = fieldClass.replace("h-8 ", "");

/**
 * 意见反馈: a few lines to the developer, sent from Rust (src-tauri/src/feedback.rs) when 发送 is
 * pressed. Opened from settings (版本) and 发送反馈… in the app menu; the draft stays until it is sent.
 */
export function FeedbackDialog() {
  const open = useApp((s) => s.feedbackOpen);
  const send = useApp((s) => s.feedbackSend);
  const setOpen = useApp((s) => s.setFeedbackOpen);

  useEffect(() => {
    const off = listen("feedback:open", () => setOpen(true));
    return () => void off.then((f) => f());
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    // Capture phase: Esc closes the window instead of also clearing the loop; ⌘↩ sends from any field.
    const onKey = (e: KeyboardEvent) => {
      const send = e.key === "Enter" && isMod(e) && !e.isComposing;
      if (e.key !== "Escape" && !send) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (send) void useApp.getState().sendFeedback();
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-30 flex animate-fade justify-center bg-black/25 px-6 pt-[7vh] pb-6 dark:bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="flex max-h-full w-full max-w-[520px] animate-pop-in flex-col self-start overflow-hidden rounded-[16px] bg-raised shadow-lift"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2.5 pl-6">
          <h2 id="feedback-title" className="text-[14px] font-semibold">
            {t("意见反馈")}
          </h2>
          <IconButton title={t("关闭 (Esc)")} onClick={() => setOpen(false)}>
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-none overflow-y-auto px-6 pt-5 pb-6">{send.state === "sent" ? <Sent /> : <Form />}</div>
      </div>
    </div>
  );
}

function Form() {
  const draft = useApp((s) => s.feedbackDraft);
  const send = useApp((s) => s.feedbackSend);
  const { editFeedback, sendFeedback, setFeedbackOpen } = useApp.getState();
  const sending = send.state === "sending";
  const ready = canSend(draft.message, draft.contact) && !sending;
  const count = counter(draft.message);

  return (
    <>
      <p className="text-[13px] leading-relaxed text-muted">
        {t("遇到的问题、想要的功能、哪里用着不顺手，都可以写在这里。只有开发者会看到，不会公开。")}
      </p>
      <textarea
        autoFocus
        value={draft.message}
        readOnly={sending}
        aria-label={t("反馈内容")}
        placeholder={t("比如：边听边说时录不到自己的声音；希望能导出到 Anki……")}
        onChange={(e) => editFeedback({ message: e.target.value })}
        className={`${noHeight} mt-4 h-36 resize-none py-2 leading-relaxed`}
      />
      {count && <p className="mt-1 text-right font-mono text-[11px] text-faint tabular">{count}</p>}
      <label className="mt-4 block text-[12px] font-medium text-muted" htmlFor="feedback-contact">
        {t("联系方式（选填）")}
      </label>
      <input
        id="feedback-contact"
        value={draft.contact}
        readOnly={sending}
        placeholder={t("邮箱、微信或小红书，方便回复你")}
        onChange={(e) => editFeedback({ contact: e.target.value })}
        className={`${fieldClass} mt-1.5`}
      />
      <Diagnostics on={draft.diagnostics} disabled={sending} onChange={(diagnostics) => editFeedback({ diagnostics })} />
      {send.state === "failed" && (
        <p className="mt-4 text-[12px] leading-relaxed text-danger">
          {send.message}{" "}
          <TextLink className="text-[12px]" onClick={() => void copyText(asText(draft.message, draft.contact))}>
            {t("复制内容")}
          </TextLink>
        </p>
      )}
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button onClick={() => setFeedbackOpen(false)}>{t("取消")}</Button>
        <Button primary disabled={!ready} title={t("发送 ({key})", { key: shortcut("⌘↩") })} onClick={() => void sendFeedback()}>
          {sending ? t("正在发送…") : t("发送")}
        </Button>
      </div>
    </>
  );
}

/** 附上诊断信息, with the exact lines it adds one click away. */
function Diagnostics({ on, disabled, onChange }: { on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const [lines, setLines] = useState<FeedbackLine[] | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => void api.feedback.diagnostics().then(setLines, () => setLines([])), []);

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-fg" />
          {t("附上诊断信息")}
        </label>
        <TextLink className="flex items-center gap-0.5 text-[12px]" aria-expanded={shown} onClick={() => setShown(!shown)}>
          {t("会附上什么")}
          <ChevronRight size={12} className={`transition-transform duration-150 ${shown ? "rotate-90" : ""}`} />
        </TextLink>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        {t("版本号、系统和界面语言总会附上。勾上时再加上下面这些，方便找到问题；不含 API Key、文件和录音。")}
      </p>
      {shown && lines && (
        <dl className={`mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[8px] bg-fill px-3 py-2 text-[12px] ${on ? "" : "opacity-50"}`}>
          {lines.map((l) => (
            <div key={l.key} className="contents">
              <dt className="text-muted">{l.label}</dt>
              <dd className="min-w-0 break-words">{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Sent() {
  const close = () => useApp.getState().setFeedbackOpen(false);
  return (
    <>
      <p className="text-[14px] font-semibold">{t("收到了，谢谢！")}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t("每一条都会认真看。留了联系方式的话，会尽量回复你。")}</p>
      <div className="mt-5 flex justify-end">
        <Button primary onClick={close}>
          {t("好")}
        </Button>
      </div>
    </>
  );
}
