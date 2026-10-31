import { afterEach, describe, expect, it } from "vitest";
import type { Sentence } from "./api";
import { addDays, dueList, dueNote, entryFor, newEntry, passed, sentenceFor, stuck, type BookEntry } from "./book";
import { setLang } from "./i18n";

afterEach(() => setLang("zh"));

const today = "2026-10-31";
const entry = (over: Partial<BookEntry> = {}): BookEntry => ({ ...newEntry({ audio: "/m/a.mp3", start: 10, end: 12, text: "Hello there." }, today, "x"), ...over });
const sentence = (start: number, text: string) => ({ start, end: start + 2, text }) as Sentence;

describe("schedule", () => {
  it("added today, it comes back tomorrow", () => {
    expect(entry()).toMatchObject({ added: today, due: "2026-11-01", step: 0 });
  });

  it("said well: a week later, then a month, then done", () => {
    const once = passed(entry({ due: "2026-11-01" }), "2026-11-01");
    expect(once).toMatchObject({ step: 1, due: "2026-11-08" });
    const twice = passed(once, "2026-11-08");
    expect(twice).toMatchObject({ step: 2, due: "2026-12-08" });
    expect(passed(twice, "2026-12-08")).toMatchObject({ step: 3, due: "" });
  });

  it("still stuck: tomorrow, from the start", () => {
    expect(stuck(entry({ step: 2, due: "2026-11-30" }), "2026-11-30")).toMatchObject({ step: 0, due: "2026-12-01" });
  });

  it("days cross months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-02-28", 30)).toBe("2026-03-30");
  });
});

describe("dueList", () => {
  it("today's and missed ones, longest waiting first; not tomorrow's nor done ones", () => {
    const list = [entry({ id: "b", due: "2026-10-31" }), entry({ id: "a", due: "2026-10-29" }), entry({ id: "c", due: "2026-11-01" }), entry({ id: "d", due: "" })];
    expect(dueList(list, today).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("finding sentences", () => {
  it("the same moment or the same words of the same audio", () => {
    const list = [entry()];
    expect(entryFor(list, "/m/a.mp3", sentence(10.1, "Hello there!"))).toBeDefined();
    expect(entryFor(list, "/m/a.mp3", sentence(40, "Hello there."))).toBeDefined();
    expect(entryFor(list, "/m/b.mp3", sentence(10, "Hello there."))).toBeUndefined();
  });

  it("in the transcript: by its words, else the nearest start", () => {
    const list = [sentence(1, "One."), sentence(9.8, "Hello, there."), sentence(14, "Hello there.")];
    expect(sentenceFor(list, entry())).toBe(2);
    expect(sentenceFor(list.slice(0, 2), entry())).toBe(1);
    expect(sentenceFor([sentence(30, "Far.")], entry())).toBe(-1);
  });
});

describe("dueNote", () => {
  it("says when it comes back", () => {
    expect(dueNote(entry({ due: today }), today)).toBe("今天");
    expect(dueNote(entry(), today)).toBe("明天再来");
    expect(dueNote(entry({ due: "2026-11-07" }), today)).toBe("7 天后再来");
    expect(dueNote(entry({ due: "" }), today)).toBe("记住了");
    setLang("en");
    expect(dueNote(entry({ due: "2026-11-07" }), today)).toBe("Back in 7 days");
  });
});
