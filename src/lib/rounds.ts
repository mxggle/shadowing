// 跟读方案 for one take: hear the sentence a few times (only listening), then
// say it several times in a row, each time the take's way (听完再说: the
// original, then you; 边听边说: you along with it). Only the last time is kept;
// the ones before are practice. The store walks these steps (recordSlice.ts).
import type { RecordMode } from "./api";

export const LISTENS = { min: 0, max: 3 };
export const REPEATS = { min: 1, max: 5 };

export interface RoundPlan {
  /** Times the original plays before you first speak, only to listen. */
  listens: number;
  /** Times you say it; the last one is kept. */
  repeats: number;
}

/** Where a take is: hearing the original only, or saying it (`n` counts from 1). */
export type Step = { kind: "hear"; n: number } | { kind: "say"; n: number };

const clamp = (v: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));

/** A plan from settings (anything out of range is brought back in). */
export function planOf(listens: number | undefined, repeats: number | undefined): RoundPlan {
  return { listens: clamp(listens ?? 0, LISTENS), repeats: clamp(repeats ?? 1, REPEATS) };
}

export function firstStep(plan: RoundPlan): Step {
  return plan.listens > 0 ? { kind: "hear", n: 1 } : { kind: "say", n: 1 };
}

/** The step after `step`, or null once the last time has been said (keep it). */
export function nextStep(plan: RoundPlan, step: Step): Step | null {
  if (step.kind === "hear") return step.n < plan.listens ? { kind: "hear", n: step.n + 1 } : { kind: "say", n: 1 };
  return step.n < plan.repeats ? { kind: "say", n: step.n + 1 } : null;
}

/** Saying it for the last time: this one is kept. */
export const isLast = (plan: RoundPlan, step: Step) => step.kind === "say" && step.n >= plan.repeats;

/** Just the one time, nothing before it (as it was before plans). */
export const isPlain = (plan: RoundPlan) => plan.listens === 0 && plan.repeats === 1;

/** Shown while recording, next to 只听原句 / 轮到你了: 1 / 2, 第 2 / 3 遍; null when there's only the one. */
export function stepCount(plan: RoundPlan, step: Step): string | null {
  if (step.kind === "hear") return plan.listens > 1 ? `${step.n} / ${plan.listens}` : null;
  return plan.repeats > 1 ? `第 ${step.n} / ${plan.repeats} 遍` : null;
}

/** On the plan's button: 跟读 1 遍 · 听 1 · 跟读 3 遍. */
export function planLabel(plan: RoundPlan): string {
  return `${plan.listens ? `听 ${plan.listens} · ` : ""}跟读 ${plan.repeats} 遍`;
}

/** What pressing M will do, in a sentence. */
export function planNote(plan: RoundPlan, mode: RecordMode): string {
  const hear = plan.listens ? `先只听 ${plan.listens} 遍，` : "";
  if (mode === "shadow") {
    const along = plan.repeats > 1 ? `跟着原句说 ${plan.repeats} 遍，只保存最后一遍` : "跟着原句说";
    return hear ? `${hear}再${along}。` : plan.repeats > 1 ? `${along}。` : "原句一放就跟着说。";
  }
  if (plan.repeats === 1) return `${hear}${hear ? "再" : "先"}放一遍原句，然后轮到你说。`;
  return `${hear}${hear ? "然后" : ""}每遍先放原句、再轮到你说，连说 ${plan.repeats} 遍，只保存最后一遍。`;
}
