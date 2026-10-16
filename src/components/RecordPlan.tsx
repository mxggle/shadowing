import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDismiss } from "../hooks/useDismiss";
import { isPlain, planLabel, planOf } from "../lib/rounds";
import { useApp } from "../store";
import { Stepper } from "./ui";

/**
 * 跟读方案, next to 听完再说 / 边听边说 on the recorder card: how many times
 * the sentence plays first only to hear it, then how many times you say it in
 * a row (only the last is kept).
 */
export function PlanButton({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root);
  // M starts a take with the menu open: it's gone, not back once the take is.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const listens = useApp((s) => s.settings.recordListens);
  const repeats = useApp((s) => s.settings.recordRepeats);
  const plan = planOf(listens, repeats);
  return (
    <div ref={root} className="relative">
      <button
        title="跟读方案：先只听几遍，再连着跟读几遍（只保存最后一遍）"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`flex h-7 items-center gap-1 rounded-[8px] pr-1.5 pl-2.5 text-[12px] font-medium whitespace-nowrap transition-[background-color,color] duration-150 disabled:opacity-50 ${
          open ? "bg-press text-fg" : `tint hover:text-fg ${isPlain(plan) ? "text-muted" : "text-fg"}`
        }`}
      >
        <span className="tabular">{planLabel(plan)}</span>
        <ChevronDown size={12} strokeWidth={2} aria-hidden className={`opacity-55 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="跟读方案"
          className="absolute top-full left-0 z-20 mt-1.5 w-[264px] origin-top-left animate-pop-in rounded-[12px] bg-raised p-3 text-[13px] text-fg shadow-lift"
        >
          <p className="font-heading text-[14px] font-semibold">跟读方案</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">中间几遍只是练习，不保存：只留最后一遍的录音和对比。</p>
          <div className="mt-2.5 flex flex-col gap-2">
            <Count label="先只听" hint="只放原句，不录音" value={plan.listens} onChange={(listens) => useApp.getState().setRecordPlan({ listens })} />
            <Count label="跟读" hint="说完自动接下一遍" value={plan.repeats} onChange={(repeats) => useApp.getState().setRecordPlan({ repeats })} />
          </div>
        </div>
      )}
    </div>
  );
}

function Count({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        <div className="mt-px text-[11px] text-faint">{hint}</div>
      </div>
      <div className="w-[112px] shrink-0">
        <Stepper decTitle={`${label}少一遍`} incTitle={`${label}多一遍`} onDec={() => onChange(value - 1)} onInc={() => onChange(value + 1)}>
          <span className="tabular font-mono text-[13px] font-medium">{value}</span>
          <span className="ml-1 text-[12px] text-muted">遍</span>
        </Stepper>
      </div>
    </div>
  );
}
