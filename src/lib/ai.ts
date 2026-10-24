// What the optional AI is asked, and with what: built here, answered by the person's own agent CLI
// (src-tauri/src/ai.rs). Nothing is sent unless they turned it on and asked.

import { bridge } from "./bridge";
import type { Config } from "./config";
import type { Details } from "./details";
import { loadFiles } from "./review";

export const PROVIDERS = {
  claude: { name: "Claude Code", install: "https://claude.com/product/claude-code" },
  codex: { name: "Codex", install: "https://developers.openai.com/codex/cli" },
  cursor: { name: "Cursor", install: "https://cursor.com/cli" },
} as const;

const SUMMARY = `You're helping someone review a GitHub pull request. From its description and diff below, write:
1. What it changes, in two or three plain sentences.
2. "Worth a closer look:" then up to five short points: risks, edge cases, missing tests, or anything surprising, each naming the file.
Be concrete and brief. Plain text: no headings, no tables; start each point with "- ". Don't repeat the description back.`;

function material(details: Details, diff: string) {
  const body = new DOMParser().parseFromString(details.html, "text/html").body.textContent ?? "";
  return [
    `Title: ${details.title}`,
    `Repository: ${details.owner}/${details.repo} #${details.number}, ${details.headRefName} into ${details.baseRefName}`,
    `Description:\n${body.trim() || "(none)"}`,
    `Diff:\n${diff}`,
  ].join("\n\n");
}

export async function summarize(config: Config, details: Details): Promise<string> {
  const provider = config.ai.provider;
  if (!provider) throw new Error("Turn on AI in Settings first.");
  const files = await loadFiles(details);
  const diff = files.map((f) => f.patch || `${f.path}: (no patch: binary or too large)`).join("\n");
  return bridge.aiAsk(provider, config.ai.model, SUMMARY, material(details, diff));
}
