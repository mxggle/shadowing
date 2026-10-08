import { Keyboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "../hooks/useShortcuts";
import { useApp } from "../store";
import { IconButton, Kbd } from "./ui";

const shortcuts = (seekStep: number): [string[], string][] => [
  [["空格"], "播放 / 暂停"],
  [["←", "→"], `后退 / 前进 ${seekStep} 秒`],
  [["↑", "↓"], "上一首 / 下一首"],
  [["L"], "设 A → 设 B → 取消循环"],
  [["Esc"], "取消循环"],
  [["[", "]"], "上一句 / 下一句（有字幕时）"],
  [["S"], "循环当前句 / 取消"],
  [["−", "="], "减速 / 加速"],
  [["?"], "显示 / 隐藏本列表"],
];

/** Keyboard button in the top bar; `?` toggles it, Esc or a click outside closes it. */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const seekStep = useApp((s) => s.settings.seekStep);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Capture phase, so Esc closes this sheet instead of also clearing the loop.
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
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
        <Keyboard size={16} />
      </IconButton>
      {open && (
        <div className="absolute top-full right-0 z-20 mt-2 w-64 origin-top-right animate-pop-in rounded-xl border border-line bg-elevated p-3 shadow-xl shadow-black/10">
          <h2 className="mb-2 text-[11px] font-semibold text-muted">键盘快捷键</h2>
          <dl className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 text-[13px]">
            {shortcuts(seekStep).map(([keys, label]) => (
              <div key={label} className="contents">
                <dt>{label}</dt>
                <dd className="flex justify-end gap-0.5">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
