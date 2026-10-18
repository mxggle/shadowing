import { afterEach, describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { fill, plural, setLang, t } from "./i18n";

afterEach(() => setLang("zh"));

describe("t", () => {
  it("gives the Chinese key back in Chinese, the entry in English", () => {
    expect(t("设置")).toBe("设置");
    setLang("en");
    expect(t("设置")).toBe("Settings");
    expect(t("还没有这条")).toBe("还没有这条");
  });

  it("fills slots in either language", () => {
    expect(fill("第 {n} 句，共 {total} 句", { n: 3, total: 9 })).toBe("第 3 句，共 9 句");
    expect(fill("{missing} stays", {})).toBe("{missing} stays");
    expect(plural(1, "take")).toBe("1 take");
    expect(plural(3, "take")).toBe("3 takes");
  });
});

// Every Chinese string the interface shows goes through t() (or tk() for a key that t() looks up
// later), and every one of those has English. Text in a line marked `i18n: keep` stays as it is
// (a language's own name, sample text in the language being learned).
const SOURCES = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../dev/**", "!../i18n/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const HAN = /[㐀-鿿豈-﫿　-〿！-｠]/;
const KEY = /\bt[k]?\(\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\$]|\\.)*`)/g;

/** The source with comments blanked out (line breaks kept), strings left alone. */
function withoutComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && !(c !== "`" && src[j] === "\n")) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function literal(quoted: string): string {
  return quoted[0] === '"' ? JSON.parse(quoted) : quoted.slice(1, -1);
}

const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const files = Object.entries(SOURCES).map(([path, raw]) => ({ path: path.slice(3), raw, code: withoutComments(raw) }));
const keys = new Map<string, string>();
for (const { path, code } of files) for (const m of code.matchAll(KEY)) keys.set(literal(m[1]), path);

describe("English for the whole interface", () => {
  it("leaves no Chinese outside t()", () => {
    const left: string[] = [];
    for (const { path, raw, code } of files) {
      const lines = code.replace(KEY, "t(").split("\n");
      const original = raw.split("\n");
      lines.forEach((line, n) => {
        if (HAN.test(line) && !original[n]?.includes("i18n: keep")) left.push(`${path}:${n + 1}: ${line.trim()}`);
      });
    }
    expect(left).toEqual([]);
  });

  it("has English for every key", () => {
    const missing = [...keys].filter(([key]) => !(key in en)).map(([key, path]) => `${path}: ${key}`);
    expect(missing).toEqual([]);
  });

  it("keeps the same slots as the Chinese", () => {
    const wrong = Object.entries(en)
      .filter(([key, entry]) => typeof entry === "string" && slots(key).join() !== slots(entry).join())
      .map(([key]) => key);
    expect(wrong).toEqual([]);
  });

  it("has no English left for text the app no longer shows", () => {
    expect(Object.keys(en).filter((key) => !keys.has(key))).toEqual([]);
  });
});
