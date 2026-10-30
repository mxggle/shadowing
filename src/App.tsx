import { useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { AiWizard } from "./components/guide/AiWizard";
import { Hint } from "./components/guide/Hint";
import { ImportDialog } from "./components/ImportLink";
import { Welcome } from "./components/guide/Welcome";
import { Library, ShelfToggle } from "./components/Library";
import { PlayerBar } from "./components/PlayerBar";
import { PracticeDialog } from "./components/Practice";
import { PracticeButton } from "./components/PracticeGoal";
import { SettingsButton, SettingsDialog } from "./components/settings/Settings";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { Stage } from "./components/Stage";
import { UpdateNotice } from "./components/UpdateNotice";
import { WhatsNewDialog } from "./components/WhatsNew";
import { fillNodes } from "./components/ui";
import { useMediaKeys } from "./hooks/useMediaKeys";
import { usePracticePing } from "./hooks/usePracticePing";
import { useShortcuts } from "./hooks/useShortcuts";
import { api, isTauri } from "./lib/api";
import { t } from "./lib/i18n";
import { pathParts } from "./lib/paths";
import { isWindows } from "./lib/platform";
import { useApp } from "./store";

/** The top bar's left edge once the sidebar is closed: room for the Mac's window buttons; Windows has its own title bar above. */
const BAR_START_CLOSED = isWindows ? "pl-3" : "pl-[84px]";

let booted = false; // StrictMode runs effects twice in dev

/** Everything is drawn again in the new language when it changes (text is looked up while drawing). */
export default function App() {
  const lang = useApp((s) => s.lang);
  return <Shell key={lang} />;
}

function Shell() {
  const ready = useApp((s) => s.ready);
  const folder = useApp((s) => s.folder);
  const practicing = useApp((s) => s.practicing);
  const shelfOpen = useApp((s) => s.shelfOpen);
  useShortcuts();
  useMediaKeys();
  usePracticePing();

  useEffect(() => {
    if (!isTauri() || booted) return;
    booted = true;
    void useApp
      .getState()
      .init()
      .then(api.smokeMode)
      .then(async (smoke) => {
        if (smoke) (await import("./dev/smoke")).runSmoke();
        else useApp.getState().watchUpdates();
      });
  }, []);

  if (!isTauri()) {
    return <Centered>{fillNodes(t("请用 {command} 在桌面应用中打开。"), { command: <code>npm run app</code> })}</Centered>;
  }
  if (!ready) return null;
  if (!folder && !practicing) {
    return (
      <>
        <Welcome />
        <AiWizard />
        <ImportDialog />
        <WhatsNewDialog />
        <UpdateNotice />
      </>
    );
  }

  return (
    <div
      className="flex h-full"
      // Buttons don't take focus on click, so Space/arrows stay global shortcuts.
      onMouseDown={(e) => (e.target as HTMLElement).closest("button") && e.preventDefault()}
    >
      {/* Width animates between 0 and the sidebar width; the sidebar keeps its size and is clipped. */}
      <div
        inert={!shelfOpen}
        className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-snappy ${shelfOpen ? "w-[248px]" : "w-0"}`}
      >
        <div className="h-full w-[248px]">
          <Library />
        </div>
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        <div
          data-tauri-drag-region
          className={`flex h-[52px] shrink-0 items-center gap-0.5 pr-3 transition-[padding] duration-200 ease-snappy ${
            shelfOpen ? "pl-6" : BAR_START_CLOSED
          }`}
        >
          {!shelfOpen && (
            <>
              <ShelfToggle />
              <span className="w-2" />
            </>
          )}
          <Breadcrumb />
          <PracticeButton />
          <ShortcutHelp />
          <SettingsButton />
        </div>
        <Stage />
        <Hint />
        <PlayerBar />
      </main>
      <SettingsDialog />
      <PracticeDialog />
      <AiWizard />
      <ImportDialog />
      <WhatsNewDialog />
      <UpdateNotice />
    </div>
  );
}

/** Where the current track lives: folder › subfolder. Kept out of the title so the title is just the name. */
function Breadcrumb() {
  const folderName = useApp((s) => s.folder?.name);
  const relDir = useApp((s) => s.current?.relDir);
  const onSample = useApp((s) => !!s.current && s.current.path === s.sample?.path);
  const parts = onSample ? [t("示例")] : [folderName, ...(relDir ? pathParts(relDir) : [])].filter(Boolean);
  return (
    // pointer-events-none: drags on the text still reach the bar's drag region.
    <div className="pointer-events-none mr-auto flex min-w-0 items-center gap-1 text-[12px] text-faint">
      {parts.map((p, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1 last:text-muted">
          {i > 0 && <ChevronRight size={12} strokeWidth={2} className="shrink-0 opacity-60" />}
          <span className="truncate">{p}</span>
        </span>
      ))}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div data-tauri-drag-region className="flex h-full items-center justify-center p-8">
      {children}
    </div>
  );
}
