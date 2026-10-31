import { BookMarked, Check, Play, Star, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useKeys } from "../hooks/useKeys";
import { dueList, dueNote, sentenceFor, type BookEntry } from "../lib/book";
import { barWidth, hideModeOf, textShown } from "../lib/hide";
import { t } from "../lib/i18n";
import { fileStem } from "../lib/paths";
import { dayKey } from "../lib/practice";
import { formatTime } from "../lib/time";
import { useApp } from "../store";
import { HiddenLine, HideTextButton } from "./HideText";
import { RecorderCard } from "./Recorder";
import { Button, IconButton, Kbd } from "./ui";

/** A sentence row's ☆: in 句子本 it stays lit; recorded three times or more, it asks. */
export function BookStar({ index, inBook, takes }: { index: number; inBook: boolean; takes: number }) {
  const key = useKeys()("book");
  const asks = !inBook && takes >= 3;
  return (
    <button
      title={inBook ? t("从句子本拿掉 ({key})", { key }) : asks ? t("这句录了 {n} 次，加进句子本？({key})", { n: takes, key }) : t("加进句子本，明天再来跟读 ({key})", { key })}
      aria-pressed={inBook}
      onClick={() => useApp.getState().toggleBook(index)}
      className={`grid size-[28px] place-items-center rounded-[8px] transition-[opacity,background-color,color,scale] duration-150 hover:bg-hover active:scale-90 ${
        inBook ? "text-fg" : asks ? "text-faint opacity-70 hover:text-fg hover:opacity-100" : "text-muted opacity-0 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
      }`}
    >
      <Star size={14} strokeWidth={2.1} fill={inBook ? "currentColor" : "none"} />
    </button>
  );
}

/** The shelf's way in: 句子本, and how many are due today. */
export function BookShelfRow() {
  const due = useApp((s) => dueList(s.book, dayKey(Date.now())).length);
  const total = useApp((s) => s.book.length);
  const open = useApp((s) => s.bookOpen);
  if (total === 0) return null;
  return (
    <div className="shrink-0 border-t border-line px-2.5 py-2">
      <button
        onClick={() => useApp.getState().setBookOpen(!open)}
        aria-pressed={open}
        title={t("卡住过的句子，明天、7 天后、30 天后各再跟读一遍")}
        className={`flex h-[30px] w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px] transition-colors duration-150 ${open ? "bg-press font-medium text-fg" : "text-fg/80 hover:bg-hover hover:text-fg"}`}
      >
        <BookMarked size={14} strokeWidth={1.9} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("句子本")}</span>
        <span className="tabular shrink-0 font-mono text-[11px] text-faint">{due > 0 ? t("今天 {n}", { n: due }) : total}</span>
      </button>
    </div>
  );
}

/**
 * 句子本 in place of the sentences: today's (and missed days') sentences, or all of them. One is
 * shadowed at a time: its audio opens and the sentence loops, with 跟读停顿 and 藏字幕 as set;
 * 过了 (]) brings it back later, 还卡着 tomorrow.
 */
