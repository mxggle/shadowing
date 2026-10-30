import { describe, expect, it } from "vitest";
import { chineseNumber, syncChangelog, syncPlugins, syncSize, updateLine, versions } from "./site-sync.mjs";

const changelog = `# 更新日志

## [未发布]

## [0.14.0] - 2026-10-28

### 新增
- **插件标注**：插件能在句子上标注了。日语注音插件在汉字上方标出读音。
  - 细节

## [0.13.1] - 2026-10-27

### 修复
- 修好了 \`latest.json\` 的问题。还有别的。

## [0.13.0] - 2026-10-27

### 新增
- **视频**：能放视频了。

## [0.1.0] - 2026-10-09
- 第一个公开版本。
`;

const html = `<a class="news" href="#windows"><b>0.11 新增</b>Windows 版<svg class="i"></svg></a>
<h2 id="updates-title"><span class="ph">十九天发了十六个版本，</span><span class="ph">还在快速长大。</span></h2>
      <ol class="log">
        <li><span class="v">0.13</span><time datetime="2026-10-27">10 月 27 日</time><p><b>视频。</b>能放视频了。</p></li>
      </ol>
<span data-app-version>v0.14.0 · 约 11 MB</span>`;

/** The same page in another language, as en.html / ja.html / zh-tw.html have it. */
const page = (badge, headline, line) => `<a class="news" href="#windows"><b>${badge}</b>Windows<svg class="i"></svg></a>
<h2 id="updates-title"><span class="ph">${headline}</span> <span class="ph">Evolving fast.</span></h2>
      <ol class="log">
        <li><span class="v">0.13</span>${line}</li>
      </ol>`;

const translations = {
  "0.14.0": {
    en: { title: "Plugin annotations", text: "Plugins can now annotate sentences." },
    ja: { title: "プラグイン注釈", text: "プラグインが文に注釈を付けられるようになりました。" },
    "zh-tw": { title: "外掛標註", text: "外掛能在句子上標註了。" },
  },
  "0.13.1": {
    en: { text: "Fixed latest.json & more." },
    ja: { text: "latest.json の問題を修正。" },
    "zh-tw": { text: "修好了 latest.json 的問題。" },
  },
};

