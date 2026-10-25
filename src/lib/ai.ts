// What the optional AI is asked, and with what: built here, answered by the person's own agent CLI
// (src-tauri/src/ai.rs). Nothing is sent unless they turned it on and asked.

import { bridge } from "./bridge";
import type { AiProvider, Config, Effort } from "./config";
import type { Details } from "./details";
import { loadFiles } from "./review";

export const PROVIDERS: Record<AiProvider, { name: string; install: string; efforts: Array<Effort | ""> }> = {
  claude: { name: "Claude Code", install: "https://claude.com/product/claude-code", efforts: ["", "low", "medium", "high", "xhigh", "max"] },
  codex: { name: "Codex", install: "https://developers.openai.com/codex/cli", efforts: ["", "minimal", "low", "medium", "high", "xhigh"] },
  // Cursor's effort is part of the model's name.
  cursor: { name: "Cursor", install: "https://cursor.com/cli", efforts: [] },
  opencode: { name: "OpenCode", install: "https://opencode.ai", efforts: ["", "minimal", "low", "medium", "high", "max"] },
};

export const EFFORT_LABELS: Record<Effort | "", string> = {
  "": "Default",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const ROLE = "You're helping someone review a GitHub pull request; its description and diff are below.";
// AiAnswer shows paragraphs, "- " points, `code` and **bold**: nothing else.
const FORMAT = 'Plain text: short paragraphs, "- " to start a point, `backticks` for code names. No headings, no tables.';

function material(details: Details, diff: string) {
  const body = new DOMParser().parseFromString(details.html, "text/html").body.textContent ?? "";
  return [
    `Title: ${details.title}`,
    `Repository: ${details.owner}/${details.repo} #${details.number}, ${details.headRefName} into ${details.baseRefName}`,
    `Description:\n${body.trim() || "(none)"}`,
    `Diff:\n${diff}`,
  ].join("\n\n");
}

/** Asks the person's AI about a pull request: one of their prompts, or a question of their own. */
export async function ask(config: Config, details: Details, question: string): Promise<string> {
  const { provider, model, effort, instructions } = config.ai;
  if (!provider) throw new Error("Turn on AI in Settings first.");
  const files = await loadFiles(details);
  const diff = files.map((f) => f.patch || `${f.path}: (no patch: binary or too large)`).join("\n");
  const guidelines = instructions.trim() ? `\n\nThe reviewer's own guidelines, to follow:\n${instructions.trim()}` : "";
  const prompt = `${ROLE}\n\n${question.trim()}${guidelines}\n\n${FORMAT}`;
  return bridge.aiAsk(provider, model, effort, prompt, material(details, diff));
}
