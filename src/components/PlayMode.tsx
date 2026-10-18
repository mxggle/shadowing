import { ArrowRightToLine, ListOrdered, Repeat, Repeat1, type LucideIcon } from "lucide-react";
import { PLAY_MODES, type PlayMode } from "../audio/logic";
import { t } from "../lib/i18n";
import { useApp } from "../store";

/** A function, not a constant: the wording follows the language (see lib/i18n.ts). */
export const playModeLook = (): Record<PlayMode, { icon: LucideIcon; label: string; hint: string }> => ({
  next: { icon: ListOrdered, label: t("顺序播放", "Play in order"), hint: t("播完自动下一个，最后一个播完停下", "Plays the next track automatically, and stops after the last") },
  list: {
    icon: Repeat,
    label: t("列表循环", "Repeat all"),
    hint: t("播完自动下一个，最后一个播完回到第一个", "Plays the next track automatically, and the last one goes back to the first"),
  },
  one: { icon: Repeat1, label: t("单曲循环", "Repeat one"), hint: t("当前音频播完从头再放", "Plays the current track again from the start") },
  once: { icon: ArrowRightToLine, label: t("播完停止", "Play once"), hint: t("当前音频播完就停下", "Stops when the current track ends") },
});

/** The four modes side by side, for the playback menu. */
export function PlayModePicker() {
  const mode = useApp((s) => s.settings.playMode);
  const setPlayMode = useApp((s) => s.setPlayMode);
  const looks = playModeLook();
  return (
    <div className="tint flex rounded-[10px] p-[3px]" role="radiogroup" aria-label={t("播放顺序", "Play order")}>
      {PLAY_MODES.map((m) => {
        const { icon: Icon, label, hint } = looks[m];
        const selected = m === mode;
        return (
          <button
            key={m}
            role="radio"
            aria-checked={selected}
            title={t(`${label}：${hint}`, `${label}: ${hint}`)}
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
