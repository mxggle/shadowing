// 句子本 part of the single store: the sentences you got stuck on (☆ or B), kept in Rust's
// book.json, and going through today's: each opens its audio and loops the sentence (with
// 跟读停顿 and 藏字幕 as they're set), until 过了 (]) or 还卡着 (lib/book.ts has the schedule).
import { api } from "./lib/api";
import { dueList, entryFor, newEntry, passed, sentenceFor, stuck, type BookEntry } from "./lib/book";
import { t } from "./lib/i18n";
import { dayKey } from "./lib/practice";
import { sentenceIndexAt } from "./lib/sentences";
import type { AppState } from "./store";

export interface BookState {
  book: BookEntry[];
  bookOpen: boolean;
  /** The entry being shadowed. */
  bookAt: string | null;
  loadBook(): Promise<void>;
  /** ☆ / B: a sentence of the audio playing in or out of the book (the current one without `index`). */
  toggleBook(index?: number): void;
  setBookOpen(open: boolean): void;
  /** Opens the entry's audio if it isn't the one playing, and loops the sentence. */
  reviewEntry(id: string): void;
  /** 过了 (`ok`) or 还卡着: when it comes back, then on to the next one due. */
  reviewDone(ok: boolean): void;
  removeEntry(id: string): void;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

const today = () => dayKey(Date.now());
/** How long to wait for another audio and its transcript to open. */
const OPEN_WAIT_MS = 8000;

export function createBookSlice(set: Set, get: Get): BookState {
  let opening = 0;

  function save(book: BookEntry[]) {
    set({ book });
    void api.book.save(book).catch((e) => set({ error: String(e) }));
  }

  /** Loops the entry's sentence in the audio now open; false when it isn't there any more. */
  function loopEntry(e: BookEntry): boolean {
    const s = get();
    const i = sentenceFor(s.transcript?.sentences ?? [], e);
    if (i < 0) return false;
    if (s.loopSentence !== i) s.toggleSentenceLoop(i);
    else s.playSentence(i);
    return true;
  }

  return {
    book: [],
    bookOpen: false,
    bookAt: null,

    async loadBook() {
      set({ book: await api.book.get().catch(() => []) });
    },

    toggleBook(index) {
      const s = get();
      const list = s.transcript?.sentences ?? [];
      const i = index ?? s.loopSentence ?? sentenceIndexAt(list, s.time);
      const sentence = list[i];
      if (!s.current || !sentence) return;
      const there = entryFor(s.book, s.current.path, sentence);
      if (there) {
        save(s.book.filter((e) => e.id !== there.id));
        s.say(t("从句子本拿掉了"), 2000);
        return;
      }
      const id = `${Date.now().toString(36)}-${i}`;
      save([...s.book, newEntry({ audio: s.current.path, start: sentence.start, end: sentence.end, text: sentence.text }, today(), id)]);
      s.say(t("加进句子本了：明天再来跟读"), 2500);
    },

    setBookOpen(bookOpen) {
      set(bookOpen ? { bookOpen, settingsOpen: false, statsOpen: false } : { bookOpen, bookAt: null });
    },

    reviewEntry(id) {
      const e = get().book.find((x) => x.id === id);
      if (!e) return;
      set({ bookAt: id });
      if (get().current?.path === e.audio && get().transcript) {
        if (!loopEntry(e)) get().say(t("这句在字幕里找不到了（字幕可能改过）"), 4000);
        return;
      }
      const track = get().folder?.tracks.find((x) => x.path === e.audio);
      if (!track) return get().say(t("这句的音频不在打开的文件夹里"), 4000);
      get().open(track, false);
      // Its transcript arrives a moment after the audio opens.
      const mine = ++opening;
      const started = Date.now();
      const wait = () => {
        if (mine !== opening || get().bookAt !== id) return;
        const s = get();
        if (s.current?.path === e.audio && s.transcript) {
          if (!loopEntry(e)) s.say(t("这句在字幕里找不到了（字幕可能改过）"), 4000);
        } else if (Date.now() - started < OPEN_WAIT_MS) window.setTimeout(wait, 100);
      };
      wait();
    },

    reviewDone(ok) {
      const { book, bookAt } = get();
      const e = book.find((x) => x.id === bookAt);
      if (!e) return;
      const day = today();
      const next = book.map((x) => (x.id === e.id ? (ok ? passed(x, day) : stuck(x, day)) : x));
      save(next);
      const after = dueList(next, day)[0];
      if (after) return get().reviewEntry(after.id);
      set({ bookAt: null });
      get().clearLoop();
      get().say(t("今天的句子都练完了"), 3000);
    },

    removeEntry(id) {
      save(get().book.filter((e) => e.id !== id));
      if (get().bookAt === id) set({ bookAt: null });
    },
  };
}
