import { useEffect } from "react";
import { useApp } from "../store";

/**
 * Asks the plugins for 注音 and other marks on the sentences not read yet (a new
 * transcript, an edit, another plugin or setting). Lives with the app, not with the
 * sentence list: 影院 shows only the sentence playing, and it needs the marks too,
 * even when the track was opened in 影院 and the list never showed.
 */
export function useAnnotations() {
  const sentences = useApp((s) => s.transcript?.sentences);
  const marksOn = useApp((s) => s.settings.annotations);
  const plugins = useApp((s) => s.plugins);
  useEffect(() => void useApp.getState().loadAnnotations(), [sentences, marksOn, plugins]);
}
