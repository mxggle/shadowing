import { Keyboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "../lib/focus";
import { t } from "../lib/i18n";
import { useApp } from "../store";
import { IconButton, Kbd } from "./ui";

type Group = { title: string; keys: [string[], string][]; column: 0 | 1 };

/** Built while rendering, in the interface language. */
const groups = (seekStep: number): Group[] => [
  {
    title: t("播放"),
    column: 0,
    keys: [
      [[t("空格")], t("播放 / 暂停")],
      [["←", "→"], t("后退 / 前进 {n} 秒", { n: seekStep })],
      [["↑", "↓"], t("上一个 / 下一个音频")],
      [["−", "="], t("放慢 / 加快")],
      [["R"], t("切换播放顺序")],
    ],
  },
  {
    title: t("循环"),
    column: 0,
    keys: [
      [["L"], t("设 A → 设 B → 取消")],
      [["Esc"], t("取消循环")],
    ],
  },
  {
    title: t("字幕"),
    column: 1,
    keys: [
      [["S"], t("循环当前句 / 取消")],
      [["[", "]"], t("上一句 / 下一句")],
      [["{", "}"], t("上一段 / 下一段")],
      [["I"], t("解释当前句")],
      [["M"], t("跟读录音（循环时连续录；录音时：说完了）")],
      [["⇧", "M"], t("整段录音（这一段或全文）")],
      [["P"], t("回放录音和原句对比")],
    ],
  },
  {
    title: t("修改字幕"),
    column: 1,
    keys: [
      [["E"], t("修改当前句")],
      [["⇧", "↩"], t("在光标处断开成两句")],
      [["⌫"], t("在句首：并入上一句")],
      [["⌦"], t("在句尾：并入下一句")],
      [["⌘", "F"], t("查找和替换")],
      [["⌘", "Z"], t("撤销修改、断开或合并")],
    ],
  },
  {
    title: t("其他"),
    column: 0,
    keys: [
      [["?"], t("显示 / 隐藏本表")],
      [["⌘", "B"], t("显示 / 隐藏左侧列表")],
      [["⌘", ","], t("设置")],
    ],
  },
];

/** Keyboard button in the top bar; `?` toggles it, Esc or a click outside closes it. */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const seekStep = useApp((s) => s.settings.seekStep);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Capture phase, so Esc closes this sheet instead of also clearing the loop.
    const onKey = (e: KeyboardEvent) => {
      const { settingsOpen, wizardOpen, statsOpen, newsOpen } = useApp.getState();
      if (isTypingTarget(e.target) || settingsOpen || wizardOpen || statsOpen || newsOpen) return;
      if (e.key === "?") setOpen((o) => !o);
      else if (e.key === "Escape" && open) setOpen(false);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onPointer = (e: PointerEvent) => {
      if (open && !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <IconButton title={t("键盘快捷键 (?)")} active={open} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Keyboard />
      </IconButton>
      {open && (
        <div className="scrollbar-none absolute top-full right-0 z-20 mt-2 max-h-[calc(100vh-64px)] w-[544px] origin-top-right animate-pop-in overflow-y-auto rounded-[12px] bg-raised px-3.5 pt-3 pb-3.5 shadow-lift">
          <h2 className="text-[13px] font-semibold">{t("键盘快捷键")}</h2>
          <div className="grid grid-cols-2 gap-x-6">
            {([0, 1] as const).map((column) => (
              <div key={column}>
                {groups(seekStep)
                  .filter((g) => g.column === column)
                  .map((g) => (
                    <section key={g.title} className="mt-3">
                      <h3 className="mb-1.5 text-[11px] font-medium text-faint">{g.title}</h3>
                      <dl className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 text-[13px]">
                        {g.keys.map(([keys, label]) => (
                          <div key={label} className="contents">
                            <dt className="text-fg/90">{label}</dt>
                            <dd className="flex justify-end gap-1">
                              {keys.map((k) => (
                                <Kbd key={k}>{k}</Kbd>
                              ))}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
