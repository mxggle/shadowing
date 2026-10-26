import { describe, expect, it } from "vitest";
import { contentRect, isWide, layoutShown, moveMaskEdge, nextLayout, shiftMask } from "./picture";

describe("layouts", () => {
  it("puts the picture beside the sentences only where the main area is wide enough", () => {
    expect(isWide(1440, true)).toBe(true);
    expect(isWide(1280, true)).toBe(false);
    expect(isWide(1280, false)).toBe(true);
    expect(layoutShown("side", false)).toBe("stack");
    expect(layoutShown("side", true)).toBe("side");
    expect(layoutShown("theater", false)).toBe("theater");
  });

  it("V goes round the layouts that fit", () => {
    expect(nextLayout("stack", true)).toBe("side");
    expect(nextLayout("side", true)).toBe("theater");
    expect(nextLayout("theater", true)).toBe("stack");
    expect(nextLayout("stack", false)).toBe("theater");
    expect(nextLayout("theater", false)).toBe("stack");
  });
});

describe("contentRect", () => {
  it("finds a fitted picture inside its box", () => {
    expect(contentRect(640, 360, 1280, 720)).toEqual({ left: 0, top: 0, width: 640, height: 360 });
    expect(contentRect(640, 480, 1280, 720)).toEqual({ left: 0, top: 60, width: 640, height: 360 });
    expect(contentRect(800, 360, 1280, 720)).toEqual({ left: 80, top: 0, width: 640, height: 360 });
  });

  it("takes the whole box before the picture's size is known", () => {
    expect(contentRect(640, 360, 0, 0)).toEqual({ left: 0, top: 0, width: 640, height: 360 });
  });
});

describe("mask band", () => {
  it("moves one edge, keeping the band inside the picture and not too thin", () => {
    expect(moveMaskEdge([0.7, 0.9], "top", 0.6)).toEqual([0.6, 0.9]);
    expect(moveMaskEdge([0.7, 0.9], "top", 0.88)).toEqual([0.85, 0.9]);
    expect(moveMaskEdge([0.7, 0.9], "top", -0.2)).toEqual([0, 0.9]);
    expect(moveMaskEdge([0.7, 0.9], "bottom", 1.3)).toEqual([0.7, 1]);
    expect(moveMaskEdge([0.7, 0.9], "bottom", 0.71)[1]).toBeCloseTo(0.75);
  });

  it("moves the whole band, stopping at the picture's edges", () => {
    const near = ([a, b]: [number, number], [x, y]: [number, number]) => {
      expect(a).toBeCloseTo(x);
      expect(b).toBeCloseTo(y);
    };
    near(shiftMask([0.7, 0.9], -0.2), [0.5, 0.7]);
    near(shiftMask([0.7, 0.9], 0.3), [0.8, 1]);
    near(shiftMask([0.1, 0.3], -0.5), [0, 0.2]);
  });
});
