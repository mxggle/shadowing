// In-app updates part of the single store. Rust checks GitHub Releases, downloads, swaps the
// app and relaunches; this keeps what to show (the notice in UpdateNotice.tsx, the row in settings).
import { listen } from "@tauri-apps/api/event";
import { api, type AvailableUpdate, type UpdateProgress } from "./lib/api";
import type { AppState } from "./store";

/** Let the window settle first; the check is quiet unless it finds something. */
const LAUNCH_CHECK_DELAY_MS = 4000;

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  /** Only after a check the learner asked for. */
  | { state: "latest" }
  | ({ state: "available" } & AvailableUpdate)
  | ({ state: "installing" } & AvailableUpdate & UpdateProgress)
  | { state: "failed"; message: string; update: AvailableUpdate | null };

export interface UpdateState {
  update: UpdateStatus;
  /** Whether the floating notice shows `update` (settings always does). */
  updateNotice: boolean;
  /** `manual`: asked for (menu, settings), so “已是最新” and errors are shown too. */
  checkUpdate(manual: boolean): Promise<void>;
  installUpdate(): Promise<void>;
  dismissUpdate(): void;
  /** Checks once a little after launch, and on 检查更新… in the app menu. */
  watchUpdates(): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createUpdateSlice(set: Set, get: Get): UpdateState {
  return {
    update: { state: "idle" },
    updateNotice: false,

    async checkUpdate(manual) {
      const busy = get().update.state;
      if (busy === "checking" || busy === "installing") return;
      set({ update: { state: "checking" }, updateNotice: manual });
      try {
        const found = await api.update.check();
        if (found) set({ update: { state: "available", ...found }, updateNotice: true });
        else set({ update: { state: manual ? "latest" : "idle" } });
      } catch (e) {
        // A check at launch fails quietly (offline, GitHub unreachable); the next launch tries again.
        set({ update: manual ? { state: "failed", message: String(e), update: null } : { state: "idle" } });
      }
    },

    async installUpdate() {
      const { update } = get();
      const found = update.state === "available" ? update : update.state === "failed" ? update.update : null;
      if (!found) return;
      const { version, current, notes } = found;
      set({ update: { state: "installing", version, current, notes, done: 0, total: null }, updateNotice: true });
      try {
        await api.update.install(); // the app relaunches on success
      } catch (e) {
        set({ update: { state: "failed", message: String(e), update: { version, current, notes } }, updateNotice: true });
      }
    },

    dismissUpdate() {
      const { update } = get();
      if (update.state === "installing") return;
      // “稍后”: the update stays in settings; “已是最新” and errors are done with.
      set({ updateNotice: false, update: update.state === "available" ? update : { state: "idle" } });
    },

    watchUpdates() {
      void listen<UpdateProgress>("update:progress", ({ payload }) => {
        const { update } = get();
        if (update.state === "installing") set({ update: { ...update, ...payload } });
      });
      void listen("update:check", () => void get().checkUpdate(true));
      window.setTimeout(() => void get().checkUpdate(false), LAUNCH_CHECK_DELAY_MS);
    },
  };
}
