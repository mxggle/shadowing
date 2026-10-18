import { LoaderCircle, LogIn } from "lucide-react";
import { useState } from "react";
import { api, type AiConfig } from "../../lib/api";
import { isCancelled, t } from "../../lib/i18n";
import { Button } from "../ui";

/**
 * OpenRouter's official browser sign-in: the user approves in the browser and
 * OpenRouter hands back a normal API key (saved to the Keychain like a pasted one).
 */
export function OpenRouterSignIn({ onSaved }: { onSaved: (c: AiConfig) => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setWaiting(true);
    setError(null);
    try {
      onSaved(await api.ai.signInOpenRouter());
    } catch (e) {
      if (!isCancelled(e)) setError(String(e));
    } finally {
      setWaiting(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {waiting ? (
        <div className="flex items-center gap-2">
          <LoaderCircle size={14} className="animate-spin text-muted" />
          <span className="text-[12px] text-muted">{t("请在浏览器里完成授权…")}</span>
          <Button className="ml-auto h-7" onClick={() => void api.ai.cancelSignIn()}>
            {t("取消")}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button primary onClick={() => void signIn()}>
            <LogIn size={14} />
            {t("用 OpenRouter 账号登录")}
          </Button>
          <span className="text-[12px] text-faint">{t("在浏览器里授权，自动生成 Key")}</span>
        </div>
      )}
      {error && <p className="text-[12px] break-words text-danger">{error}</p>}
      <p className="text-[12px] text-faint">{t("或者粘贴已有的 API Key：")}</p>
    </div>
  );
}
