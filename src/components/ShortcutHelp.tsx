import { Keyboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "../lib/focus";
import { useApp } from "../store";
import { IconButton, Kbd } from "./ui";

type Group = { title: string; keys: [string[], string][]; column: 0 | 1 };

const groups = (seekStep: number): Group[] => [
  {
    title: "播放",
    column: 0,
    keys: [
      [["空格"], "播放 / 暂停"],
      [["←", "→"], `后退 / 前进 ${seekStep} 秒`],
      [["↑", "↓"], "上一个 / 下一个音频"],
      [["−", "="], "放慢 / 加快"],
      [["R"], "切换播放顺序"],
    ],
  },
  {
    title: "循环",
    column: 0,
    keys: [
      [["L"], "设 A → 设 B → 取消"],
      [["Esc"], "取消循环"],
    ],
  },
  {
    title: "字幕",
    column: 1,
    keys: [
      [["S"], "循环当前句 / 取消"],
      [["[", "]"], "上一句 / 下一句"],
      [["{", "}"], "上一段 / 下一段"],
      [["I"], "解释当前句"],
      [["M"], "跟读录音（录音时：说完了）"],
      [["⇧", "M"], "整段录音（这一段或全文）"],
      [["P"], "回放录音和原句对比"],
    ],
  },
  {
    title: "修改字幕",
    column: 1,
    keys: [
      [["E"], "修改当前句"],
      [["⇧", "↩"], "在光标处断开成两句"],
      [["⌫"], "在句首：并入上一句"],
      [["⌦"], "在句尾：并入下一句"],
      [["⌘", "F"], "查找和替换"],
      [["⌘", "Z"], "撤销修改、断开或合并"],
    ],
  },
  {
    title: "其他",
    column: 0,
    keys: [
      [["?"], "显示 / 隐藏本表"],
      [["⌘", "B"], "显示 / 隐藏左侧列表"],
      [["⌘", ","], "设置"],
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
      const { settingsOpen, wizardOpen, statsOpen } = useApp.getState();
      if (isTypingTarget(e.target) || settingsOpen || wizardOpen || statsOpen) return;
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
      <IconButton title="键盘快捷键 (?)" active={open} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Keyboard />
      </IconButton>
      {open && (
        <div className="scrollbar-none absolute top-full right-0 z-20 mt-2 max-h-[calc(100vh-64px)] w-[544px] origin-top-right animate-pop-in overflow-y-auto rounded-[12px] bg-raised px-3.5 pt-3 pb-3.5 shadow-lift">
          <h2 className="text-[13px] font-semibold">键盘快捷键</h2>
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
