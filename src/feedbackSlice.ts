// 意见反馈 part of the single store: whether the window (components/Feedback.tsx) is open, what has
// been written (kept while the app runs, so closing the window by accident loses nothing) and sending.
// Opened from settings (版本) and the app menu's 发送反馈… (`feedback:open`, on Mac).
import { api } from "./lib/api";
import { canSend } from "./lib/feedback";
import type { AppState } from "./store";

export interface FeedbackDraft {
  message: string;
  contact: string;
  /** 附上诊断信息, ticked to start with. */
  diagnostics: boolean;
}

export type FeedbackSend = { state: "idle" } | { state: "sending" } | { state: "sent" } | { state: "failed"; message: string };

export interface FeedbackState {
  feedbackOpen: boolean;
  feedbackDraft: FeedbackDraft;
  feedbackSend: FeedbackSend;
  setFeedbackOpen(open: boolean): void;
  editFeedback(patch: Partial<FeedbackDraft>): void;
  sendFeedback(): Promise<void>;
}

type Get = () => AppState;
type Set = (patch: Partial<AppState>) => void;

const EMPTY: FeedbackDraft = { message: "", contact: "", diagnostics: true };

export function createFeedbackSlice(set: Set, get: Get): FeedbackState {
  /** One that went out is done with: the window starts empty again. */
  const fresh = (): Partial<AppState> =>
    get().feedbackSend.state === "sent" ? { feedbackDraft: EMPTY, feedbackSend: { state: "idle" } } : {};

  return {
    feedbackOpen: false,
    feedbackDraft: EMPTY,
    feedbackSend: { state: "idle" },

    setFeedbackOpen(feedbackOpen) {
      if (!feedbackOpen) return set({ feedbackOpen, ...fresh() });
      set({ feedbackOpen, settingsOpen: false, wizardOpen: false, statsOpen: false, newsOpen: false, ...fresh() });
    },

    editFeedback(patch) {
      const { feedbackDraft, feedbackSend } = get();
      // Changing what failed to send clears the error.
      set({ feedbackDraft: { ...feedbackDraft, ...patch }, ...(feedbackSend.state === "failed" && { feedbackSend: { state: "idle" } }) });
    },

    async sendFeedback() {
      const { feedbackDraft: draft, feedbackSend } = get();
      // Once out, it isn't sent again (⌘↩ on the thank-you page).
      if (feedbackSend.state === "sending" || feedbackSend.state === "sent" || !canSend(draft.message, draft.contact)) return;
      set({ feedbackSend: { state: "sending" } });
      try {
        await api.feedback.send({ kind: "feedback", message: draft.message, contact: draft.contact, diagnostics: draft.diagnostics });
        set({ feedbackSend: { state: "sent" } });
      } catch (e) {
        set({ feedbackSend: { state: "failed", message: String(e) } });
      }
    },
  };
}