describe("site-sync", () => {
  it("reads the versions, newest first", () => {
    expect(versions(changelog).map((v) => v.version)).toEqual(["0.14.0", "0.13.1", "0.13.0", "0.1.0"]);
  });

  it("makes a line from the first bullet", () => {
    const [v14, v131] = versions(changelog);
    expect(updateLine(v14)).toBe(
      '<li><span class="v">0.14</span><time datetime="2026-10-28">10 月 28 日</time><p><b>插件标注。</b>插件能在句子上标注了。</p></li>',
    );
    expect(updateLine(v131)).toContain('<span class="v">0.13.1</span>');
    expect(updateLine(v131)).toContain("<p>修好了 latest.json 的问题。</p>");
  });

  it("adds the versions the list doesn't have, and counts again", () => {
    const out = syncChangelog(html, changelog);
    expect(out.match(/class="v">([^<]+)/g)).toEqual(['class="v">0.14', 'class="v">0.13.1', 'class="v">0.13']);
    expect(out).toContain("二十天发了四个版本，");
    expect(out).toContain('<a class="news" href="#updates"><b>0.14 新增</b>插件标注<svg class="i">');
    expect(syncChangelog(out, changelog)).toBe(out);
  });

  it("does the same for the other languages, from site/updates.json", () => {
    const en = syncChangelog(page("New in 0.11", "16 releases in 19 days.", "<p>Video.</p>"), changelog, "en", translations);
    expect(en).toContain('<a class="news" href="#updates"><b>New in 0.14</b>Plugin annotations<svg class="i">');
    expect(en).toContain('<span class="ph">4 releases in 20 days.</span> <span class="ph">Evolving fast.</span>');
    expect(en).toContain(
      '<li><span class="v">0.14</span><time datetime="2026-10-28">Oct 28</time><p><b>Plugin annotations.</b> Plugins can now annotate sentences.</p></li>\n' +
        '        <li><span class="v">0.13.1</span><time datetime="2026-10-27">Oct 27</time><p>Fixed latest.json &amp; more.</p></li>\n' +
        '        <li><span class="v">0.13</span>',
    );
    expect(syncChangelog(en, changelog, "en", translations)).toBe(en);

    const ja = syncChangelog(page("0.11 新機能", "19日間で16バージョン。", ""), changelog, "ja", translations);
    expect(ja).toContain("<b>0.14 新機能</b>プラグイン注釈<svg");
    expect(ja).toContain('<span class="ph">20日間で4バージョン。</span>');
    expect(ja).toContain('<time datetime="2026-10-28">10月28日</time><p><b>プラグイン注釈。</b>プラグインが文に注釈を付けられるようになりました。</p>');

    const tw = syncChangelog(page("0.11 新增", "十九天推出十六個版本，", ""), changelog, "zh-tw", translations);
    expect(tw).toContain("<b>0.14 新增</b>外掛標註<svg");
    expect(tw).toContain('<span class="ph">二十天推出四個版本，</span>');
    expect(tw).toContain('<time datetime="2026-10-27">10 月 27 日</time><p>修好了 latest.json 的問題。</p>');
  });

  it("won't sync a page without its version's translation", () => {
    const { "0.13.1": _, ...missing } = translations;
    expect(() => syncChangelog(page("", "", ""), changelog, "ja", missing)).toThrow(
      "site/updates.json has no ja title and text for 0.13.1 (CHANGELOG: 修好了 `latest.json` 的问题。还有别的。)",
    );
    // A titled bullet needs a translated title (the badge shows it).
    const untitled = { ...translations, "0.14.0": { en: { text: "Plugins can now annotate sentences." } } };
    expect(() => syncChangelog(page("", "", ""), changelog, "en", untitled)).toThrow("no en title and text for 0.14.0");
    // Nothing newer than the list and the badge's version translated: nothing else is needed.
    const current = page("New in 0.14", "4 releases in 20 days.", "").replace('"v">0.13', '"v">0.14');
    expect(syncChangelog(current, changelog, "en", { "0.14.0": translations["0.14.0"] })).toContain("New in 0.14");
  });

  it("counts in Chinese", () => {
    expect([3, 10, 16, 19, 20, 24, 120].map(chineseNumber)).toEqual(["三", "十", "十六", "十九", "二十", "二十四", "120"]);
  });

  it("puts a release's plugin zips in the list", () => {
    const list = {
      version: 1,
      plugins: [{ id: "youtube", version: "0.3.0", minAppVersion: "0.9.0", released: "2026-10-27", packages: { old: true } }],
    };
    const asset = (name, size = 10) => ({ name, size, digest: `sha256:${"a".repeat(64)}` });
    const release = {
      tagName: "v0.14.0",
      assets: [
        asset("Shadowing-YouTube-plugin-0.3.0-macos-arm64.zip"),
        asset("Shadowing-Furigana-plugin-0.1.0-macos-arm64.zip", 11_000_000),
        asset("Shadowing-Furigana-plugin-0.1.0-windows-x86_64.zip", 12_000_000),
        asset("Shadowing-macos-arm64.dmg", 11_400_000),
      ],
    };
    const manifests = {
      YouTube: { folder: "youtube", manifest: { id: "youtube", version: "0.3.0" } },
      Furigana: {
        folder: "furigana",
        manifest: { id: "furigana", name: "日语注音", author: "Shadowing", description: "注音", version: "0.1.0", minAppVersion: "0.14.0", permissions: { network: [], runs: "x" } },
      },
    };
    const out = syncPlugins(list, release, manifests, "2026-10-28");
    expect(out.plugins[0]).toBe(list.plugins[0]); // same version: left alone
    expect(out.plugins[1]).toMatchObject({ id: "furigana", official: true, version: "0.1.0", minAppVersion: "0.14.0", released: "2026-10-28" });
    expect(out.plugins[1].packages["windows-x86_64"]).toEqual({
      url: "https://github.com/mxggle/shadowing/releases/download/v0.14.0/Shadowing-Furigana-plugin-0.1.0-windows-x86_64.zip",
      sha256: "a".repeat(64),
      size: 12_000_000,
    });
    expect(syncSize(html, release)).toContain("v0.14.0 · 约 11 MB");
    expect(syncSize("<span data-app-version>v0.14.0 · ~9 MB</span>", release)).toContain("v0.14.0 · ~11 MB");
    expect(syncSize("<span data-app-version>v0.14.0 · 約 9 MB</span>", release)).toContain("v0.14.0 · 約 11 MB");
    // The install steps say it too, after the download link (not the nav's link, which has no size).
    const steps = (link, after) => `<a href="/Shadowing-macos-arm64.dmg">下载</a>\n<nav>3 MB</nav>\n<a href="/Shadowing-macos-arm64.dmg">${link}</a>${after}`;
    expect(syncSize(steps("下载最新版", "，大约 9 MB。"), release)).toBe(steps("下载最新版", "，大约 11 MB。"));
    expect(syncSize(steps("Download the latest release", " (~9 MB)."), release)).toBe(steps("Download the latest release", " (~11 MB)."));
    expect(syncSize(steps("最新版（.dmg）をダウンロード", "してください（約 9 MB）。"), release)).toContain("（約 11 MB）");
  });
});
