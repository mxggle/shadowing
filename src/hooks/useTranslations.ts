import { useEffect } from "react";
import { featureReady } from "../lib/aiReady";
import { useApp } from "../store";

/**
 * Loads the open track's 译文 and translates what's missing: a new track or transcript, an edit,
 * translations turned on, another language, or a model set up for explanations. Lives with the
 * app, not the sentence list: 影院 shows the translation of the sentence playing too.
 */
export function useTranslations() {
  const path = useApp((s) => s.current?.path);
  const sentences = useApp((s) => s.transcript?.sentences);
  const on = useApp((s) => s.settings.translation !== "off");
  const to = useApp((s) => s.settings.translateTo);
  const lang = useApp((s) => s.lang);
  const ready = useApp((s) => featureReady("chat", s.ai, s.local));
  useEffect(() => void useApp.getState().loadTranslations(), [path, sentences, on, to, lang, ready]);
}
