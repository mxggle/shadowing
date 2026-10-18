import { ChevronLeft, ChevronRight, Play, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { Reading, ReadingWhat } from "../lib/api";
import { t } from "../lib/i18n";
import { readingNote, readingsFor, saidCount, scopeOf } from "../lib/readings";
import { sentenceIndexAt } from "../lib/sentences";
import { whenRecorded } from "../lib/takes";
import { useApp } from "../store";
import { Button, fillNodes, IconButton } from "./ui";

/**
 * A paragraph once it's been read, folded into the script: this line above its
 * first sentence says how it went and plays it back — all of you, or sentence
 * by sentence against the original. The sentence playing opens up to show its
 * take (`TakePeek`), like the current line of lyrics.
 */
export function ReadingBar({ reading }: { reading: Reading }) {
  const all = useApp((s) => s.readings);
  const others = useMemo(() => readingsFor(all, reading.start, reading.end), [all, reading.start, reading.end]);
  const playing = useApp((s) => (s.playingReading?.id === reading.id ? s.playingReading : null));
  const error = useApp((s) => s.readingError);
  const { playReading, stopReadingPlayback, pausePlayingReading, deleteReading, showReading, startReading } = useApp.getState();
  const toggle = (what: ReadingWhat) =>
    playing?.what !== what ? void playReading(reading.id, what) : playing.paused ? pausePlayingReading(false) : stopReadingPlayback();
  const i = others.findIndex((r) => r.id === reading.id);
  const said = saidCount(reading);
  const first = useApp((s) => sentenceIndexAt(s.transcript?.sentences ?? [], reading.parts[0]?.start + 0.01));
  const scope = useApp((s) => scopeOf(reading, s.transcript?.sentences ?? []));
  const bar = useRef<HTMLDivElement>(null);
  // Just read (the list followed you to the end) or picked from the menu: bring it into view.
  useEffect(() => {
    bar.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [reading.id]);
  return (
    <div ref={bar} className="mt-1 mb-1 scroll-mt-2 animate-fade pr-1.5 pl-2 text-[12px] text-faint">
      <div className="flex h-7 items-center gap-2">
        <span className="font-heading text-[13px] font-semibold text-fg">{reading.mode === "read" ? t("整段朗读") : t("整段跟读")}</span>
        <span className="min-w-0 truncate">
          {said < reading.parts.length ? t("{said} / {total} 句", { said, total: reading.parts.length }) : t("{n} 句", { n: said })}
          {readingNote(reading) && ` · ${readingNote(reading)}`}
        </span>
        <span className="h-px min-w-4 flex-1 bg-line" />
        {others.length > 1 ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <IconButton title={t("上一次")} disabled={i <= 0} onClick={() => showReading(others[i - 1].id)} className="!h-6 !min-w-6">
              <ChevronLeft />
            </IconButton>
            <span className="tabular whitespace-nowrap">
              {fillNodes(t("第 {n} / {total} 次", { total: others.length }), { n: <span className="font-mono text-muted">{i + 1}</span> })} · {whenRecorded(reading.created)}
            </span>
            <IconButton title={t("下一次")} disabled={i >= others.length - 1} onClick={() => showReading(others[i + 1].id)} className="!h-6 !min-w-6">
              <ChevronRight />
            </IconButton>
          </span>
        ) : (
          <span className="shrink-0">{whenRecorded(reading.created)}</span>
        )}
        <IconButton title={t("收起 (Esc)")} onClick={() => showReading(null)} className="!h-6 !min-w-6">
          <X />
        </IconButton>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <PlayButton active={playing?.what === "turns"} paused={playing?.paused} onClick={() => toggle("turns")} title={t("每句先放原文，再放你的")}>
          {t("逐句对比")}
        </PlayButton>
        <PlayButton active={playing?.what === "mine"} paused={playing?.paused} onClick={() => toggle("mine")} title={t("从头到尾听你读的")}>
          {t("我的整段")}
        </PlayButton>
        {reading.mode === "shadow" && (
          <PlayButton active={playing?.what === "together"} paused={playing?.paused} onClick={() => toggle("together")} title={t("原文和你一起放，听合不合拍")}>
            {t("一起听")}
          </PlayButton>
        )}
        {playing?.paused && <span>{t("已暂停")}</span>}
        <span className="ml-auto flex items-center gap-1">
          <IconButton title={t("删除这次整段录音（连同分出来的每句）")} onClick={() => void deleteReading(reading.id)}>
            <Trash2 />
          </IconButton>
          <Button className="h-7 px-2.5" title={t("再读一遍 (⇧M)")} onClick={() => void startReading({ mode: reading.mode, at: first, scope })}>
            <span className="size-2 rounded-full bg-danger" />
            {t("再读一遍")}
          </Button>
        </span>
      </div>
      {error && <p className="mt-1 text-danger">{error}</p>}
    </div>
  );
}

function PlayButton({ active, paused = false, onClick, title, children }: { active: boolean; paused?: boolean; onClick: () => void; title: string; children: string }) {
  return (
    <Button title={title} aria-pressed={active} onClick={onClick} className={`h-7 px-2.5 ${active ? "!bg-press" : ""}`}>
      {active && !paused ? <Square size={9} fill="currentColor" strokeWidth={0} /> : <Play size={10} fill="currentColor" strokeWidth={0} />}
      {children}
    </Button>
  );
}
