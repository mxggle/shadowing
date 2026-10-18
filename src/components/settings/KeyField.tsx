import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AiConfig, type Preset } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button, fieldClass, TextLink } from "../ui";

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
          <span className="tabular truncate font-mono text-[12px]">{hint}</span>
          <span className="truncate text-[12px] text-faint">{t("已保存在钥匙串", "Saved in Keychain")}</span>
          <span className="ml-auto flex gap-1.5">
            <Button onClick={() => setEditing(true)}>{t("更换", "Change")}</Button>
            <Button
              onClick={() => (confirmDelete ? void store("") : setConfirmDelete(true))}
              className={confirmDelete ? "text-danger" : ""}
            >
              {confirmDelete ? t("确认删除", "Confirm Delete") : t("删除", "Delete")}
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
            placeholder={
              preset.key === "optional"
                ? t("没有可以不填", "Leave blank if you don’t have one")
                : t(`粘贴 ${preset.name} 的 API Key`, `Paste your ${preset.name} API key`)
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) void store(draft);
            }}
          />
          <Button primary disabled={!draft.trim()} onClick={() => void store(draft)}>
            {t("保存", "Save")}
          </Button>
          {hint && (
            <Button
              onClick={() => {
                setEditing(false);
                setDraft("");
              }}
            >
              {t("取消", "Cancel")}
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}
      {preset.keyUrl && (!hint || editing) && (
        <TextLink onClick={() => void api.ai.openKeyPage(preset.id)} className="flex items-center gap-1 text-[12px]">
          {t(`去 ${preset.name} 创建 API Key`, `Create an API key at ${preset.name}`)}
          <ExternalLink size={12} />
        </TextLink>
      )}
    </div>
  );
}
