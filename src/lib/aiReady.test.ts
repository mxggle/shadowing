import { describe, expect, it } from "vitest";
import type { AiConfig, AiOverview, LocalOverview, Preset } from "./api";
import { featureReady, firstOpenStep } from "./aiReady";

const preset = (id: string, over: Partial<Preset> = {}): Preset => ({
  id, name: id, api: "openAi", baseUrl: `https://${id}.example/v1`, local: false, key: "required", keyUrl: null,
  features: ["transcribe", "chat"], transcribeModel: null, transcribePrices: [], chatModel: null, note: "", ...over,
});
const presets = [
  preset("local", { api: "builtin", baseUrl: "", key: "none", local: true }),
  preset("groq"),
  preset("ollama", { key: "none", local: true }),
  preset("chatgpt", { key: "account", api: "responses" }),
  preset("custom", { baseUrl: "", key: "optional" }),
];
const overview = (config: Partial<AiConfig>): AiOverview => ({
  presets,
  config: { transcribe: { provider: null, model: "" }, chat: { provider: null, model: "" }, baseUrls: {}, keyHints: {}, chatgptClientId: null, chatgptHostId: null, ...config },
});
const local = (downloaded: boolean): LocalOverview => ({
  supported: true, chip: "Apple M1", reason: "", ramGb: 16, freeBytes: null, recommended: "turbo", downloading: null,
  models: [{ id: "turbo", name: "Turbo", size: 1, memoryGb: 1, note: "", downloaded, partial: 0, fit: "good" }],
});

describe("featureReady", () => {
  it("needs a service and a model", () => {
    expect(featureReady("transcribe", overview({}), null)).toBe(false);
    expect(featureReady("transcribe", overview({ transcribe: { provider: "groq", model: "" }, keyHints: { groq: "gsk…1" } }), null)).toBe(false);
  });
  it("needs a key or sign-in where the service asks for one", () => {
    const groq = { transcribe: { provider: "groq", model: "whisper-large-v3" } };
    expect(featureReady("transcribe", overview(groq), null)).toBe(false);
    expect(featureReady("transcribe", overview({ ...groq, keyHints: { groq: "gsk…1" } }), null)).toBe(true);
    const chatgpt = { chat: { provider: "chatgpt", model: "gpt" } };
    expect(featureReady("chat", overview(chatgpt), null)).toBe(false);
    expect(featureReady("chat", overview({ ...chatgpt, keyHints: { chatgpt: "a@b.c" } }), null)).toBe(true);
    expect(featureReady("chat", overview({ chat: { provider: "ollama", model: "qwen" } }), null)).toBe(true);
  });
  it("custom servers need an address", () => {
    const custom = { chat: { provider: "custom", model: "m" } };
    expect(featureReady("chat", overview(custom), null)).toBe(false);
    expect(featureReady("chat", overview({ ...custom, baseUrls: { custom: "http://x/v1" } }), null)).toBe(true);
  });
  it("on this Mac, the model must be downloaded", () => {
    const mine = overview({ transcribe: { provider: "local", model: "turbo" } });
    expect(featureReady("transcribe", mine, local(false))).toBe(false);
    expect(featureReady("transcribe", mine, local(true))).toBe(true);
  });
});

describe("firstOpenStep", () => {
  it("resumes at the first unfinished step", () => {
    const transcribe = { transcribe: { provider: "local", model: "turbo" } };
    expect(firstOpenStep(overview({}), local(true))).toBe(0);
    expect(firstOpenStep(overview(transcribe), local(true))).toBe(1);
    expect(firstOpenStep(overview({ ...transcribe, chat: { provider: "ollama", model: "q" } }), local(true))).toBe(2);
  });
});
