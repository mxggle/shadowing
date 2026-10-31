// English for the interface, keyed by the Chinese text the code shows (see src/lib/i18n.ts).
// One file per part of the app; src/lib/i18n.test.ts checks every t("…") in the code has an entry.
import type { Entry } from "../lib/i18n";
import { app } from "./en/app";
import { guide } from "./en/guide";
import { settings } from "./en/settings";
import { player } from "./en/player";
import { record } from "./en/record";
import { library } from "./en/library";
import { pace } from "./en/pace";
import { book } from "./en/book";

export const en: Record<string, Entry> = { ...app, ...guide, ...settings, ...player, ...record, ...library, ...pace, ...book };
