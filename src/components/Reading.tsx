import { AlertCircle, BookOpenText, LoaderCircle, Pause, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDismiss } from "../hooks/useDismiss";
import { t, tk } from "../lib/i18n";
import { shortcut } from "../lib/platform";
import { readingHow, readingRange, readingsFor, type ReadingHow, type ReadingScope } from "../lib/readings";
import { drillNote } from "../lib/rounds";
import { sectionIndexOf, sectionName, sectionsOf } from "../lib/sections";
import { sentenceIndexAt } from "../lib/sentences";
import { useApp } from "../store";
import { RoundsInput } from "./Drill";
import { Button, fillNodes, IconButton, Kbd } from "./ui";

const MODES: { mode: ReadingHow; label: string; note: string }[] = [
  { mode: "read", label: tk("自己读"), note: tk("不放原文，你按自己的速度读；停顿一下，高亮就跳到下一句。") },
  { mode: "shadow", label: tk("跟着原文读"), note: tk("原文一直往下放，你跟着读（不戴耳机也可以，录进来的原文会被去掉）。") },
  // The line depends on 每句几遍: drillNote.
  { mode: "drill", label: tk("逐句跟读"), note: "" },
];

/**
 * Under the list header: why a paragraph recording didn't start or wasn't kept
 * (the mic, or nothing heard). Nothing else shows it then — the live bar is
 * gone and no reading is open.
 */
export function ReadingProblem() {
  const error = useApp((s) => (!s.live && !s.shownReading ? s.readingError : null));
  if (!error) return null;
  return (
    <div className="mx-auto flex w-full max-w-[760px] animate-fade items-start gap-2 pr-8 pb-2.5 pl-10 text-[12px] text-danger">
      <AlertCircle size={14} className="mt-[5px] shrink-0" />
      <span className="min-w-0 py-1 break-words">{error}</span>
      <IconButton title={t("知道了")} onClick={() => useApp.getState().showReading(null)} className="ml-auto !h-6 !min-w-6 shrink-0">
        <X />
      </IconButton>
    </div>
  );
}

/** In the list header: start reading a whole paragraph (or the text), with how and how much. */
export function ReadingButton() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root);
  const busy = useApp((s) => !!s.live || !!s.rec || !!s.drill);
  return (
    <div ref={root} className="relative">
      <IconButton title={t("整段录音 ({key})", { key: shortcut("⇧M") })} active={open} disabled={busy} onClick={() => setOpen(!open)}>
        <BookOpenText />
      </IconButton>
      {open && <ReadingMenu onClose={() => setOpen(false)} />}
    </div>
  );
}

