import { LoaderCircle, LogIn } from "lucide-react";
import { useState } from "react";
import { api, type AiConfig } from "../../lib/api";
import { Button } from "../ui";

/**
 * Sign in with ChatGPT (OpenAI preview): explanations use the learner's Plus/Pro
 * plan instead of an API key. Tokens stay in the Keychain; only the email shows here.
 */
export function ChatGPTAccount({ email, onSaved }: { email?: string; onSaved: (c: AiConfig) => void }) {
  const [busy, setBusy] = useState<"signIn" | "signOut" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "signIn" | "signOut") {
    setBusy(kind);
    setError(null);
    try {
      onSaved(kind === "signIn" ? await api.ai.signInChatGPT() : await api.ai.signOutChatGPT());
    } catch (e) {
      if (!String(e).includes("已取消")) setError(String(e));
      // Signing out always clears this Mac, even if OpenAI couldn't confirm it.
      if (kind === "signOut") onSaved((await api.ai.get()).config);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {email ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px]">{email}</span>
          <span className="shrink-0 text-[12px] text-faint">已登录</span>
          <Button className="ml-auto" disabled={busy !== null} onClick={() => void run("signOut")}>
            {busy === "signOut" && <LoaderCircle size={14} className="animate-spin" />}
            退出登录
          </Button>
        </div>
      ) : busy === "signIn" ? (
        <div className="flex items-center gap-2">
          <LoaderCircle size={14} className="animate-spin text-muted" />
          <span className="text-[12px] text-muted">请在浏览器里登录并授权…</span>
          <Button className="ml-auto h-7" onClick={() => void api.ai.cancelSignIn()}>
            取消
          </Button>
        </div>
      ) : (
        <>
          <div>
            <Button primary onClick={() => void run("signIn")}>
              <LogIn size={14} />
              用 ChatGPT 登录
            </Button>
          </div>
          <p className="text-[12px] text-faint">
            需要 ChatGPT Plus 或 Pro。解释会占用你的套餐额度（Plus 在所有应用间每 5 小时共享一个上限）。
          </p>
        </>
      )}
      {error && <p className="text-[12px] break-words text-danger">{error}</p>}
    </div>
  );
}
