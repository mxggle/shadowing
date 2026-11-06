import { describe, expect, it } from "vitest";
import { asText, canSend, chars, counter, MAX_CONTACT, MAX_MESSAGE } from "./feedback";

describe("feedback", () => {
  it("counts characters, not UTF-16 units", () => {
    expect(chars("録音🎧")).toBe(3);
  });

  it("needs something written that fits", () => {
    expect(canSend("  \n ")).toBe(false);
    expect(canSend(" 录音没声音 ")).toBe(true);
    expect(canSend("🎧".repeat(MAX_MESSAGE))).toBe(true);
    expect(canSend("🎧".repeat(MAX_MESSAGE + 1))).toBe(false);
    expect(canSend("x", "字".repeat(MAX_CONTACT))).toBe(true);
    expect(canSend("x", "字".repeat(MAX_CONTACT + 1))).toBe(false);
  });

  it("shows the count only near the limit", () => {
    expect(counter("短")).toBeNull();
    expect(counter("字".repeat(3600))).toBe(`3600 / ${MAX_MESSAGE}`);
  });

  it("copies the message, then the contact", () => {
    expect(asText(" 想要导出 \n", " ")).toBe("想要导出");
    expect(asText("想要导出", " me@example.com ")).toBe("想要导出\n\nme@example.com");
  });
});
