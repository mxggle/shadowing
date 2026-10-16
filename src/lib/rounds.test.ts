import { describe, expect, it } from "vitest";
import { firstStep, isLast, isPlain, nextStep, planLabel, planNote, planOf, stepCount, type RoundPlan, type Step } from "./rounds";

/** Every step of a plan, in order. */
function walk(plan: RoundPlan): Step[] {
  const steps: Step[] = [];
  for (let s: Step | null = firstStep(plan); s; s = nextStep(plan, s)) steps.push(s);
  return steps;
}

describe("planOf", () => {
  it("defaults to one time, nothing before it", () => {
    expect(planOf(undefined, undefined)).toEqual({ listens: 0, repeats: 1 });
    expect(isPlain(planOf(undefined, undefined))).toBe(true);
  });

  it("keeps settings in range", () => {
    expect(planOf(7, 0)).toEqual({ listens: 3, repeats: 1 });
    expect(planOf(-1, 9)).toEqual({ listens: 0, repeats: 5 });
    expect(planOf(1.6, Number.NaN)).toEqual({ listens: 2, repeats: 1 });
  });
});

describe("steps", () => {
  it("a plain take is one round, and it's kept", () => {
    const plan = planOf(0, 1);
    expect(walk(plan)).toEqual([{ kind: "say", n: 1 }]);
    expect(isLast(plan, firstStep(plan))).toBe(true);
  });

  it("hears first, then says it each time; only the last is kept", () => {
    const plan = planOf(1, 3);
    const steps = walk(plan);
    expect(steps).toEqual([
      { kind: "hear", n: 1 },
      { kind: "say", n: 1 },
      { kind: "say", n: 2 },
      { kind: "say", n: 3 },
    ]);
    expect(steps.map((s) => isLast(plan, s))).toEqual([false, false, false, true]);
  });

  it("several listens, one time said", () => {
    expect(walk(planOf(2, 1)).map((s) => s.kind)).toEqual(["hear", "hear", "say"]);
  });
});

describe("labels", () => {
  it("counts only what there's more than one of", () => {
    const plan = planOf(2, 3);
    expect(stepCount(plan, { kind: "hear", n: 1 })).toBe("1 / 2");
    expect(stepCount(plan, { kind: "say", n: 2 })).toBe("第 2 / 3 遍");
    expect(stepCount(planOf(1, 1), { kind: "hear", n: 1 })).toBeNull();
    expect(stepCount(planOf(1, 1), { kind: "say", n: 1 })).toBeNull();
  });

  it("names the plan on its button", () => {
    expect(planLabel(planOf(0, 1))).toBe("跟读 1 遍");
    expect(planLabel(planOf(1, 3))).toBe("听 1 · 跟读 3 遍");
  });

  it("says what M will do", () => {
    expect(planNote(planOf(0, 1), "listen")).toBe("先放一遍原句，然后轮到你说。");
    expect(planNote(planOf(0, 1), "shadow")).toBe("原句一放就跟着说。");
    expect(planNote(planOf(1, 1), "shadow")).toBe("先只听 1 遍，再跟着原句说。");
    expect(planNote(planOf(1, 3), "shadow")).toBe("先只听 1 遍，再跟着原句说 3 遍，只保存最后一遍。");
    expect(planNote(planOf(0, 3), "shadow")).toBe("跟着原句说 3 遍，只保存最后一遍。");
    expect(planNote(planOf(1, 1), "listen")).toBe("先只听 1 遍，再放一遍原句，然后轮到你说。");
    expect(planNote(planOf(0, 2), "listen")).toBe("每遍先放原句、再轮到你说，连说 2 遍，只保存最后一遍。");
    expect(planNote(planOf(2, 2), "listen")).toBe("先只听 2 遍，然后每遍先放原句、再轮到你说，连说 2 遍，只保存最后一遍。");
  });
});
