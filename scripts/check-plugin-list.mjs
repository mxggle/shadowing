#!/usr/bin/env node
// Checks site/plugins.json, the plugin directory (shadowing.nihongo.day/plugins).
// Every entry is reviewed by hand before it is merged; this only catches the
// mistakes a reviewer could miss: a malformed id, a non-https link, a hash
// that isn't one. The same id rule as src-tauri/src/plugins/manifest.rs.
// Usage: node scripts/check-plugin-list.mjs [file]   (default: site/plugins.json)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLATFORMS = ["darwin-arm64", "darwin-x86_64"];
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const text = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const https = (v) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

/** Problems with one parsed plugins.json, as sentences (empty = fine). */
export function problems(list) {
  if (list?.version !== 1) return ["version 要是 1"];
  if (!Array.isArray(list.plugins)) return ["plugins 要是一个数组"];
  const out = [];
  const seen = new Set();
  for (const [i, p] of list.plugins.entries()) {
    const at = `plugins[${i}]${typeof p?.id === "string" ? ` (${p.id})` : ""}`;
    const bad = (why) => out.push(`${at}: ${why}`);
    if (!ID.test(p?.id ?? "")) bad("id 只能用小写字母、数字和 -，最多 40 个字");
    else if (seen.has(p.id)) bad("id 重复了");
    else seen.add(p.id);
    if (!text(p.name, 40)) bad("name 不能为空，最多 40 个字");
    if (!text(p.author, 60)) bad("author 不能为空");
    if (!text(p.description, 200)) bad("description 不能为空，最多 200 个字");
    if (p.official !== undefined && typeof p.official !== "boolean") bad("official 要是 true 或 false");
    if (p.imports !== undefined && !(Array.isArray(p.imports) && p.imports.every((s) => text(s, 30)))) bad("imports 要是一组网站名");
    if (!https(p.source)) bad("source 要是 https:// 开头的源代码地址");
    if (!VERSION.test(p.version ?? "")) bad("version 要写成 1.2.3");
    if (!VERSION.test(p.minAppVersion ?? "")) bad("minAppVersion 要写成 0.9.0");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.released ?? "")) bad("released 要写成 2026-10-18");
    const perm = p.permissions ?? {};
    if (!Array.isArray(perm.network) || !perm.network.every((h) => HOST.test(h))) bad("permissions.network 要是一组域名（可以是空的）");
    if (perm.runs !== undefined && typeof perm.runs !== "string") bad("permissions.runs 要是一句话");
    const packages = Object.entries(p.packages ?? {});
    if (packages.length === 0) bad("packages 里至少要有一个平台");
    for (const [platform, pkg] of packages) {
      if (!PLATFORMS.includes(platform)) bad(`不认识的平台 ${platform}（只有 ${PLATFORMS.join("、")}）`);
      if (!https(pkg?.url) || !pkg.url.endsWith(".zip")) bad(`${platform}: url 要是 https:// 开头的 .zip`);
      if (!/^[0-9a-f]{64}$/.test(pkg?.sha256 ?? "")) bad(`${platform}: sha256 要是 64 位小写十六进制`);
      if (!Number.isInteger(pkg?.size) || pkg.size <= 0) bad(`${platform}: size 要是字节数`);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? new URL("../site/plugins.json", import.meta.url);
  let list;
  try {
    list = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`site/plugins.json 读不了：${e.message}`);
    process.exit(1);
  }
  const found = problems(list);
  for (const p of found) console.error(p);
  if (found.length) process.exit(1);
  console.log(`plugins.json: ${list.plugins.length} 个插件，没有问题`);
}
