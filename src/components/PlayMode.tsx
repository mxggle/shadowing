import { ArrowRightToLine, ListOrdered, Repeat, Repeat1, type LucideIcon } from "lucide-react";
import { PLAY_MODES, type PlayMode } from "../audio/logic";
import { t, tk } from "../lib/i18n";
import { useApp } from "../store";

/** Labels and hints are keys: show them with t(). */
export const PLAY_MODE_LOOK: Record<PlayMode, { icon: LucideIcon; label: string; hint: string }> = {
  next: { icon: ListOrdered, label: tk("顺序播放"), hint: tk("播完自动下一个，最后一个播完停下") },
  list: { icon: Repeat, label: tk("列表循环"), hint: tk("播完自动下一个，最后一个播完回到第一个") },
  one: { icon: Repeat1, label: tk("单曲循环"), hint: tk("当前音频播完从头再放") },
  once: { icon: ArrowRightToLine, label: tk("播完停止"), hint: tk("当前音频播完就停下") },
};

/** The four modes side by side, for the playback menu. */
export function PlayModePicker() {
  const mode = useApp((s) => s.settings.playMode);
  const setPlayMode = useApp((s) => s.setPlayMode);
  return (
    <div className="tint flex rounded-[10px] p-[3px]" role="radiogroup" aria-label={t("播放顺序")}>
      {PLAY_MODES.map((m) => {
        const { icon: Icon, label, hint } = PLAY_MODE_LOOK[m];
        const selected = m === mode;
        return (
          <button
            key={m}
            role="radio"
            aria-checked={selected}
            title={t("{label}：{hint}", { label: t(label), hint: t(hint) })}
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
