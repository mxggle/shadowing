import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import { ACTION_LABELS, ACTIONS, DEFAULT_KEYS, keyName, keyOf, keymap, rebind, reset, type Action } from "../../lib/keymap";
import { shortcut } from "../../lib/platform";
import { useApp } from "../../store";
import { IconButton, Kbd, TextLink } from "../ui";

/** What an action is called (the record key's label names ⇧, which Windows calls Shift). */
const label = (action: Action) => t(ACTION_LABELS[action], { shift: shortcut("⇧") });

/** What a row says under it for a moment: who it swapped keys with, or why a key can't be used. */
type Note = { action: Action; text: string };
const NOTE_MS = 4000;

/**
 * 快捷键: every key the player answers to, each changeable. Click a key, press the one you want;
 * an action that had it takes the old one (they swap). Esc, ? and the ⌘ shortcuts stay.
 */
export function ShortcutsSection() {
  const custom = useApp((s) => s.settings.shortcuts);
  const [listening, setListening] = useState<Action | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const map = keymap(custom);
  const changed = Object.keys(custom).length > 0;

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  const save = (next: Record<string, string>) => useApp.getState().setShortcuts(next);

  // While picking, the next key is the one (on the window: a clicked button doesn't take the
  // keyboard on a Mac). Capture phase, ahead of the settings' own Esc and the player's keys.
  useEffect(() => {
    if (!listening) return;
    const action = listening;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") return setListening(null);
      // ⌘, Ctrl or Alt held: say so the moment it goes down, and keep listening for the one key.
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === "AltGraph") return setNote({ action, text: t("只能设单个键，不能用组合键") });
      if (["Shift", "CapsLock"].includes(e.key)) return; // still listening
      const key = keyOf(e);
      setListening(null);
      if (key === null) return setNote({ action, text: t("{key} 留给应用自己用，换一个吧", { key: e.key }) });
      const current = useApp.getState().settings.shortcuts;
      const { custom: next, swapped } = rebind(current, action, key);
      save(next);
      setNote(swapped ? { action, text: t("和「{other}」交换了按键", { other: label(swapped) }) } : null);
    };
    const onPointer = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.("[data-key-capture]")) setListening(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [listening]);

  return (
    <section id="settings-shortcuts" className="border-t border-line pt-5 pb-1">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-[12px] font-medium text-faint">{t("快捷键")}</h3>
        {changed && (
          <TextLink className="text-[12px]" onClick={() => (save(reset(custom)), setNote(null))}>
            {t("全部恢复默认")}
          </TextLink>
        )}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        {t("点一个按键，再按你想用的单个键；已经有用处的键会和它交换。Esc、? 和带 {mod} 的快捷键不能改。", { mod: shortcut("⌘") })}
      </p>
      <dl className="mt-2.5 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {ACTIONS.map((action) => {
          const own = map[action] !== DEFAULT_KEYS[action];
          return (
            <div key={action} className="flex min-h-9 flex-col justify-center border-b border-line py-1 last:border-b-0">
              <div className="flex items-center gap-2">
                <dt className="min-w-0 flex-1 text-[13px] text-fg/90">{label(action)}</dt>
                <dd className="flex items-center gap-0.5">
                  {own && (
                    <IconButton title={t("恢复默认（{key}）", { key: keyName(DEFAULT_KEYS[action]) })} onClick={() => save(reset(custom, action))} className="!h-6 !min-w-6">
                      <RotateCcw />
                    </IconButton>
                  )}
                  <button
                    data-key-capture={listening === action || undefined}
                    aria-label={t("{action}的按键：{key}", { action: label(action), key: keyName(map[action]) })}
                    title={listening === action ? t("按一个键（Esc 取消）") : t("点一下换个键")}
                    onClick={() => setListening(listening === action ? null : action)}
                    className={`grid h-7 min-w-[64px] place-items-center rounded-[7px] px-2 text-[12px] transition-[background-color,box-shadow] duration-150 ${
                      listening === action ? "bg-raised text-fg shadow-[0_0_0_1.5px_var(--line-strong)]" : "tint hover:bg-hover"
                    }`}
                  >
                    {listening === action ? <span className="text-muted">{t("按一个键…")}</span> : <Kbd className={own ? "!text-fg" : ""}>{keyName(map[action])}</Kbd>}
                  </button>
                </dd>
              </div>
              {note?.action === action && <p className="animate-fade pb-1 text-[11px] text-muted">{note.text}</p>}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
