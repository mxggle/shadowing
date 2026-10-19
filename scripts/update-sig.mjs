#!/usr/bin/env node
// Checks update files against their .sig and the updater's public key (plugins.updater.pubkey in
// src-tauri/tauri.conf.json) the way the in-app updater does, so a release never carries an update that
// installed apps would refuse: say the Windows build on Actions was signed with a different key than the Mac's.
// The format is minisign's: Ed25519 over the file (or its BLAKE2b-512, "ED"), and over the signature + its
// trusted comment. Tauri base64-encodes the whole .sig and public key files once more.
// Used by scripts/verify-release.sh.
// Usage: node scripts/update-sig.mjs <file> <file.sig> [<file> <file.sig>]...
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// An Ed25519 public key as SPKI DER is this prefix and then the 32 key bytes.
const SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** The lines of a Tauri key or .sig: base64 around minisign's own text file. */
const lines = (b64) => Buffer.from(b64.trim(), "base64").toString("utf8").split("\n");

/** Why `data` doesn't match `sig` under `pubkey` (both as Tauri writes them), or null when it does. */
export function problem(data, sig, pubkey) {
  const pk = Buffer.from(lines(pubkey)[1] ?? "", "base64");
  if (pk.length !== 42 || pk.toString("latin1", 0, 2) !== "Ed") return "the public key isn't a minisign key";
  const [, sigLine = "", comment = "", globalLine = ""] = lines(sig);
  const s = Buffer.from(sigLine, "base64");
  const alg = s.toString("latin1", 0, 2);
  if (s.length !== 74 || (alg !== "Ed" && alg !== "ED")) return "the .sig isn't a minisign signature";
  if (!s.subarray(2, 10).equals(pk.subarray(2, 10))) return "signed with another key";
  if (!comment.startsWith("trusted comment: ")) return "the .sig has no trusted comment";
  const key = createPublicKey({ key: Buffer.concat([SPKI, pk.subarray(10)]), format: "der", type: "spki" });
  const signed = alg === "ED" ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, signed, key, s.subarray(10))) return "the signature doesn't match the file";
  const trusted = Buffer.concat([s.subarray(10), Buffer.from(comment.slice("trusted comment: ".length))]);
  if (!verify(null, trusted, key, Buffer.from(globalLine, "base64"))) return "the trusted comment's signature doesn't match";
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.length % 2) {
    console.error("usage: node scripts/update-sig.mjs <file> <file.sig> [<file> <file.sig>]...");
    process.exit(1);
  }
  const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  let bad = 0;
  for (let i = 0; i < args.length; i += 2) {
    const why = problem(readFileSync(args[i]), readFileSync(args[i + 1], "utf8"), conf.plugins.updater.pubkey);
    if (why) {
      console.error(`update-sig: ${args[i]}: ${why}`);
      bad++;
    }
  }
  process.exit(bad ? 1 : 0);
}
