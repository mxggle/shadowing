#!/usr/bin/env node
// Keeps the landing page (site/) in step with releases, so nobody has to remember to:
//   changelog          — site/index.html's 更新 list gets a line for every CHANGELOG version newer than its top one
//                        (the first bullet's bold title and its first sentence), the headline counts days and
//                        versions again, and the badge at the top names the newest version with something new. Run by scripts/bump-version.sh; scripts/check-version.sh checks it was.
//   release <file>     — after a release is published (<file>: `gh release view vX.Y.Z --json tagName,assets`):
//                        the download size shown on the page, and site/plugins.json's entry for each plugin zip in the
//                        release whose version isn't listed yet (new plugins get an entry from their manifest).
//                        Run by scripts/site-after-release.sh.
// Usage: node scripts/site-sync.mjs changelog | release <assets.json>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const write = (path, text) => writeFileSync(new URL(path, root), text);
const REPO = "https://github.com/mxggle/shadowing";

/** The CHANGELOG's versions, newest first: { version, date, body }. */
export function versions(changelog) {
  const out = [];
  for (const part of changelog.split(/^## /m).slice(1)) {
    const head = part.match(/^\[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})/);
    if (head) out.push({ version: head[1], date: head[2], body: part.slice(part.indexOf("\n") + 1) });
  }
  return out;
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** `code` and plain text: the list shows prose, not markdown. */
const prose = (s) => escape(s.replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]*)\*\*/g, "$1"));

/** The first bullet of a version: its bold title (may be empty) and the rest. */
function firstBullet(body) {
  const bullet = body.split("\n").find((l) => l.startsWith("- "))?.slice(2).trim() ?? "";
  const titled = bullet.match(/^\*\*([^*]+)\*\*[：:]\s*(.*)$/);
  return titled ? { title: titled[1], rest: titled[2] } : { title: "", rest: bullet };
}

const label = (version) => (version.endsWith(".0") ? version.slice(0, -2) : version);

