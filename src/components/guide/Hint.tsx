import { X } from "lucide-react";
import { hintPieces } from "../../lib/hint";
import { t } from "../../lib/i18n";
import { useApp } from "../../store";

/** One-off tip floating just above the deck (see `tip()` and `nudge()` in guideSlice), with a button for a nudge that has one. */
export function Hint() {
  const hint = useApp((s) => s.hint);
  const action = useApp((s) => s.hintAction);
  if (!hint) return null;
  return (
    <div className="relative h-0">
      <div
        role="status"
        className="absolute bottom-3 left-1/2 z-10 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 animate-pop-up items-center gap-2.5 rounded-[10px] bg-ink py-1.5 pr-1.5 pl-3.5 text-[13px] text-on-ink shadow-lift"
      >
        <span>
          {hintPieces(hint).map((part, i) =>
            part.key ? (
              <kbd key={i} className="mx-px inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] bg-on-ink/15 px-1 font-sans text-[11px] font-medium">
                {part.text}
              </kbd>
            ) : (
              part.text
            ),
          )}
        </span>
        {action && (
          <button
            onClick={() => {
              action.run();
              useApp.getState().dismissHint();
            }}
            className="flex h-[26px] shrink-0 items-center gap-1 rounded-[7px] bg-on-ink/15 px-2.5 text-[12px] font-medium whitespace-nowrap transition-[background-color,scale] duration-150 hover:bg-on-ink/25 active:scale-[0.96]"
          >
            {action.label}
            {action.key && <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] bg-on-ink/15 px-1 font-sans text-[11px] font-medium">{action.key}</kbd>}
          </button>
        )}
        <button
          title={t("知道了")}
          onClick={() => useApp.getState().dismissHint()}
          className="grid size-6 shrink-0 place-items-center rounded-[6px] text-on-ink/60 transition-colors hover:bg-on-ink/10 hover:text-on-ink"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
