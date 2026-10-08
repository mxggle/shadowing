import { useApp } from "../store";

const SHORTCUTS: [string, string][] = [
  ["空格", "播放 / 暂停"],
  ["← →", "后退 / 前进 5 秒"],
  ["L", "设 A → 设 B → 取消循环"],
  ["- =", "减速 / 加速"],
  ["↑ ↓", "上一首 / 下一首"],
];

export function NowPlaying() {
  const current = useApp((s) => s.current);
  const error = useApp((s) => s.error);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-8 pb-8">
      {current ? (
        <div className="max-w-xl text-center">
          {current.relDir && <div className="mb-1 text-xs text-zinc-400">{current.relDir}</div>}
          <h1 className="text-2xl font-semibold break-words">{current.name}</h1>
          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">从左侧选择一个音频开始播放</p>
      )}
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs text-zinc-400">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-right font-mono">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
