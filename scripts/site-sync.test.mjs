import { describe, expect, it } from "vitest";
import { chineseNumber, changelogInSync, syncChangelog, syncPlugins, syncSize, updateLine, versions } from "./site-sync.mjs";

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

const html = `<h2 id="updates-title"><span class="ph">十九天发了十六个版本，</span><span class="ph">还在快速长大。</span></h2>
      <ol class="log">
        <li><span class="v">0.13</span><time datetime="2026-10-27">10 月 27 日</time><p><b>视频。</b>能放视频了。</p></li>
      </ol>
<span data-app-version>v0.14.0 · 约 11 MB</span>`;

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
    expect(changelogInSync(out, changelog)).toBe(true);
    expect(changelogInSync(html, changelog)).toBe(false);
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
  });
});