export function BookView() {
  const book = useApp((s) => s.book);
  const at = useApp((s) => s.bookAt);
  const [all, setAll] = useState(false);
  const today = dayKey(Date.now());
  const due = useMemo(() => dueList(book, today), [book, today]);
  const shown = all ? [...book].sort((a, b) => (a.due || "9").localeCompare(b.due || "9")) : due;
  const { setBookOpen, reviewEntry } = useApp.getState();

  return (
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-8 pt-6 pb-12">
        <header className="flex items-start gap-3 pl-2">
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-[26px] leading-tight font-semibold">{t("句子本")}</h1>
            <p className="mt-1.5 text-[12px] text-muted">{t("卡住过的句子，明天、7 天后、30 天后各再跟读一遍。")}</p>
          </div>
          <IconButton title={t("回到原文")} onClick={() => setBookOpen(false)}>
            <X />
          </IconButton>
        </header>
        <div className="mt-4 flex items-center justify-between gap-3 border-b border-line pb-3 pl-2">
          <div role="radiogroup" aria-label={t("哪些句子")} className="tint flex rounded-[10px] p-[3px]">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                role="radio"
                aria-checked={all === v}
                onClick={() => setAll(v)}
                className={`h-[24px] rounded-[7px] px-2.5 text-[12px] transition-[background-color,color,box-shadow] duration-150 ${all === v ? "bg-raised font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"}`}
              >
                {v ? t("全部") : t("今天")} <span className="tabular font-mono">{v ? book.length : due.length}</span>
              </button>
            ))}
          </div>
          <span className="flex items-center gap-2">
            {!all && due.length > 0 && !at && (
              <Button primary onClick={() => reviewEntry(due[0].id)}>
                <Play size={11} fill="currentColor" strokeWidth={0} /> {t("开始跟读")}
              </Button>
            )}
            <HideTextButton />
          </span>
        </div>
        {shown.length === 0 ? (
          <p className="mt-8 pl-2 text-[13px] leading-relaxed text-muted">
            {all ? t("还没有句子。") : t("今天没有要再跟读的句子。")}
            <br />
            <span className="text-faint">{t("在原文里把鼠标移到一句上点 ☆（或按 B），第二天它就会出现在这里。")}</span>
          </p>
        ) : (
          <ol className="mt-1.5">
            {shown.map((e) => (
              <EntryRow key={e.id} entry={e} current={e.id === at} today={today} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** One sentence of the book: what it says (unless hidden), where it's from and when it comes back. */
function EntryRow({ entry, current, today }: { entry: BookEntry; current: boolean; today: string }) {
  const track = useApp((s) => s.folder?.tracks.find((x) => x.path === entry.audio));
  // While it's the one being shadowed, its sentence in the open audio (for 藏字幕 and recording).
  const index = useApp((s) => (current && s.current?.path === entry.audio ? sentenceFor(s.transcript?.sentences ?? [], entry) : -1));
  const shown = useApp((s) => {
    const mode = hideModeOf(s.settings.hideText);
    if (!current || index < 0) return mode === "show";
    return textShown(mode, index, { active: index, revealed: s.revealed, peek: s.peek, heard: s.heard });
  });
  const recording = useApp((s) => index >= 0 && s.recordAt === index);
  const key = useKeys();
  const { reviewEntry, reviewDone, removeEntry, startTake } = useApp.getState();
  const done = entry.due === "";
  const due = !done && entry.due <= today;

  return (
    <li className={`group mt-0.5 grid grid-cols-[2rem_1fr_auto] items-start gap-x-2 rounded-[12px] py-2.5 pr-2 transition-colors duration-200 ${current ? "bg-hover" : "hover:bg-hover/60"}`}>
      <span className="grid h-[30px] place-items-center">
        {done ? <Check size={14} strokeWidth={2.4} className="text-ok" /> : <span className={`size-[7px] rounded-full ${current ? "bg-fg" : due ? "shadow-[inset_0_0_0_1px_var(--line-strong)]" : "bg-track"}`} />}
      </span>
      <div className="min-w-0">
        {shown || index < 0 ? (
          shown ? (
            <button onClick={() => track && reviewEntry(entry.id)} disabled={!track} className="block w-full cursor-text text-left font-script text-[18px] leading-[30px] break-words text-fg disabled:text-muted">
              {entry.text}
            </button>
          ) : (
            <button onClick={() => track && reviewEntry(entry.id)} disabled={!track} className="flex h-[30px] w-full items-center font-script text-[18px]" title={t("开始跟读这一句")}>
              <span className="block h-2.5 max-w-full rounded-full bg-track" style={{ width: `${barWidth(entry.text)}em` }} />
            </button>
          )
        ) : (
          <HiddenLine index={index} text={entry.text} start={entry.start} end={entry.end} active />
        )}
        <p className="mt-0.5 text-[11px] text-faint">
          {track ? track.name : fileStem(entry.audio)} · <span className="tabular font-mono">{formatTime(entry.start)}</span>
          {!track && <> · {t("不在打开的文件夹里")}</>}
        </p>
        {current && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button onClick={() => reviewDone(false)} title={t("明天再来")}>
              {t("还卡着")}
            </Button>
            <Button onClick={() => reviewDone(true)} title={t("说得出来了：过一阵再来")}>
              {t("过了")} <Kbd>{key("nextSentence")}</Kbd>
            </Button>
            {index >= 0 && (
              <Button onClick={() => void startTake()} title={t("录一遍和原句对比 ({key})", { key: key("record") })}>
                {t("录一遍")} <Kbd>{key("record")}</Kbd>
              </Button>
            )}
          </div>
        )}
        {recording && (
          <div className="mt-2">
            <RecorderCard at={index} />
          </div>
        )}
      </div>
      <span className="flex h-[30px] items-center gap-1">
        <span className="text-[11px] whitespace-nowrap text-faint">{dueNote(entry, today)}</span>
        <IconButton title={t("从句子本拿掉")} onClick={() => removeEntry(entry.id)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
          <X />
        </IconButton>
      </span>
    </li>
  );
}
