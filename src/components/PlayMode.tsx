import { ArrowRightToLine, ListOrdered, Repeat, Repeat1, type LucideIcon } from "lucide-react";
import { nextPlayMode, PLAY_MODES, type PlayMode } from "../audio/logic";
import { useFlash } from "../hooks/useFlash";
import { useApp } from "../store";

export const PLAY_MODE_LOOK: Record<PlayMode, { icon: LucideIcon; label: string; hint: string }> = {
  next: { icon: ListOrdered, label: "顺序播放", hint: "播完自动下一个，最后一个播完停下" },
  list: { icon: Repeat, label: "列表循环", hint: "播完自动下一个，最后一个播完回到第一个" },
  one: { icon: Repeat1, label: "单曲循环", hint: "当前音频播完从头再放" },
  once: { icon: ArrowRightToLine, label: "播完停止", hint: "当前音频播完就停下" },
};

/**
 * Deck button that walks the play modes, like a music player's repeat key.
 * Pressed look (not orange: orange is only for A–B / sentence loops) when it isn't plain "in order".
 */
export function PlayModeButton() {
  const mode = useApp((s) => s.settings.playMode);
  const setPlayMode = useApp((s) => s.setPlayMode);
  const flashing = useFlash("playMode");
  const { icon: Icon, label, hint } = PLAY_MODE_LOOK[mode];
  const next = PLAY_MODE_LOOK[nextPlayMode(mode)].label;
  const on = mode !== "next";
  return (
    <button
      title={`${label}：${hint}\n点击切换到「${next}」(R)`}
      aria-label={`播放顺序：${label}`}
      onClick={() => setPlayMode(nextPlayMode(mode))}
      data-flash={flashing || undefined}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[12px] transition-[background-color,color,scale] duration-150 ease-snappy active:scale-[0.96] data-[flash]:scale-[0.96] ${
        on ? "bg-press font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg"
      }`}
    >
      <Icon size={16} strokeWidth={1.8} />
      <span className="hidden whitespace-nowrap @[820px]:inline">{label}</span>
    </button>
  );
}

/** The four modes side by side, for the playback menu. */
export function PlayModePicker() {
  const mode = useApp((s) => s.settings.playMode);
  const setPlayMode = useApp((s) => s.setPlayMode);
  return (
    <div className="tint flex rounded-[10px] p-[3px]" role="radiogroup" aria-label="播放顺序">
      {PLAY_MODES.map((m) => {
        const { icon: Icon, label, hint } = PLAY_MODE_LOOK[m];
        const selected = m === mode;
        return (
          <button
            key={m}
            role="radio"
            aria-checked={selected}
            title={`${label}：${hint}`}
            onClick={() => setPlayMode(m)}
            className={`grid h-[26px] flex-1 place-items-center rounded-[7px] transition-[background-color,color,box-shadow] duration-150 ${
              selected ? "bg-raised text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
            }`}
          >
            <Icon size={16} strokeWidth={1.7} />
          </button>
        );
      })}
    </div>
  );
}