/** The badge at the top of the page: the newest version with a 新增 section and a titled first bullet, linking to the 更新 list. */
export function newsBadge(all) {
  const v = all.find((x) => /^### 新增/m.test(x.body) && firstBullet(x.body).title);
  if (!v) return null;
  return `<a class="news" href="#updates"><b>${label(v.version)} 新增</b>${prose(firstBullet(v.body).title)}<svg`;
}

/** One line of the 更新 list: "0.14" (patches in full), the date, the first bullet's title and first sentence. */
export function updateLine({ version, date, body }) {
  const { title, rest } = firstBullet(body);
  const sentence = rest.match(/^.*?[。！？](?=\s|$|[^）」』])/)?.[0] ?? rest;
  const [, m, d] = date.split("-").map(Number);
  const text = `${title ? `<b>${prose(title)}。</b>` : ""}${prose(sentence)}`;
  return `<li><span class="v">${label(version)}</span><time datetime="${date}">${m} 月 ${d} 日</time><p>${text}</p></li>`;
}

const CHINESE_NUMBERS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
/** 19 → 十九, 24 → 二十四, 100+ stays digits. */
export function chineseNumber(n) {
  if (n < 10) return CHINESE_NUMBERS[n];
  if (n >= 100) return String(n);
  const [tens, ones] = [Math.floor(n / 10), n % 10];
  return `${tens === 1 ? "" : CHINESE_NUMBERS[tens]}十${ones ? CHINESE_NUMBERS[ones] : ""}`;
}

/** index.html with a line for each version newer than the list's top one, and the headline counted again. */
export function syncChangelog(html, changelog) {
  const all = versions(changelog);
  const top = html.match(/<ol class="log">\s*<li><span class="v">([^<]+)<\/span>/);
  if (!top || !all.length) throw new Error("index.html has no 更新 list, or CHANGELOG.md no versions");
  const newer = all.filter((v) => newerThan(v.version, top[1]));
  let out = html;
  if (newer.length) {
    const lines = newer.map((v) => `        ${updateLine(v)}\n`).join("");
    out = out.replace(/(<ol class="log">\n)/, `$1${lines}`);
  }
  const badge = newsBadge(all);
  if (badge) out = out.replace(/<a class="news" href="[^"]*"><b>[^<]*<\/b>[^<]*<svg/, badge);
  const days = Math.round((Date.parse(all[0].date) - Date.parse(all[all.length - 1].date)) / 86_400_000) + 1;
  return out.replace(
    /(<h2 id="updates-title"><span class="ph">)[^<]*(，<\/span>)/,
    `$1${chineseNumber(days)}天发了${chineseNumber(all.length)}个版本$2`,
  );
}

/** "0.14.0" vs the list's "0.13" (a label: patch 0 left out). */
function newerThan(version, label) {
  const parts = (v) => [...v.split(".").map(Number), 0, 0].slice(0, 3);
  const [a, b] = [parts(version), parts(label)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Whether the list's top line is CHANGELOG's newest version (checked by scripts/check-version.sh). */
export function changelogInSync(html, changelog) {
  return syncChangelog(html, changelog) === html;
}

const PLUGIN_ZIP = /^Shadowing-(.+)-plugin-(\d+\.\d+\.\d+)-(macos-arm64|windows-x86_64)\.zip$/;
const PLATFORM = { "macos-arm64": "darwin-arm64", "windows-x86_64": "windows-x86_64" };

/**
 * plugins.json with the plugin zips of a published release: an entry whose version is older than the zip's
 * moves to it (packages replaced), a plugin not listed yet gets an entry from its manifest. `manifests` maps
 * a zip's name part ("Furigana") to { folder, manifest }.
 */
export function syncPlugins(list, release, manifests, today) {
  const zips = {};
  for (const asset of release.assets) {
    const m = asset.name.match(PLUGIN_ZIP);
    if (!m || !manifests[m[1]] || !asset.digest?.startsWith("sha256:")) continue;
    const { folder, manifest } = manifests[m[1]];
    if (manifest.version !== m[2]) continue;
    (zips[manifest.id] ??= { folder, manifest, packages: {} }).packages[PLATFORM[m[3]]] = {
      url: `${REPO}/releases/download/${release.tagName}/${asset.name}`,
      sha256: asset.digest.slice("sha256:".length),
      size: asset.size,
    };
  }
  const plugins = list.plugins.map((p) => {
    const z = zips[p.id];
    if (!z || p.version === z.manifest.version) return p;
    return { ...p, version: z.manifest.version, minAppVersion: z.manifest.minAppVersion ?? p.minAppVersion, released: today, packages: z.packages };
  });
  for (const [id, z] of Object.entries(zips)) {
    if (plugins.some((p) => p.id === id)) continue;
    const m = z.manifest;
    plugins.push({
      id,
      name: m.name,
      author: m.author,
      official: m.author === "Shadowing",
      description: m.description.slice(0, 200),
      source: `${REPO}/tree/main/plugins/${z.folder}`,
      version: m.version,
      minAppVersion: m.minAppVersion ?? "0.9.0",
      released: today,
      permissions: { network: m.permissions?.network ?? [], runs: m.permissions?.runs ?? "" },
      packages: z.packages,
    });
  }
  return { ...list, plugins };
}

/** index.html showing the dmg's size ("v0.14.0 · 约 11 MB"). */
export function syncSize(html, release) {
  const dmg = release.assets.find((a) => a.name === "Shadowing-macos-arm64.dmg");
  if (!dmg) return html;
  return html.replace(/(<span data-app-version>v[0-9.]+ · 约 )\d+( MB)/, `$1${Math.round(dmg.size / 1e6)}$2`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, file] = process.argv.slice(2);
  if (mode === "changelog") {
    write("site/index.html", syncChangelog(read("site/index.html"), read("CHANGELOG.md")));
  } else if (mode === "release" && file) {
    const release = JSON.parse(readFileSync(file, "utf8"));
    // The zip's name part for each plugin folder, as scripts/release-plugins.sh names them.
    const entries = read("scripts/release-plugins.sh").match(/release_plugins=\(([^)]*)\)/)[1].trim().split(/\s+/);
    const manifests = Object.fromEntries(
      entries.map((e) => {
        const [folder, name] = e.split(":");
        return [name, { folder, manifest: JSON.parse(read(`plugins/${folder}/manifest.json`)) }];
      }),
    );
    const today = new Date().toISOString().slice(0, 10);
    const list = syncPlugins(JSON.parse(read("site/plugins.json")), release, manifests, today);
    write("site/plugins.json", `${JSON.stringify(list, null, 2)}\n`);
    write("site/index.html", syncSize(read("site/index.html"), release));
  } else {
    console.error("usage: node scripts/site-sync.mjs changelog | release <assets.json>");
    process.exit(1);
  }
}
