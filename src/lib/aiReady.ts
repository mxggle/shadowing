// Whether a feature has everything it needs to run. Used by the transcribe
// card (open the setup wizard instead) and by the wizard to pick where to resume.
import { LOCAL_PROVIDER, type AiConfig, type AiOverview, type Feature, type LocalOverview, type Preset } from "./api";

/** Address set, and a key or sign-in where the service needs one. */
export function serviceReady(preset: Preset, config: AiConfig): boolean {
  const baseUrl = config.baseUrls[preset.id] ?? preset.baseUrl;
  const needsKey = preset.key === "required" || preset.key === "account";
  return !!baseUrl && (!needsKey || !!config.keyHints[preset.id]);
}

export function featureReady(feature: Feature, ai: AiOverview | null, local: LocalOverview | null): boolean {
  const choice = ai?.config[feature];
  if (!ai || !choice?.provider || !choice.model) return false;
  if (choice.provider === LOCAL_PROVIDER) return !!local?.models.find((m) => m.id === choice.model)?.downloaded;
  const preset = ai.presets.find((p) => p.id === choice.provider);
  return !!preset && serviceReady(preset, ai.config);
}

/** The wizard reopens at the first step that isn't done (2 = the test). */
export function firstOpenStep(ai: AiOverview | null, local: LocalOverview | null): 0 | 1 | 2 {
  if (!featureReady("transcribe", ai, local)) return 0;
  if (!featureReady("chat", ai, local)) return 1;
  return 2;
}
