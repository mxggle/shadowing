import { ChevronRight, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { dateLabel, type Inline, type NoteItem, type Release } from "../lib/changelog";
import { releases } from "../releases";
import { useApp } from "../store";
import { IconButton, Kbd } from "./ui";

/** 新功能: what each version brought (the CHANGELOG.md bundled with the app); the newest open, older ones a click away. */
export function WhatsNewDialog() {
  const open = useApp((s) => s.newsOpen);
  const setOpen = useApp((s) => s.setNewsOpen);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return setExpanded(null);
    // Capture phase: Esc closes the sheet instead of also clearing the loop.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  if (!open) return null;
  const [latest, ...older] = releases;
  return (
    <div
      className="fixed inset-0 z-30 flex animate-fade justify-center bg-black/25 px-6 pt-[7vh] pb-6 dark:bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-title"
        className="flex max-h-full w-full max-w-[560px] animate-pop-in flex-col self-start overflow-hidden rounded-[16px] bg-raised shadow-lift"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2.5 pl-6">
          <h2 id="news-title" className="text-[14px] font-semibold">
            新功能
          </h2>
          <IconButton title="关闭 (Esc)" onClick={() => setOpen(false)}>
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-none overflow-y-auto px-6 pt-5 pb-6">
          {latest ? (
            <>
              <Heading release={latest} />
              <Notes release={latest} />
            </>
          ) : (
            <p className="text-[13px] text-muted">这个版本没有带更新说明。</p>
          )}
          {older.length > 0 && (
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-[12px] font-medium text-faint">以前的版本</h3>
              <ul className="mt-1 flex flex-col divide-y divide-line">
                {older.map((r) => {
                  const shown = expanded === r.version;
                  return (
                    <li key={r.version} className="py-1">
                      <button
                        aria-expanded={shown}
                        className="flex w-full items-center gap-2 rounded-[8px] py-2 text-left text-[13px] hover:text-fg"
                        onClick={() => setExpanded(shown ? null : r.version)}
                      >
                        <ChevronRight size={14} className={`shrink-0 text-faint transition-transform duration-150 ${shown ? "rotate-90" : ""}`} />
                        <span className="font-mono font-medium tabular">{r.version}</span>
                        <span className="text-[12px] text-faint">{dateLabel(r.date)}</span>
                      </button>
                      {shown && (
                        <div className="pb-3 pl-[22px]">
                          <Notes release={r} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Heading({ release }: { release: Release }) {
  return (
    <h3 className="flex items-baseline gap-2">
      <span className="font-mono text-[15px] font-semibold tabular">{release.version}</span>
      <span className="text-[12px] text-faint">{dateLabel(release.date)}</span>
    </h3>
  );
}

function Notes({ release }: { release: Release }) {
  return (
    <div className="flex flex-col gap-4 pt-3">
      {release.groups.map((g, i) => (
        <section key={i}>
          {g.title && <h4 className="text-[12px] font-medium text-faint">{g.title}</h4>}
          <ul className="mt-1.5 flex list-disc flex-col gap-2.5 pl-4 marker:text-faint">
            {g.items.map((item, j) => (
              <Point key={j} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Point({ item, sub = false }: { item: NoteItem; sub?: boolean }) {
  return (
    <li className={sub ? "text-[12px] leading-relaxed text-muted" : "text-[13px] leading-relaxed"}>
      <Text runs={item.text} />
      {item.children.length > 0 && (
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 marker:text-faint">
          {item.children.map((c, i) => (
            <Point key={i} item={c} sub />
          ))}
        </ul>
      )}
    </li>
  );
}

function Text({ runs }: { runs: Inline[] }) {
  return runs.map((r, i) =>
    r.kind === "bold" ? (
      <b key={i} className="font-semibold text-fg">
        {r.text}
      </b>
    ) : r.kind === "key" ? (
      <Kbd key={i} className="mx-0.5 align-[1px]">
        {r.text}
      </Kbd>
    ) : (
      <Fragment key={i}>{r.text}</Fragment>
    ),
  );
}
