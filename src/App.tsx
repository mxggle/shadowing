import { useEffect } from "react";
import { AudioLines, FolderOpen } from "lucide-react";
import { Library } from "./components/Library";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { Stage } from "./components/Stage";
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
      className="grid h-full grid-cols-[minmax(220px,280px)_1fr]"
      // Buttons don't take focus on click, so Space/arrows stay global shortcuts.
      onMouseDown={(e) => (e.target as HTMLElement).closest("button") && e.preventDefault()}
    >
      <Library />
      <main className="flex min-w-0 flex-col">
        <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-end px-3">
          <ShortcutHelp />
        </div>
        <Stage />
      </main>
    </div>
  );
}

function Welcome() {
  const missing = useApp((s) => s.missingFolder);
  const chooseFolder = useApp((s) => s.chooseFolder);
  return (
    <Centered>
      <div className="flex max-w-sm animate-fade-in flex-col items-center text-center">
        <div className="grid size-16 place-items-center rounded-[18px] bg-accent text-white shadow-[0_8px_24px_-8px] shadow-accent/70">
          <AudioLines size={30} strokeWidth={2} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Shadowing</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          打开一个存放音频的文件夹，
          <br />
          反复听、变速、A–B 循环跟读。
        </p>
        {missing && (
          <p className="mt-4 rounded-lg bg-danger-soft px-3 py-1.5 text-xs break-all text-danger">上次的文件夹无法打开：{missing}</p>
        )}
        <button
          onClick={() => void chooseFolder()}
          className="mt-6 flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-[14px] font-medium text-white transition-[filter,scale] duration-150 ease-snappy hover:brightness-110 active:scale-[0.96]"
        >
          <FolderOpen size={17} /> 打开文件夹
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
