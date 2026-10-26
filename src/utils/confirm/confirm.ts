// Asking before something is removed for good: a native alert, Remove or Cancel.

import { bridge } from "@/utils/bridge/bridge";
import { i18n } from "@/utils/i18n/i18n";

/** `question`: what's about to go, by name ("Remove the “Frontend” filter?"). */
export const confirmRemove = (question: string) => {
  const t = i18n();
  return bridge.confirm(question, t("settings.removeConfirmMessage"), t("settings.removeConfirmButton"));
};
