import { Check, ChevronDown, Folder, FolderOpen, FolderX, Pin, PinOff, X } from "lucide-react";
import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useDismiss } from "../hooks/useDismiss";
import type { FolderEntry, FolderListing } from "../lib/api";
import { firstFocus, others, switcherGroups } from "../lib/folders";
import { t } from "../lib/i18n";
import { shortcut } from "../lib/platform";
import { useApp } from "../store";

/**
 * The open folder's name at the top of the sidebar, and the menu it opens (also ⌘O):
 * pinned folders, the last few opened, and 打开其他文件夹…. ↑ ↓ move, ↩ opens, and
 * the focus starts on the folder you were in before, so ⌘O ↩ goes back and forth.
 */
export function FolderSwitcher({ folder }: { folder: FolderListing }) {
  const open = useApp((s) => s.switcherOpen);
  const folders = useApp((s) => s.folders);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => useApp.getState().setSwitcherOpen(false), []);
  useDismiss(open, close, root);

  // Only when it opens: the list refreshing a moment later mustn't move the focus.
  const latest = useRef(folders);
  latest.current = folders;
  useEffect(() => {
    if (!open) return;
    const items = menuItems(menu.current);
    const start = firstFocus(latest.current);
    (items.find((el) => el.dataset.path === start) ?? items[0])?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Plain keys belong to the menu (Space mustn't also play); ⌘O still closes it.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopPropagation();
    const items = menuItems(menu.current);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at < 0 ? -1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
  };

  const { pinned, recent } = switcherGroups(folders);
  const alone = others(folders).length === 0;

  return (
    <div ref={root} className="relative min-w-0">
      <h2>
        <button
          onClick={() => useApp.getState().setSwitcherOpen(!open)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`${t("切换文件夹（{key}）", { key: shortcut("⌘O") })}\n${folder.root}`}
          className={`flex h-7 max-w-full min-w-0 items-center gap-1 rounded-[7px] px-1.5 text-[13px] font-semibold tracking-[-0.005em] transition-colors duration-150 ${
            open ? "bg-press" : "hover:bg-hover"
          }`}
        >
          <span className="min-w-0 truncate">{folder.name}</span>
          <ChevronDown size={13} strokeWidth={2.2} className={`shrink-0 text-faint transition-transform duration-200 ease-snappy ${open ? "rotate-180" : ""}`} />
        </button>
      </h2>
      {open && (
        // No wider than the sidebar, which clips what sticks out.
        <div
          ref={menu}
          role="menu"
          aria-label={t("切换文件夹")}
          onKeyDown={onKeyDown}
          className="scrollbar-none absolute top-full left-0 z-20 mt-1 max-h-[min(440px,70vh)] w-[228px] origin-top-left animate-pop-in overflow-y-auto rounded-[12px] bg-raised p-1 shadow-lift"
        >
          {pinned.length > 0 && <Heading>{t("已固定")}</Heading>}
          {pinned.map((f) => (
            <FolderRow key={f.path} folder={f} />
          ))}
          {recent.length > 0 && <Heading>{t("最近打开")}</Heading>}
          {recent.map((f) => (
            <FolderRow key={f.path} folder={f} />
          ))}
          {alone && <p className="px-2.5 pt-1 pb-1.5 text-[12px] leading-[18px] text-faint">{t("打开过的文件夹会列在这里，以后点一下就能切回去。")}</p>}
          <div role="separator" className="mx-1.5 my-1 h-px bg-line" />
          <button
            data-item
            role="menuitem"
            onClick={() => {
              close();
              void useApp.getState().chooseFolder();
            }}
            className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] text-fg/90 outline-none! transition-colors duration-150 hover:bg-hover focus-visible:bg-hover"
          >
            <FolderOpen size={15} strokeWidth={1.9} className="shrink-0 text-muted" />
            {t("打开其他文件夹…")}
          </button>
        </div>
      )}
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-1.5 pb-0.5 text-[11px] font-medium text-faint">{children}</div>;
}

/** A folder: click to open it; pin, unpin or take it off the list on hover. */
function FolderRow({ folder: f }: { folder: FolderEntry }) {
  const { switchFolder, pinFolder, forgetFolder } = useApp.getState();
  return (
    <div className="group/row flex items-center rounded-[8px] transition-colors duration-150 hover:bg-hover has-[:focus-visible]:bg-hover">
      <button
        data-item
        data-path={f.path}
        role="menuitemradio"
        aria-checked={f.current}
        onClick={() => void switchFolder(f.path)}
        title={f.missing ? t("找不到这个文件夹：可能被移动、改了名，或者它所在的硬盘没有接上") : f.path}
        className="flex min-w-0 flex-1 items-start gap-2.5 py-1.5 pr-1 pl-2.5 text-left outline-none!"
      >
        <span className={`mt-px shrink-0 ${f.current ? "text-fg" : "text-muted"}`}>
          {f.missing ? <FolderX size={15} strokeWidth={1.9} /> : <Folder size={15} strokeWidth={1.9} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] leading-[18px] ${f.missing ? "text-muted" : f.current ? "font-medium text-fg" : "text-fg/90"}`}>{f.name}</span>
          <span className="block truncate text-[11px] leading-4 text-faint">{f.missing ? t("找不到 · {place}", { place: f.place }) : f.place}</span>
        </span>
      </button>
      {/* Shown on hover or while the row has the focus, so names get the whole width otherwise. */}
      <span className="hidden shrink-0 items-center gap-px pr-1 group-focus-within/row:flex group-hover/row:flex">
        <RowAction label={f.pinned ? t("取消固定") : t("固定在上面")} onClick={() => void pinFolder(f.path, !f.pinned).then(() => focusRow(f.path))}>
          {f.pinned ? <PinOff /> : <Pin />}
        </RowAction>
        {!f.current && (
          <RowAction label={t("从列表中移除")} onClick={() => void forgetFolder(f.path)}>
            <X />
          </RowAction>
        )}
      </span>
      {f.current && <Check size={14} strokeWidth={2.4} aria-hidden className="mr-2.5 ml-1 shrink-0 text-fg" />}
    </div>
  );
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-[22px] place-items-center rounded-[6px] text-faint transition-[background-color,color] duration-150 hover:bg-press hover:text-fg [&>svg]:size-[13px] [&>svg]:[stroke-width:2]"
    >
      {children}
    </button>
  );
}

/** The row moves to its group: the focus goes with it. */
const focusRow = (path: string) => document.querySelector<HTMLElement>(`[role=menu] [data-path="${CSS.escape(path)}"]`)?.focus();

const menuItems = (el: HTMLElement | null) => Array.from(el?.querySelectorAll<HTMLElement>("[data-item]") ?? []);
