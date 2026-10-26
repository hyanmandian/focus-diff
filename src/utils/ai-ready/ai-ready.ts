// Whether the AI chosen in Settings can answer on this Mac: its app installed and signed in. Asked
// before anything is sent to it, so a click on an AI button says what's missing and leads to
// Settings, rather than failing after a wait. The answer is kept a minute (it runs the CLI).

import { emitTo } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { PROVIDERS } from "@/utils/ai/ai";
import { bridge, type AiStatus } from "@/utils/bridge/bridge";
import type { Config } from "@/utils/config/config";
import { i18n } from "@/utils/i18n/i18n";

let asked: { at: number; statuses: Promise<AiStatus[]> } | null = null;

function statuses() {
  if (!asked || Date.now() - asked.at > 60_000) {
    const statuses = bridge.aiStatuses();
    asked = { at: Date.now(), statuses };
    statuses.catch(() => (asked = null));
  }
  return asked.statuses;
}

/** What stands between the chosen AI and an answer: nothing, or what to tell the person. */
export async function aiProblem(config: Config): Promise<{ title: string; message: string } | null> {
  const t = i18n();
  const provider = config.ai.provider;
  if (!provider) return { title: t("shared.aiOffTitle"), message: t("shared.aiOffMessage") };
  const status = (await statuses().catch(() => [])).find((s) => s.provider === provider);
  const name = PROVIDERS[provider].name;
  if (!status?.installed) return { title: t("shared.aiMissingTitle", { provider: name }), message: t("shared.aiMissingMessage", { provider: name }) };
  if (!status.signed_in) return { title: t("shared.aiSignedOutTitle", { provider: name }), message: t("shared.aiSignedOutMessage", { command: status.login_command }) };
  return null;
}

/** True when the AI can answer; otherwise says why in an alert whose default button opens its
 *  settings, and is false. */
export async function ensureAi(config: Config): Promise<boolean> {
  const problem = await aiProblem(config);
  if (!problem) return true;
  if (await bridge.confirm(problem.title, problem.message, i18n()("shared.aiOpenSettings"))) await openAiSettings();
  return false;
}

/** Settings, on its AI pane. */
export async function openAiSettings() {
  try {
    localStorage.setItem("settings-pane", "ai");
  } catch {
    /* opens where it was */
  }
  await bridge.openSettings();
  // Already open on another pane: told to show this one.
  void emitTo("settings", "settings-pane", "ai").catch(() => {});
  // Asked again once they're back, set up or not.
  asked = null;
}

/** `aiProblem`, kept current while the window is up (looked at again when it comes forward). */
export function useAiProblem(config: Config | null) {
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null);
  const provider = config?.ai.provider;
  useEffect(() => {
    if (!config || !provider) return setProblem(null);
    let live = true;
    const look = () => void aiProblem(config).then((p) => live && setProblem(p));
    look();
    window.addEventListener("focus", look);
    return () => {
      live = false;
      window.removeEventListener("focus", look);
    };
    // Only the chosen AI matters here, not the rest of the setup.
  }, [provider]);
  return problem;
}
