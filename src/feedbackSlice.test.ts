import { beforeEach, describe, expect, it, vi } from "vitest";

// A plain stand-in for api.feedback.send (Tauri's invoke rejects with a string).
let reply: () => Promise<void> = () => Promise.resolve();
const sent: unknown[] = [];
vi.mock("./lib/api", () => ({ api: { feedback: { send: (feedback: unknown) => (sent.push(feedback), reply()) } } }));

const { createFeedbackSlice } = await import("./feedbackSlice");
type Slice = ReturnType<typeof createFeedbackSlice>;

/** The slice on its own, with the other sheets' flags it closes. */
function store() {
  let state = {} as Slice & Record<string, unknown>;
  const set = (patch: object) => void (state = { ...state, ...patch });
  state = { ...createFeedbackSlice(set as never, (() => state) as never), settingsOpen: true };
  return () => state;
}

describe("feedbackSlice", () => {
  beforeEach(() => {
    sent.length = 0;
    reply = () => Promise.resolve();
  });

  it("opens over settings and keeps the draft when closed", () => {
    const get = store();
    get().setFeedbackOpen(true);
    expect(get()).toMatchObject({ feedbackOpen: true, settingsOpen: false });
    get().editFeedback({ message: "录音没声音" });
    get().setFeedbackOpen(false);
    expect(get().feedbackDraft.message).toBe("录音没声音");
  });

  it("sends what was written, ignores edits meanwhile, and starts empty after", async () => {
    let done = () => {};
    reply = () => new Promise<void>((r) => (done = r));
    const get = store();
    get().editFeedback({ message: "录音没声音", contact: "me@example.com" });
    const sending = get().sendFeedback();
    get().editFeedback({ message: "改了" });
    expect(get().feedbackDraft.message).toBe("录音没声音");
    done();
    await sending;
    expect(sent).toEqual([{ kind: "feedback", message: "录音没声音", contact: "me@example.com", diagnostics: true }]);
    expect(get().feedbackSend.state).toBe("sent");
    await get().sendFeedback();
    expect(sent).toHaveLength(1);
    get().setFeedbackOpen(false);
    expect(get().feedbackDraft.message).toBe("");
  });

  it("keeps the draft and the reason when sending fails", async () => {
    reply = () => Promise.reject("发送失败，请检查网络后再试");
    const get = store();
    get().editFeedback({ message: "想要导出" });
    await get().sendFeedback();
    expect(get().feedbackSend).toEqual({ state: "failed", message: "发送失败，请检查网络后再试" });
    expect(get().feedbackDraft.message).toBe("想要导出");
    get().editFeedback({ message: "想要导出到 Anki" });
    expect(get().feedbackSend.state).toBe("idle");
  });

  it("sends nothing empty", async () => {
    const get = store();
    get().editFeedback({ message: "  \n" });
    await get().sendFeedback();
    expect(sent).toHaveLength(0);
  });
});
