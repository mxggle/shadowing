import { Lightbulb, X } from "lucide-react";
import { useApp } from "../../store";

/** One-off tip floating just above the player bar (see `tip()` in guideSlice). */
export function Hint() {
  const hint = useApp((s) => s.hint);
  // Clear of the loop strip (h-11) that sits above the player bar while a loop is set.
  const lifted = useApp((s) => s.loop.a !== null && !!s.transcript?.sentences.length);
  if (!hint) return null;
  return (
    <div className="relative h-0">
      <div
        role="status"
        className={`absolute left-1/2 ${lifted ? "bottom-14" : "bottom-3"} z-10 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 animate-pop-in items-center gap-2 rounded-xl border border-line bg-elevated py-1.5 pr-1.5 pl-3 text-[13px] shadow-lg shadow-black/10`}
      >
        <Lightbulb size={15} className="shrink-0 text-muted" />
        <span>{hint}</span>
        <button
          title="知道了"
          onClick={() => useApp.getState().dismissHint()}
          className="grid size-6 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
