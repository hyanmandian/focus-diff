// English, the source of truth: every key and placeholder is defined here first. One file per
// part of the app; a key is "file.name" (utils/i18n/i18n.ts).
import { common } from "@/locales/en/common";
import { config } from "@/locales/en/config";
import { diff } from "@/locales/en/diff";
import { events } from "@/locales/en/events";
import { manage } from "@/locales/en/manage";
import { panel } from "@/locales/en/panel";
import { review } from "@/locales/en/review";
import { settings } from "@/locales/en/settings";
import { setup } from "@/locales/en/setup";
import { shared } from "@/locales/en/shared";

export const en = { common, config, diff, events, manage, panel, review, settings, setup, shared } as const;
