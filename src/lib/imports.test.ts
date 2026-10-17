import { describe, expect, it } from "vitest";
import { languageName, percent, pickSubtitle, progressText } from "./imports";

const subs = (...langs: string[]) => langs.map((lang) => ({ lang, name: lang }));

describe("pickSubtitle", () => {
  it("takes the language spoken", () => {
    expect(pickSubtitle(subs("en", "ja"), "ja", "en")).toBe("ja");
    expect(pickSubtitle(subs("en", "ja-JP"), "ja", "en")).toBe("ja-JP");
  });
  it("never picks a translation of what is spoken", () => {
    expect(pickSubtitle(subs("en", "zh-Hans"), "ja", "en")).toBeNull();
  });
  it("uses the language being learned when the site doesn't say", () => {
    expect(pickSubtitle(subs("en", "ja"), null, "en")).toBe("en");
    expect(pickSubtitle(subs("en", "ja"), null, "other")).toBeNull();
    expect(pickSubtitle(subs("en", "ja"), null, "")).toBeNull();
  });
  it("prefers the exact code over a regional one", () => {
    expect(pickSubtitle(subs("en-GB", "en"), "en", "ja")).toBe("en");
  });
});

describe("progress", () => {
  it("reads in megabytes", () => {
    expect(progressText("下载音频", 3_200_000, 10_800_000)).toBe("下载音频 3.2 / 10.8 MB");
    expect(progressText("下载 QuickJS", 800_000, 0)).toBe("下载 QuickJS 0.8 MB");
    expect(progressText("读取视频信息", 0, 0)).toBe("读取视频信息");
  });
  it("percent only with a known size", () => {
    expect(percent(5, 10)).toBe(50);
    expect(percent(12, 10)).toBe(100);
    expect(percent(5, 0)).toBeNull();
  });
});

describe("languageName", () => {
  it("names languages in Chinese, falling back to the site's name", () => {
    expect(languageName("ja", "Japanese")).toBe("日语");
    expect(languageName("zz-unknown", "Klingon")).toBe("Klingon");
  });
});
