import { describe, expect, it } from "vitest";
import { formatPrecise, formatTime } from "./time";

describe("formatTime", () => {
  it("formats minutes and hours", () => {
    expect(formatTime(75.3)).toBe("1:15");
    expect(formatTime(3725)).toBe("1:02:05");
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
  });
});

describe("formatPrecise", () => {
  it("shows exact tenths, not one tenth low", () => {
    expect(formatPrecise(2.3)).toBe("0:02.3");
    expect(formatPrecise(4.1)).toBe("0:04.1");
    expect(formatPrecise(12.6)).toBe("0:12.6");
    expect(formatPrecise(75.34)).toBe("1:15.3");
  });

  it("carries a rounded-up tenth into the seconds", () => {
    expect(formatPrecise(59.97)).toBe("1:00.0");
    expect(formatPrecise(0)).toBe("0:00.0");
    expect(formatPrecise(NaN)).toBe("0:00.0");
  });
});
