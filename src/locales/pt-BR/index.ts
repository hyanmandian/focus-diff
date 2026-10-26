// Brazilian Portuguese: the same keys as English (en/), checked by the compiler through
// `Dictionary` and by i18n.test.ts for the placeholders. Its words follow the Focus Diff
// extension's pt_BR and Apple's pt-BR conventions (sentence case, "Ajustes").
import type { Dictionary } from "@/utils/i18n/i18n";
import { common } from "@/locales/pt-BR/common";
import { config } from "@/locales/pt-BR/config";
import { diff } from "@/locales/pt-BR/diff";
import { events } from "@/locales/pt-BR/events";
import { manage } from "@/locales/pt-BR/manage";
import { panel } from "@/locales/pt-BR/panel";
import { review } from "@/locales/pt-BR/review";
import { settings } from "@/locales/pt-BR/settings";
import { setup } from "@/locales/pt-BR/setup";
import { shared } from "@/locales/pt-BR/shared";

export const ptBR: Dictionary = { common, config, diff, events, manage, panel, review, settings, setup, shared };
