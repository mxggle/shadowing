import { afterEach, describe, expect, it } from "vitest";
import type { PluginInfo, Track } from "./api";
import { setLang } from "./i18n";
import { downloadLine, folderName, languageName, linkSites, nextDownload, percent, pickSubtitle, placeDownloads, progressText, type Download } from "./imports";

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

const download = (id: number, state: Download["state"], folder = "YouTube"): Download => ({
  id,
  url: `https://youtu.be/${id}`,
  title: `t${id}`,
  subtitles: null,
  folder,
  state,
  message: "",
  done: 0,
  total: 0,
});

describe("downloads", () => {
  it("starts the first waiting one, one at a time", () => {
    expect(nextDownload([download(1, "failed"), download(2, "queued"), download(3, "queued")])?.id).toBe(2);
    expect(nextDownload([download(1, "downloading"), download(2, "queued")])).toBeNull();
    expect(nextDownload([download(1, "failed")])).toBeNull();
    // A finished one being listed doesn't hold up the next.
    expect(nextDownload([download(1, "finishing"), download(2, "queued")])?.id).toBe(2);
  });

  it("says what each row is doing", () => {
    expect(downloadLine(download(1, "queued"))).toBe("等前一个下载完");
    expect(downloadLine({ ...download(1, "failed"), message: "视频不存在或已被删除" })).toBe("视频不存在或已被删除");
    expect(downloadLine({ ...download(1, "downloading"), message: "下载音频", done: 4_200_000, total: 11_300_000 })).toBe("下载音频 4.2 / 11.3 MB");
    expect(downloadLine(download(1, "downloading"))).toBe("开始下载");
    expect(downloadLine(download(1, "finishing"))).toBe("已导入");
  });

  it("names folders the way Rust will", () => {
    expect(folderName(" YouTube ")).toBe("YouTube");
    expect(folderName("")).toBe("");
    expect(folderName(" \u3000\t")).toBe("");
    expect(folderName(".hidden")).toBe("hidden");
    // The same cases as `safe_name` in src-tauri/src/plugins/names.rs.
    const cases: [string, string][] = [
      ["日本語練習／中級【～によって】会話", "日本語練習／中級【～によって】会話"],
      ['AC/DC: Live?  "Best"\n', "AC DC Live Best"],
      ["a/b: c", "a b c"],
      ["...hidden", "hidden"],
      ["  ..  ", "未命名"],
      ["../..", "未命名"],
      ["ends with dots...", "ends with dots"],
      ["tab\there\u3000wide\u00a0space", "tab here wide space"],
      ["c1\u0085control\u009fchars\u007f", "c1 control chars"],
      ["CON", "CON_"],
      ["con.txt", "con_.txt"],
      ["Nul .tar.gz", "Nul_ .tar.gz"],
      ["aux...", "aux_"],
      ["COM1", "COM1_"],
      ["lpt9.mp3", "lpt9_.mp3"],
      ["COM¹", "COM¹_"],
      ["CONOUT$", "CONOUT$_"],
      ["COM10", "COM10"],
      ["CONSOLE", "CONSOLE"],
      ["con-game", "con-game"],
      ["Prn: Live", "Prn Live"],
    ];
    for (const [title, name] of cases) expect(folderName(title), title).toBe(name);
    expect(folderName("あ".repeat(100))).toBe("あ".repeat(60));
    const device = folderName(`con.${"x".repeat(300)}`);
    expect(device.startsWith("con_.") && new TextEncoder().encode(device).length).toBe(180);
  });

  it("puts each download in the group it lands in, making new groups in name order", () => {
    const track = (relDir: string): Track => ({ path: `/f/${relDir}/x.mp3`, name: "x", relDir, size: 1 });
    const groups: [string, Track[]][] = [
      ["", [track("")]],
      ["Unit 2", [track("Unit 2")]],
      ["Unit 5", [track("Unit 5")]],
    ];
    const placed = placeDownloads(groups, [download(1, "downloading", "Unit 3"), download(2, "queued", "Unit 2"), download(3, "queued", "")]);
    expect(placed.map((g) => [g.dir, g.tracks.length, g.downloads.map((d) => d.id)])).toEqual([
      ["", 1, [3]],
      ["Unit 2", 1, [2]],
      ["Unit 3", 0, [1]],
      ["Unit 5", 1, []],
    ]);
    // Into the folder itself when it has no loose tracks yet: first.
    expect(placeDownloads([["Unit 2", [track("Unit 2")]]], [download(4, "queued", " ")])[0].dir).toBe("");
  });

  it("lists the sites the installed plugins import from", () => {
    const plugin = (importers: string[], problem: string | null = null): PluginInfo => ({
      id: importers.join() || "x",
      name: "",
      version: "",
      author: "",
      description: "",
      importers,
      permissions: { network: [], runs: "" },
      bytes: 0,
      problem,
    });
    expect(linkSites([plugin(["YouTube"]), plugin(["Bilibili", "YouTube"]), plugin(["Broken"], "manifest.json 写得不对")])).toEqual(["YouTube", "Bilibili"]);
    expect(linkSites([])).toEqual([]);
  });
});

describe("in English", () => {
  afterEach(() => setLang("zh"));

  it("names languages, rows and the fallback folder in English", () => {
    setLang("en");
    expect(languageName("ja", "x")).toBe("Japanese");
    expect(downloadLine(download(1, "queued"))).toBe("Waiting for the one before");
    expect(folderName("../..")).toBe("Untitled");
  });
});
