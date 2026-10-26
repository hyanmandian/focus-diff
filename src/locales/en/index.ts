// English, the source of truth: every key and placeholder is defined here first. One file per
// part of the app; a key is "file.name" (lib/i18n.ts).
import { common } from "./common";
import { config } from "./config";
import { diff } from "./diff";
import { events } from "./events";
import { panel } from "./panel";
import { review } from "./review";
import { settings } from "./settings";
import { setup } from "./setup";
import { shared } from "./shared";

export const en = { common, config, diff, events, panel, review, settings, setup, shared } as const;
