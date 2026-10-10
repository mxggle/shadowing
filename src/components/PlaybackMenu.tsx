import { SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { RATE_STEP, SEEK_STEP_MAX, SEEK_STEP_MIN } from "../audio/logic";
import { useDismiss } from "../hooks/useDismiss";
import { useApp } from "../store";
import { PLAY_MODE_LOOK, PlayModePicker } from "./PlayMode";
import { Stepper } from "./ui";

/** Speed button in the player bar; opens the playback settings (speed, jump step, play mode). */
export function PlaybackMenu() {
  const [open, setOpen] = useState(false);
  const rate = useApp((s) => s.settings.rate);
  const playMode = useApp((s) => s.settings.playMode);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root);

  return (
    <div ref={root} className="relative">
      <button
        title="播放设置：速度、跳转步长、播放顺序"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-muted transition-[background-color,color,scale] duration-150 ease-snappy hover:bg-hover hover:text-fg active:scale-[0.96] ${
          open ? "bg-press text-fg" : ""
        }`}
      >
        <span className={`tabular font-mono text-[12px] ${rate === 1 ? "" : "font-medium text-fg"}`}>{rate.toFixed(2)}×</span>
        <SlidersHorizontal size={14} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full z-20 mb-2.5 w-[288px] origin-bottom-right animate-pop-up divide-y divide-line rounded-[12px] bg-raised px-1 py-0.5 shadow-lift">
          <Row label="速度" hint="− / =">
            <RateControl />
          </Row>
          <Row label="跳转步长" hint="← / →">
            <SeekStepControl />
          </Row>
          <Row label="播放顺序" hint={`${PLAY_MODE_LOOK[playMode].label} · R`}>
            <PlayModePicker />
          </Row>
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
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

function RateControl() {
  const rate = useApp((s) => s.settings.rate);
  const setRate = useApp((s) => s.setRate);
  return (
    <Stepper
      decTitle="减速 (−)"
      incTitle="加速 (=)"
      decFlash="slower"
      incFlash="faster"
      onDec={() => (setRate(rate - RATE_STEP), useApp.getState().tip("rate"))}
      onInc={() => (setRate(rate + RATE_STEP), useApp.getState().tip("rate"))}
    >
      <button title="点击恢复 1.0×" onClick={() => setRate(1)} className="tabular h-7 w-full font-mono text-[12px] font-medium">
        {rate.toFixed(2)}×
      </button>
    </Stepper>
  );
}

/** Free-typed step in seconds; saved as you type, tidied up on blur. */
function SeekStepControl() {
  const seekStep = useApp((s) => s.settings.seekStep);
  const setSeekStep = useApp((s) => s.setSeekStep);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Stepper decTitle="减少 1 秒" incTitle="增加 1 秒" onDec={() => setSeekStep(seekStep - 1)} onInc={() => setSeekStep(seekStep + 1)}>
      <label title={`快退 / 快进的秒数（${SEEK_STEP_MIN}–${SEEK_STEP_MAX}）`} className="flex items-baseline">
        <input
          type="number"
          inputMode="numeric"
          min={SEEK_STEP_MIN}
          max={SEEK_STEP_MAX}
          step={1}
          value={draft ?? seekStep}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) setSeekStep(n);
          }}
          onBlur={() => setDraft(null)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
          className="tabular w-6 [appearance:textfield] rounded-[4px] bg-transparent text-right font-mono text-[12px] font-medium outline-none focus:bg-raised focus:ring-1 focus:ring-line-strong [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="ml-0.5 text-[11px] text-muted">秒</span>
      </label>
    </Stepper>
  );
}
