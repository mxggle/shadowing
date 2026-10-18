import { useState } from "react";
import { t } from "../lib/i18n";
import { clampRounds, parseRounds, ROUNDS_MAX, ROUNDS_MIN } from "../lib/rounds";
import { useApp } from "../store";
import { Stepper } from "./ui";

/** 逐句跟读's 每句几遍: − / +, or typed (saved as you type; a number out of range says so and the last good one stays). */
export function RoundsInput() {
  const rounds = useApp((s) => clampRounds(s.settings.drillRounds));
  const { setDrillRounds } = useApp.getState();
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && parseRounds(draft) === null;
  const step = (by: number) => {
    setDraft(null);
    setDrillRounds(rounds + by);
  };
  return (
    <div className="min-w-0 flex-1">
      <Stepper decTitle={t("少一遍", "One fewer")} incTitle={t("多一遍", "One more")} onDec={() => step(-1)} onInc={() => step(1)}>
        <label title={t(`每句说几遍（${ROUNDS_MIN}–${ROUNDS_MAX}）`, `Times to say each sentence (${ROUNDS_MIN}–${ROUNDS_MAX})`)} className="flex items-baseline">
          <input
            type="number"
            inputMode="numeric"
            aria-label={t("每句几遍", "Times per sentence")}
            aria-invalid={bad}
            min={ROUNDS_MIN}
            max={ROUNDS_MAX}
            step={1}
            value={draft ?? rounds}
            onChange={(e) => {
              setDraft(e.target.value);
              const n = parseRounds(e.target.value);
              if (n !== null) setDrillRounds(n);
            }}
            onBlur={() => setDraft(null)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={`tabular w-7 [appearance:textfield] rounded-[4px] bg-transparent text-right font-mono text-[12px] font-medium outline-none focus:bg-raised focus:ring-1 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
              bad ? "text-danger ring-1 ring-danger" : "focus:ring-line-strong"
            }`}
          />
          <span className="ml-1 text-[11px] text-muted">{t("遍", "times")}</span>
        </label>
      </Stepper>
      {bad && (
        <p className="mt-1 text-[12px] text-danger">
          {t(`输入 ${ROUNDS_MIN} 到 ${ROUNDS_MAX} 之间的整数`, `Enter a whole number from ${ROUNDS_MIN} to ${ROUNDS_MAX}`)}
        </p>
      )}
    </div>
  );
}

/** Takes the list header's place while going through a paragraph sentence by sentence (the card under the sentence does the rest). */
export function DrillBar() {
  const drill = useApp((s) => s.drill);
  if (!drill) return null;
  return (
    <div className="mx-auto w-full max-w-[760px] pr-8 pl-10">
      <div className="flex h-10 items-center gap-3 text-[13px]">
        <span className="flex shrink-0 items-center gap-1.5 font-medium text-fg">
          <span className="relative grid size-2.5 place-items-center">
            <span className="absolute size-2.5 rounded-full bg-danger/25" />
            <span className="size-2 rounded-full bg-danger" />
          </span>
          {t("逐句跟读", "Sentence by sentence")}
        </span>
        <span className="tabular shrink-0 text-[12px] text-muted">
          {t(
            <>
              第 <span className="font-mono text-fg">{drill.current - drill.first + 1}</span> / {drill.end - drill.first} 句 · 每句{" "}
              <span className="font-mono">{drill.rounds}</span> 遍
            </>,
            <>
              Sentence <span className="font-mono text-fg">{drill.current - drill.first + 1}</span> / {drill.end - drill.first} ·{" "}
              <span className="font-mono">{drill.rounds}</span> {drill.rounds === 1 ? "time" : "times"} each
            </>,
          )}
        </span>
        <button
          title={t("停下 (Esc)：录好的句子都留着", "Stop (Esc): recorded sentences are kept")}
          className="ml-auto shrink-0 text-[12px] text-faint hover:text-fg"
          onClick={() => useApp.getState().cancelTake()}
        >
          {t("停下", "Stop")}
        </button>
      </div>
    </div>
  );
}
