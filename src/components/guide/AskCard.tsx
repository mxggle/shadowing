import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../../lib/api";
import { ASK_KIND, ASK_TIP, askDays, daysBefore, QUIET_MS, shouldAsk } from "../../lib/ask";
import { t } from "../../lib/i18n";
import { isMod } from "../../lib/platform";
import { byDay } from "../../lib/practice";
import { useApp, type AppState } from "../../store";
import { Button, fieldClass, IconButton } from "../ui";

/** Practice going on, or something else in the card's place or over it: the card stays away while any of it is. */
const busy = (s: AppState) =>
  s.playing ||
  !!s.rec ||
  !!s.live ||
  !!s.drill ||
  !!s.playingTake ||
  !!s.playingReading ||
  !!s.paceGap ||
  s.practicing ||
  s.settingsOpen ||
  s.statsOpen ||
  s.wizardOpen ||
  s.newsOpen ||
  s.feedbackOpen ||
  !!s.linkImport ||
  (s.updateNotice && s.update.state !== "idle") ||
  !!s.updatedTo;

// For this run of the app (the card outlives a change of interface language, which draws everything again).
/** Practice days before today, once loaded. */
let before: number | null = null;
/** The card has come up: guide.tips has it now, but it comes back at quiet moments until answered or closed. */
let cameUp = false;
/** Answered or closed. */
let finished = false;

/**
 * One question, once, after a few days of practice (lib/ask.ts): it waits for a break (nothing
 * playing or being recorded and no key or click for a while), steps aside as soon as practice
 * goes on, and sends the answer with the version, system and interface language only (no diagnostics).
 */
export function AskCard() {
  const askedBefore = useApp((s) => s.guide.tips.includes(ASK_TIP)) && !cameUp;
  const todayMs = useApp((s) => s.todayMs);
  const away = useApp(busy);
  // A tip above the deck: comes up only after it, but doesn't hide the card once it's there.
  const hint = useApp((s) => !!s.hint);
  const [days, setDays] = useState(before);
  const [shown, setShown] = useState(cameUp && !finished);
  const [done, setDone] = useState(finished);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (askedBefore || days !== null) return;
    void api.practice.log({}).then((sessions) => setDays((before = daysBefore(byDay(sessions), Date.now()))));
  }, [askedBefore, days]);

  const count = askDays(days ?? 0, todayMs);
  const wanted = !done && (cameUp || (days !== null && shouldAsk(askedBefore, count)));

  // Comes up after a quiet stretch; goes away as soon as practice starts, and waits for the next one.
  useEffect(() => {
    if (!wanted) return;
    if (away) {
      setShown(false);
      return;
    }
    if (shown || hint) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setShown(true);
        if (cameUp) return;
        cameUp = true;
        const { guide, saveGuide } = useApp.getState();
        saveGuide({ tips: [...guide.tips, ASK_TIP] });
      }, QUIET_MS);
    };
    arm();
    window.addEventListener("keydown", arm, true);
    window.addEventListener("pointerdown", arm, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", arm, true);
      window.removeEventListener("pointerdown", arm, true);
    };
  }, [wanted, away, shown, hint]);

  useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => setDone(true), 2500);
    return () => window.clearTimeout(timer);
  }, [sent]);

  if (done || !shown || away) return null;

  const close = () => {
    finished = true;
    setDone(true);
  };
  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.feedback.send({ kind: ASK_KIND, message, diagnostics: false });
      finished = true;
      setSent(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div role="dialog" aria-label={t("意见反馈")} className="fixed top-[56px] right-3 z-20 w-[300px] animate-pop-in rounded-[12px] bg-raised p-4 text-[13px] shadow-lift">
      {sent ? (
        <p className="pr-6">{t("收到了，谢谢！")}</p>
      ) : (
        <>
          <IconButton title={t("关闭")} className="absolute top-2 right-2" onClick={close}>
            <X />
          </IconButton>
          <h3 className="pr-6 font-semibold">{t("练了 {n} 天，哪里最不顺手？", { n: count })}</h3>
          <p className="mt-0.5 text-[12px] text-faint">{t("一句话就好，最想要的功能也可以写。")}</p>
          <textarea
            value={draft}
            rows={3}
            maxLength={4000}
            aria-label={t("哪里最不顺手")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isMod(e) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            className={`${fieldClass} mt-3 h-auto resize-none py-2 leading-relaxed`}
          />
          {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
          <p className="mt-1.5 text-[11px] text-faint">{t("会和版本号、系统、界面语言一起发给开发者。")}</p>
          <div className="mt-3 flex justify-end gap-2">
            <Button onClick={close}>{t("不了")}</Button>
            <Button primary disabled={!draft.trim() || sending} onClick={() => void send()}>
              {sending ? t("正在发送…") : t("发送")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
