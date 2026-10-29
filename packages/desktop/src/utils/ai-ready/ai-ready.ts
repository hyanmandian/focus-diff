import { useEffect, useState } from "react";

import { PROVIDERS } from "@/utils/ai/ai";
import { bridge, type AiStatus } from "@/utils/bridge/bridge";
import type { AiProvider, Config } from "@/utils/config/config";
import { i18n } from "@/utils/i18n/i18n";
import { platform } from "@/utils/platform/platform";

let asked: { at: number; statuses: Promise<AiStatus[]> } | null = null;

function statuses() {
  if (!asked || Date.now() - asked.at > 60_000) {
    const pending = bridge.aiStatuses();
    asked = { at: Date.now(), statuses: pending };
    pending.catch(() => {
      asked = null;
    });
  }
  return asked.statuses;
}

type Problem = { title: string; message: string };

export const aiProblem = (config: Config): Promise<Problem | null> => problemWith(config.ai.provider);

async function problemWith(provider: AiProvider | null): Promise<Problem | null> {
  const t = i18n();
  if (!provider) return { title: t("shared.aiOffTitle"), message: t("shared.aiOffMessage") };
  const status = (await statuses().catch(() => [])).find((s) => s.provider === provider);
  const name = PROVIDERS[provider].name;
  if (!status?.installed)
    return {
      title: t("shared.aiMissingTitle", { provider: name }),
      message: t("shared.aiMissingMessage", { provider: name }),
    };
  if (!status.signed_in)
    return {
      title: t("shared.aiSignedOutTitle", { provider: name }),
      message: t("shared.aiSignedOutMessage", { command: status.login_command }),
    };
  return null;
}

export async function ensureAi(config: Config): Promise<boolean> {
  const problem = await aiProblem(config);
  if (!problem) return true;
  if (await bridge.confirm(problem.title, problem.message, i18n()("shared.aiOpenSettings"))) await openAiSettings();
  return false;
}

export async function openAiSettings() {
  try {
    localStorage.setItem("settings-pane", "ai");
  } catch {}
  await bridge.openSettings();
  void platform()
    .emitTo("settings", "settings-pane", "ai")
    .catch(() => {});
  asked = null;
}

export function useAiProblem(config: Config | null) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const provider = config?.ai.provider ?? null;
  useEffect(() => {
    let live = true;
    const show = (p: Problem | null) => {
      if (live) setProblem(p);
    };
    const look = () => {
      void problemWith(provider).then(show);
    };
    if (provider) {
      look();
      window.addEventListener("focus", look);
    }
    return () => {
      live = false;
      window.removeEventListener("focus", look);
    };
  }, [provider]);
  return provider ? problem : null;
}
