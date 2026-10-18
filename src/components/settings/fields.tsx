// Small form pieces shared by the AI settings rows.
import { AlertTriangle, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AiConfig, type Preset } from "../../lib/api";
import { t } from "../../lib/i18n";
import { fieldClass } from "../ui";

export function Label({ children }: { children: React.ReactNode }) {
  return <span className="pt-[7px] text-[12px] font-medium text-muted">{children}</span>;
}

export function TestResult({ kind, text }: { kind: "ok" | "warn" | "error"; text: string }) {
  const [Icon, color] = { ok: [Check, "text-ok"], warn: [AlertTriangle, "text-warn"], error: [X, "text-danger"] }[kind] as [
    typeof Check,
    string,
  ];
  return (
    <p className={`flex min-w-0 animate-fade-in items-start gap-1.5 pt-1.5 text-[12px] ${color}`}>
      <Icon size={14} className="mt-px shrink-0" />
      <span className="break-words">{text}</span>
    </p>
  );
}

/** Saved on blur or Enter; an empty field goes back to the default address. */
export function UrlField({ preset, value, onSaved }: { preset: Preset; value: string; onSaved: (c: AiConfig) => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  async function commit() {
    if (draft.trim() === value) return;
    try {
      onSaved(await api.ai.setBaseUrl(preset.id, draft));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <input
        className={fieldClass}
        value={draft}
        spellCheck={false}
        placeholder={preset.baseUrl || "https://example.com/v1"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

const MANUAL = "\u0000manual";

/** A list when the service gave one; typing by hand is always possible. */
export function ModelPicker({ value, models, onChange }: { value: string; models: string[] | null; onChange: (m: string) => void }) {
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const listed = !!models?.length && !manual && (!value || models.includes(value));

  if (listed) {
    return (
      <select
        className={fieldClass}
        value={value}
        onChange={(e) => (e.target.value === MANUAL ? setManual(true) : onChange(e.target.value))}
      >
        {!value && <option value="">{t("请选择模型")}</option>}
        {models!.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value={MANUAL}>{t("手动输入…")}</option>
      </select>
    );
  }
  return (
    <input
      className={fieldClass}
      value={draft}
      autoFocus={manual}
      spellCheck={false}
      placeholder={t("模型名称")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setManual(false);
        onChange(draft.trim());
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
