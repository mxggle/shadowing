import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AiConfig, type Preset } from "../../lib/api";
import { Button, fieldClass } from "../ui";

/**
 * A saved key shows only as "sk-…abcd"; the key itself goes to Rust once and
 * into the Keychain, and never comes back to this page.
 */
export function KeyField({ preset, hint, onSaved }: { preset: Preset; hint?: string; onSaved: (c: AiConfig) => void }) {
  const [editing, setEditing] = useState(!hint);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A key saved elsewhere (e.g. by signing in) shows as saved, not as an open field.
  useEffect(() => {
    if (hint) setEditing(false);
  }, [hint]);

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  async function store(key: string) {
    try {
      onSaved(await api.ai.setKey(preset.id, key));
      setDraft("");
      setError(null);
      setEditing(!key);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {hint && !editing ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="tabular truncate text-[13px]">{hint}</span>
          <span className="truncate text-[12px] text-faint">已保存在钥匙串</span>
          <span className="ml-auto flex gap-1.5">
            <Button onClick={() => setEditing(true)}>更换</Button>
            <Button
              onClick={() => (confirmDelete ? void store("") : setConfirmDelete(true))}
              className={confirmDelete ? "text-danger" : ""}
            >
              {confirmDelete ? "确认删除" : "删除"}
            </Button>
          </span>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="password"
            className={fieldClass}
            value={draft}
            autoFocus={!!hint}
            autoComplete="off"
            spellCheck={false}
            placeholder={preset.key === "optional" ? "没有可以不填" : `粘贴 ${preset.name} 的 API Key`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) void store(draft);
            }}
          />
          <Button primary disabled={!draft.trim()} onClick={() => void store(draft)}>
            保存
          </Button>
          {hint && (
            <Button
              onClick={() => {
                setEditing(false);
                setDraft("");
              }}
            >
              取消
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}
      {preset.keyUrl && (!hint || editing) && (
        <button
          onClick={() => void api.ai.openKeyPage(preset.id)}
          className="flex w-fit items-center gap-1 text-[12px] text-fg underline decoration-fg/30 underline-offset-2 hover:decoration-fg"
        >
          去 {preset.name} 创建 API Key
          <ExternalLink size={12} />
        </button>
      )}
    </div>
  );
}
