import { bridge } from "@/utils/bridge/bridge";
import { i18n } from "@/utils/i18n/i18n";

export const confirmRemove = (question: string) => {
  const t = i18n();
  return bridge.confirm(question, t("settings.removeConfirmMessage"), t("settings.removeConfirmButton"));
};
