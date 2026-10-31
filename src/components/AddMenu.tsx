import { FolderOpen, Link2, Plus, Puzzle } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDismiss } from "../hooks/useDismiss";
import { t } from "../lib/i18n";
import { shortcut } from "../lib/platform";
import { linkSites } from "../lib/imports";
import { useApp } from "../store";
import { IconButton, MenuItem, MenuSeparator } from "./ui";

/**
 * ＋ in the sidebar header: every way to bring audio in, and opening another
 * folder. Import plugins add theirs here (docs/plugin-ui.md, slot ①); all link
 * importers share one 从链接导入… item, the link decides which plugin takes it.
 */
export function AddMenu() {
  const plugins = useApp((s) => s.plugins);
  const sites = useMemo(() => linkSites(plugins), [plugins]);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={root} className="relative">
      <IconButton title={t("添加音频")} active={open} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus />
      </IconButton>
      {open && (
        // Right-aligned and no wider than the sidebar, which clips what sticks out.
        <div role="menu" aria-label={t("添加音频")} className="absolute top-full right-0 z-20 mt-1.5 w-[228px] origin-top-right animate-pop-in rounded-[12px] bg-raised p-1 shadow-lift">
          {sites.length > 0 && (
            <>
              <MenuItem
                icon={<Link2 size={15} strokeWidth={1.9} />}
                label={t("从链接导入…")}
                hint={sites.join(t("、"))}
                title={t("复制链接后，在应用里按 {key} 也可以", { key: shortcut("⌘V") })}
                onClick={run(() => void useApp.getState().openImport())}
              />
              <MenuSeparator />
            </>
          )}
          <MenuItem icon={<FolderOpen size={15} strokeWidth={1.9} />} label={t("打开其他文件夹…")} onClick={run(() => void useApp.getState().chooseFolder())} />
          <MenuSeparator />
          <MenuItem
            icon={<Puzzle size={15} strokeWidth={1.9} />}
            label={t("更多导入方式…")}
            title={t("在 设置 → 插件 里安装插件")}
            muted
            onClick={run(() => useApp.getState().showPlugins())}
          />
        </div>
      )}
    </div>
  );
}
