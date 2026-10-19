import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { problem } from "./update-sig.mjs";

// Made with a throwaway key: `npx tauri signer generate -p "" --ci`, then `npx tauri signer sign` on DATA.
const DATA = Buffer.from("Shadowing update test\n");
const PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDlFNjAwRDk3MjlEMjlCNDMKUldSRG05SXBsdzFnbnAvaS9WVi9kWFJOMCt3blJ2bFBBaW5DYjh2Z1ErUG5rcDRBRGZRRUV4V3gK";
const SIG =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSRG05SXBsdzFnbnJES21VRVNrM3RKaGQzQmpuT2VLQW92SkpuL0ZZRjFJZVFmYjU5aE9JRFZNQ1dqT2I2VHVTUnhDcW5QcjRhYk90eUpmOE9jU1pxUTZHclhFVnlVa0EwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyNDAzMjY2CWZpbGU6ZGF0YS50eHQKSzVhdXE3cW5ITnl4dkZtYk1DVlRGQktVMzkxRnkzVFd4cDdRVzN3elJ1a2pWckw0YzRjVTFMT25TMXpRbU9haVBESkZOQW4vemhtc3RlUUtMOHVORFE9PQo=";

const b64 = (text) => Buffer.from(text).toString("base64");
const decoded = (b64text) => Buffer.from(b64text, "base64").toString("utf8");

/** A key pair and signer in Tauri's format, to make the cases a real key can't. */
function keys(id = "0123456789abcdef") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyId = Buffer.from(id, "hex");
  const pubkey = b64(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64")}\n`);
  const signFile = (data, alg = "ED") => {
    const s = sign(null, alg === "ED" ? createHash("blake2b512").update(data).digest() : data, privateKey);
    const comment = "timestamp:1\tfile:x";
    const global = sign(null, Buffer.concat([s, Buffer.from(comment)]), privateKey);
    const line = Buffer.concat([Buffer.from(alg), keyId, s]).toString("base64");
    return b64(`untrusted comment: x\n${line}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`);
  };
  return { pubkey, signFile };
}

describe("update signatures", () => {
  it("accepts what tauri signer made", () => {
    expect(problem(DATA, SIG, PUBKEY)).toBeNull();
  });

  it("refuses a changed file", () => {
    expect(problem(Buffer.from("Shadowing update test!\n"), SIG, PUBKEY)).toBe("the signature doesn't match the file");
  });

  it("refuses a signature from another key", () => {
    const other = keys();
    expect(problem(DATA, SIG, other.pubkey)).toBe("signed with another key");
    // The same key id but different key bytes: the signature itself fails.
    const sameId = keys("439bd229970d609e");
    expect(problem(DATA, SIG, sameId.pubkey)).toBe("the signature doesn't match the file");
  });

  it("refuses a changed trusted comment", () => {
    const tampered = b64(decoded(SIG).replace("file:data.txt", "file:other.txt"));
    expect(problem(DATA, tampered, PUBKEY)).toBe("the trusted comment's signature doesn't match");
  });

  it("takes minisign's older, not prehashed signatures too", () => {
    const k = keys();
    expect(problem(DATA, k.signFile(DATA, "Ed"), k.pubkey)).toBeNull();
    expect(problem(DATA, k.signFile(DATA, "ED"), k.pubkey)).toBeNull();
    expect(problem(Buffer.from("x"), k.signFile(DATA, "Ed"), k.pubkey)).toBe("the signature doesn't match the file");
  });

  it("says when a file isn't a key or a signature", () => {
    expect(problem(DATA, SIG, b64("not a key\n"))).toBe("the public key isn't a minisign key");
    expect(problem(DATA, b64("untrusted comment: x\nnope\n"), PUBKEY)).toBe("the .sig isn't a minisign signature");
  });
});
