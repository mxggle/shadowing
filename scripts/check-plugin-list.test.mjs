import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { problems } from "./check-plugin-list.mjs";

const list = JSON.parse(readFileSync(new URL("../site/plugins.json", import.meta.url), "utf8"));
const entry = list.plugins[0];
const withEntry = (change) => ({ version: 1, plugins: [{ ...structuredClone(entry), ...change }] });

describe("plugins.json", () => {
  it("the published list is fine", () => {
    expect(problems(list)).toEqual([]);
  });

  it("needs version 1 and a list", () => {
    expect(problems({ version: 2, plugins: [] })).toHaveLength(1);
    expect(problems({ version: 1 })).toHaveLength(1);
  });

  it("takes the same ids as the app", () => {
    expect(problems(withEntry({ id: "YouTube" }))).toHaveLength(1);
    expect(problems(withEntry({ id: "-yt" }))).toHaveLength(1);
    expect(problems(withEntry({ id: "yt-2" }))).toEqual([]);
  });

  it("does not take the same id twice", () => {
    expect(problems({ version: 1, plugins: [entry, entry] })).toEqual(["plugins[1] (youtube): id 重复了"]);
  });

  it("only links to https zips with a real hash and size", () => {
    const pkg = (p) => withEntry({ packages: { "darwin-arm64": { ...entry.packages["darwin-arm64"], ...p } } });
    expect(problems(pkg({ url: "http://example.com/a.zip" }))).toHaveLength(1);
    expect(problems(pkg({ url: "https://example.com/a.tar.gz" }))).toHaveLength(1);
    expect(problems(pkg({ sha256: "ABC" }))).toHaveLength(1);
    expect(problems(pkg({ size: 0 }))).toHaveLength(1);
    expect(problems(withEntry({ packages: {} }))).toHaveLength(1);
    expect(problems(withEntry({ packages: { "windows-x64": entry.packages["darwin-arm64"] } }))).toHaveLength(1);
  });

  it("needs a source link, versions and what it connects to", () => {
    expect(problems(withEntry({ source: "javascript:alert(1)" }))).toHaveLength(1);
    expect(problems(withEntry({ version: "1.0" }))).toHaveLength(1);
    expect(problems(withEntry({ permissions: { network: ["https://youtube.com"] } }))).toHaveLength(1);
    expect(problems(withEntry({ permissions: { network: [] } }))).toEqual([]);
  });
});
