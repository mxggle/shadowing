import { Columns2, EyeOff, Maximize2, Rows2 } from "lucide-react";
import type { ReactNode } from "react";
import { useStageWide } from "../hooks/useStageWide";
import type { PictureLayout } from "../lib/api";
import { t, tk } from "../lib/i18n";
import { layoutShown } from "../lib/picture";
import { useApp } from "../store";
import { useKeys } from "../hooks/useKeys";

/** The playback menu's rows for a video (PlaybackMenu.tsx): where the picture goes, and the subtitle mask. */
export function PictureMenu() {
  const key = useKeys();
  const video = useApp((s) => s.current?.kind === "video");
  if (!video) return null;
  return (
    <>
      <MenuRow label={t("画面")} hint={t("{key} 键轮换", { key: key("picture") })}>
        <PlacePicker />
      </MenuRow>
      <MenuRow label={t("遮字幕")} hint={t("盖住画面里烧录的字幕")}>
        <MaskPicker />
      </MenuRow>
    </>
  );
}

/** Laid out like the menu's other rows. */
function MenuRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2.5 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="mt-px text-[11px] text-faint">{hint}</div>
      </div>
      <div className="w-[124px] shrink-0">{children}</div>
    </div>
  );
}

type Place = PictureLayout | "hidden";

const PLACES: { value: Place; icon: typeof Rows2; label: string }[] = [
  { value: "stack", icon: Rows2, label: tk("画面在上") },
  { value: "side", icon: Columns2, label: tk("并排") },
  { value: "theater", icon: Maximize2, label: tk("影院") },
  { value: "hidden", icon: EyeOff, label: tk("不显示画面，只听") },
];

function PlacePicker() {
  const wide = useStageWide();
  const place = useApp((s): Place => (s.settings.pictureHidden ? "hidden" : layoutShown(s.settings.pictureLayout, wide)));
  const { setPictureLayout, setPictureHidden } = useApp.getState();
  const pick = (value: Place) => {
    setPictureHidden(value === "hidden");
    if (value !== "hidden") setPictureLayout(value);
  };
  return (
    <Choices
      label={t("画面")}
      choices={PLACES.map(({ value, icon: Icon, label }) => ({
        selected: place === value,
        disabled: value === "side" && !wide,
        title: value === "side" && !wide ? t("{label}（窗口太窄）", { label: t(label) }) : t(label),
        onPick: () => pick(value),
        content: <Icon size={15} strokeWidth={1.75} aria-label={t(label)} />,
      }))}
    />
  );
}

function MaskPicker() {
  const on = useApp((s) => s.settings.pictureMask);
  const hidden = useApp((s) => s.settings.pictureHidden);
  const setMask = useApp((s) => s.setPictureMask);
  return (
    <Choices
      label={t("遮字幕")}
      choices={[false, true].map((value) => ({
        selected: on === value,
        disabled: hidden,
        title: value ? t("用一条模糊的带子盖住画面里的字幕；在画面上拖它调整") : t("不遮"),
        onPick: () => setMask(value),
        content: value ? t("遮住") : t("不遮"),
      }))}
    />
  );
}

/** A row of choices, one selected (the menu's segmented look). */
function Choices({ label, choices }: { label: string; choices: { selected: boolean; disabled?: boolean; title: string; onPick: () => void; content: ReactNode }[] }) {
  return (
    <div className="tint flex rounded-[10px] p-[3px]" role="radiogroup" aria-label={label}>
      {choices.map((c, i) => (
        <button
          key={i}
          role="radio"
          aria-checked={c.selected}
          disabled={c.disabled}
          title={c.title}
          onClick={c.onPick}
          className={`grid h-[26px] flex-1 place-items-center rounded-[7px] text-[12px] transition-[background-color,color,box-shadow] duration-150 disabled:opacity-35 ${
            c.selected ? "bg-raised font-medium text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg"
          }`}
        >
          {c.content}
        </button>
      ))}
    </div>
  );
}
