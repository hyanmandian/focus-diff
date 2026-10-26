// Brazilian Portuguese: the same keys as English (en/), checked by the compiler through
// `Dictionary` and by i18n.test.ts for the placeholders. Its words follow the Focus Diff
// extension's pt_BR and Apple's pt-BR conventions (sentence case, "Ajustes").
import type { Dictionary } from "@/lib/i18n";
import { common } from "./common";
import { config } from "./config";
import { diff } from "./diff";
import { events } from "./events";
import { manage } from "./manage";
import { panel } from "./panel";
import { review } from "./review";
import { settings } from "./settings";
import { setup } from "./setup";
import { shared } from "./shared";

export const ptBR: Dictionary = { common, config, diff, events, manage, panel, review, settings, setup, shared };
