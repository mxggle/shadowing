// 加入 Anki part of the single store: a sentence of the audio playing becomes an Anki card
// (its audio cut from the track, its text, the explanation kept for it) through AnkiConnect,
// in Rust (src-tauri/src/anki). When Anki isn't open or has no AnkiConnect, a dialog says how.
import { api } from "./lib/api";
import { t } from "./lib/i18n";
import type { AppState } from "./store";

export interface AnkiState {
  /** The sentence waiting for Anki to be set up (the dialog is open), to add when it is. */
  ankiWaiting: { path: string; index: number } | null;
  /** A sentence on its way to Anki. */
  ankiAdding: number | null;
  addToAnki(index: number): Promise<void>;
  /** 再试一次 in the dialog: false when Anki still can't be reached. */
  retryAnki(): Promise<boolean>;
  closeAnkiHelp(): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

export function createAnkiSlice(set: Set, get: Get): AnkiState {
  return {
    ankiWaiting: null,
    ankiAdding: null,

    async addToAnki(index) {
      const s = get();
      const sentence = s.transcript?.sentences[index];
      if (!s.current || !sentence || s.ankiAdding !== null) return;
      set({ ankiAdding: index });
      s.say(t("正在加入 Anki…"), 20000);
      try {
        const r = await api.ankiAdd(s.current.path, index, sentence.text);
        if (r.status === "unreachable") {
          get().dismissHint();
          set({ ankiWaiting: { path: s.current.path, index } });
          return;
        }
        set({ ankiWaiting: null });
        get().say(r.status === "added" ? t("已加入 Anki 的「{deck}」牌组", { deck: r.deck }) : t("这句已经在 Anki 里了"), 3000);
      } catch (e) {
        set({ ankiWaiting: null });
        get().say(String(e), 5000);
      } finally {
        set({ ankiAdding: null });
      }
    },

    async retryAnki() {
      const w = get().ankiWaiting;
      // Another audio was opened meanwhile: that sentence isn't on screen any more.
      if (!w || get().current?.path !== w.path) {
        set({ ankiWaiting: null });
        return true;
      }
      await get().addToAnki(w.index);
      return get().ankiWaiting === null;
    },

    closeAnkiHelp() {
      set({ ankiWaiting: null });
    },
  };
}
