// 素材库: ready-made practice packs. A full page for a beginner who has nothing
// open yet, and a sheet (top bar button) once the app is in use.
import { LibraryBig, LoaderCircle, RefreshCw, WifiOff, X } from "lucide-react";
import { useEffect } from "react";
import { useApp } from "../../store";
import { Button, IconButton, TextLink } from "../ui";
import { PackCard } from "./PackCard";

const INTRO = "下载一套就能开始跟读：字幕、说话人和每一句的翻译讲解都已经准备好，不用下载模型，也不用设置 AI。";

/** The packs, or why they can't be listed. */
function PackList() {
  const catalog = useApp((s) => s.catalog);
  const loadCatalog = useApp((s) => s.loadCatalog);
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  if (!catalog) {
    return (
      <p className="flex items-center gap-2 py-6 text-[13px] text-muted">
        <LoaderCircle size={14} className="animate-spin" /> 正在读取素材库…
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {catalog.error && (
        <div className="flex items-center gap-2.5 rounded-[10px] bg-fill px-3 py-2 text-[12px] text-muted">
          <WifiOff size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">
            {catalog.error}
            {catalog.packs.length > 0 && "。下面是已经下载的。"}
          </span>
          <Button className="h-7" onClick={() => void loadCatalog()}>
            <RefreshCw size={13} /> 重试
          </Button>
        </div>
      )}
      {catalog.packs.map((p) => (
        <PackCard key={p.id} pack={p} />
      ))}
    </div>
  );
}

/** Where a beginner lands: no folder open, nothing to set up. */
export function PacksPage() {
  const error = useApp((s) => s.error);
  const { chooseFolder, setWizardOpen } = useApp.getState();
  return (
    <div data-tauri-drag-region className="scrollbar-none h-full overflow-y-auto bg-paper px-10">
      <div className="mx-auto flex min-h-full w-full max-w-[640px] animate-fade-in flex-col justify-center py-14">
        <p className="text-[13px] font-semibold tracking-[0.01em] text-muted">Shadowing</p>
        <h1 className="mt-3 font-heading text-[30px] leading-[1.25] font-semibold tracking-[-0.015em]">素材库</h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-muted">{INTRO}</p>
        <div className="mt-7">
          <PackList />
        </div>
        {error && <p className="mt-3 rounded-[8px] bg-danger-soft px-3 py-1.5 text-[12px] break-all text-danger">{error}</p>}
        <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2">
          <TextLink onClick={() => void chooseFolder()}>我有自己的音频：打开文件夹</TextLink>
          <TextLink onClick={() => setWizardOpen(true)}>自己设置转写和 AI</TextLink>
        </div>
      </div>
    </div>
  );
}

/** Top bar: opens the 素材库 sheet. */
export function PacksButton() {
  const open = useApp((s) => s.packsOpen);
  const setOpen = useApp((s) => s.setPacksOpen);
  return (
    <IconButton title="素材库" active={open} onClick={() => setOpen(true)}>
      <LibraryBig />
    </IconButton>
  );
}

export function PacksDialog() {
  const open = useApp((s) => s.packsOpen);
  const setOpen = useApp((s) => s.setPacksOpen);

  useEffect(() => {
    if (!open) return;
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
  return (
    <div
      className="fixed inset-0 z-30 flex animate-fade justify-center bg-black/25 px-6 pt-[7vh] pb-6 dark:bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="packs-title"
        className="flex max-h-full w-full max-w-[640px] animate-pop-in flex-col self-start overflow-hidden rounded-[16px] bg-raised shadow-lift"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2.5 pl-6">
          <h2 id="packs-title" className="text-[14px] font-semibold">
            素材库
          </h2>
          <IconButton title="关闭 (Esc)" onClick={() => setOpen(false)}>
            <X />
          </IconButton>
        </header>
        <div className="scrollbar-none overflow-y-auto px-6 pt-4 pb-6">
          <p className="mb-4 text-[13px] leading-relaxed text-muted">{INTRO}</p>
          <PackList />
        </div>
      </div>
    </div>
  );
}
