// The CHANGELOG.md this build was made with, read once, for 新功能 (WhatsNew.tsx).
import changelog from "../CHANGELOG.md?raw";
import { parseChangelog } from "./lib/changelog";

export const releases = parseChangelog(changelog);
