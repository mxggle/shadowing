import { useEffect } from "react";
import { FolderOpen } from "lucide-react";
import { Library } from "./components/Library";
import { NowPlaying } from "./components/NowPlaying";
import { PlayerBar } from "./components/PlayerBar";
import { useShortcuts } from "./hooks/useShortcuts";
import { api, isTauri } from "./lib/api";
import { useApp } from "./store";

let booted = false; // StrictMode runs effects twice in dev

export default function App() {
  const ready = useApp((s) => s.ready);
  const folder = useApp((s) => s.folder);
  useShortcuts();

  useEffect(() => {
    if (!isTauri() || booted) return;
    booted = true;
    void useApp
      .getState()
      .init()
      .then(api.smokeMode)
      .then(async (smoke) => {
        if (smoke) (await import("./dev/smoke")).runSmoke();
      });
  }, []);

  if (!isTauri()) {
    return <Centered>请用 <code>npm run app</code> 在桌面应用中打开。</Centered>;
  }
  if (!ready) return null;
  if (!folder) return <Welcome />;

  return (
    <div
      className="grid h-full grid-cols-[minmax(220px,300px)_1fr]"
      // Buttons don't take focus on click, so Space/arrows stay global shortcuts.
      onMouseDown={(e) => (e.target as HTMLElement).closest("button") && e.preventDefault()}
    >
      <Library />
      <main className="flex min-w-0 flex-col">
        <div data-tauri-drag-region className="h-[52px] shrink-0" />
        <NowPlaying />
        <PlayerBar />
      </main>
    </div>
  );
}

function Welcome() {
  const missing = useApp((s) => s.missingFolder);
  const chooseFolder = useApp((s) => s.chooseFolder);
  return (
    <Centered>
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-xl font-semibold">Shadowing</h1>
        <p className="text-sm text-zinc-500">打开一个存放音频的文件夹，开始听和跟读。</p>
        {missing && (
          <p className="max-w-sm text-xs text-amber-600">上次的文件夹无法打开：{missing}</p>
        )}
        <button
          onClick={() => void chooseFolder()}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <FolderOpen size={16} /> 打开文件夹
        </button>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div data-tauri-drag-region className="flex h-full items-center justify-center p-8">
      {children}
    </div>
  );
}