function ReadingMenu({ onClose }: { onClose: () => void }) {
  const mode = useApp((s) => readingHow(s.settings));
  const note = useApp((s) => (mode === "drill" ? drillNote(s.settings.recordMode, s.settings.drillRounds) : t(MODES.find((m) => m.mode === mode)?.note ?? "")));
  const sections = useApp((s) => sectionsOf(s.transcript));
  const count = useApp((s) => s.transcript?.sentences.length ?? 0);
  const here = useApp((s) => s.loopSentence ?? Math.max(0, sentenceIndexAt(s.transcript?.sentences ?? [], s.time)));
  const [scope, setScope] = useState<ReadingScope>(sections.length > 1 ? "section" : "all");
  const [first, end] = readingRange(scope, sections, here, count);
  const past = useApp((s) => {
    const list = s.transcript?.sentences;
    return list?.[first] && list[end - 1] ? readingsFor(s.readings, list[first].start, list[end - 1].end).length : 0;
  });
  const { startReading, setParagraphMode, showReading } = useApp.getState();
  const latest = () => {
    const s = useApp.getState();
    const list = s.transcript!.sentences;
    return readingsFor(s.readings, list[first].start, list[end - 1].end).at(-1);
  };
  return (
    <div className="absolute top-full right-0 z-20 mt-1.5 w-[320px] origin-top-right animate-pop-in rounded-[12px] bg-raised p-3 text-[13px] shadow-lift">
      <p className="font-heading text-[14px] font-semibold">{t("整段录音")}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{t("读一整段，系统按句子分开保存，读完逐句对比。")}</p>
      {sections.length > 1 && (
        <Choice
          label={t("读哪些")}
          value={scope}
          options={[
            ["section", sectionName(sections, sectionIndexOf(sections, here))],
            ["all", t("全文")],
          ]}
          onChange={(v) => setScope(v as ReadingScope)}
        />
      )}
      <Choice label={t("怎么读")} value={mode} options={MODES.map((m) => [m.mode, t(m.label)])} onChange={(v) => setParagraphMode(v as ReadingHow)} />
      {mode === "drill" && (
        <div className="mt-2.5 flex items-start gap-2">
          <span className="mt-2 w-12 shrink-0 text-[12px] text-muted">{t("每句")}</span>
          <RoundsInput />
        </div>
      )}
      <p className="mt-1.5 text-[12px] leading-relaxed text-faint">{note}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          primary
          className="h-8 flex-1"
          onClick={() => {
            onClose();
            void startReading({ scope });
          }}
        >
          <span className="size-2 rounded-full bg-danger" />
          {t("开始录 {n} 句", { n: end - first })}
        </Button>
        {past > 0 && mode !== "drill" && (
          <Button
            className="h-8"
            title={t("看上次的整段录音")}
            onClick={() => {
              onClose();
              const r = latest();
              if (r) showReading(r.id);
            }}
          >
            {t("上次的")}
          </Button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-faint">
        {t("快捷键")} <Kbd>⇧</Kbd> <Kbd>M</Kbd>
      </p>
    </div>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <span className="w-12 shrink-0 text-[12px] text-muted">{label}</span>
      <div className="tint flex min-h-7 min-w-0 flex-1 rounded-[8px] p-0.5" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`min-w-0 flex-1 rounded-[6px] px-2 py-1 text-[12px] leading-tight font-medium transition-[background-color,color] duration-150 ${
              value === v ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
            }`}
          >
            <span className="line-clamp-2 break-words">{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Takes the list header's place while a paragraph is being read. */
export function LiveReadingBar() {
  const live = useApp((s) => s.live);
  const { finishReading, cancelReading } = useApp.getState();
  const paused = live?.pausedAt != null;
  const ticking = useClock(live?.phase === "reading" && !paused ? live.startedAt : null);
  if (!live) return null;
  const reading = live.phase === "reading";
  // Paused, the clock stands where it was (going on, it leaves the pause out).
  const secs = live.pausedAt !== null ? (live.pausedAt - live.startedAt) / 1000 : ticking;
  const label = live.mode === "read" ? t("自己读") : t("跟着原文读");
  const at = live.mode === "read" ? live.current : null;
  return (
    <div className="mx-auto w-full max-w-[760px] pr-8 pl-10">
      <div className="flex h-10 items-center gap-3 text-[13px]">
        {live.phase === "starting" || live.phase === "saving" ? (
          <span className="flex items-center gap-2 text-muted">
            <LoaderCircle size={14} className="animate-spin" />
            {live.phase === "starting" ? t("正在打开麦克风…") : live.mode === "shadow" ? t("正在去掉录进来的原文，按句子分开…") : t("正在按句子分开…")}
          </span>
        ) : (
          <>
            <span className="flex shrink-0 items-center gap-1.5 font-medium text-fg" title={paused ? t("按底部的播放键继续") : undefined}>
              {paused ? (
                <Pause size={12} fill="currentColor" strokeWidth={0} />
              ) : (
                <span className="relative grid size-2.5 place-items-center">
                  <span className="absolute size-2.5 rounded-full bg-danger/25" />
                  <span className="size-2 rounded-full bg-danger" />
                </span>
              )}
              {paused ? `${label} · ${t("已暂停")}` : label}
            </span>
            {at !== null && (
              <span className="tabular shrink-0 text-[12px] text-muted">
                {fillNodes(t("第 {n} / {total} 句", { total: live.end - live.first }), { n: <span className="font-mono text-fg">{at - live.first + 1}</span> })}
              </span>
            )}
            <Meter levels={live.levels} />
            <span className="tabular w-10 shrink-0 text-right font-mono text-[12px] text-fg">{fmt(secs)}</span>
            <Button className="h-7 px-2.5" title={t("读完了 (空格)")} onClick={() => void finishReading()}>
              <Square size={10} fill="currentColor" strokeWidth={0} /> {t("读完了")}
            </Button>
            <button className="shrink-0 text-[12px] text-faint hover:text-fg" onClick={cancelReading}>
              {t("取消")}
            </button>
          </>
        )}
      </div>
      {reading && (
        <p className="-mt-1 pb-1.5 text-[12px] text-faint">
          {live.mode === "read" ? (
            <>
              {t("停顿一下就跳到下一句，读完最后一句会自动结束")} · {t("高亮不对时按")} <Kbd>[</Kbd> <Kbd>]</Kbd> · <EndKeys />
            </>
          ) : (
            <>
              {t("原文放完、你停下就结束")} · <EndKeys />
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** "Space to finish · Esc to cancel", the keys where the language puts them. */
function EndKeys() {
  return (
    <>
      {fillNodes(t("{key} 结束"), { key: <Kbd>{t("空格")}</Kbd> })} · {fillNodes(t("{key} 取消"), { key: <Kbd>Esc</Kbd> })}
    </>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Seconds since `from` (ms), ticking. */
function useClock(from: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (from === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [from]);
  return from === null ? 0 : Math.max(0, (now - from) / 1000);
}

function Meter({ levels }: { levels: number[] }) {
  const n = 32;
  const bars = [...Array(Math.max(0, n - levels.length)).fill(0), ...levels.slice(-n)] as number[];
  return (
    <span className="flex h-6 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
      {bars.map((v, i) => (
        <span key={i} className="min-w-0 flex-1 rounded-full bg-fg/70" style={{ height: `${Math.max(8, Math.min(1, v * 1.15) ** 2 * 100)}%`, opacity: v < 0.05 ? 0.25 : 1 }} />
      ))}
    </span>
  );
}
