// Running the person's own actions on a pull request, step by step, stopping at the first one that
// fails. GitHub steps go through the app's GitHub proxy; commands through Rust, which reads them
// from the saved config itself and asks before running one for the first time.

import { bridge, github, type ActionContext } from "./bridge";
import type { Action, ActionStep } from "./config";

/** {number} {title} {url} {repo} {author} {me} in text. In links (`encode`), values are encoded,
 *  except one that starts the link, like a bare {url}. */
export function fill(template: string, pr: ActionContext, encode = false): string {
  return template.replace(/\{(number|title|url|repo|author|me)\}/g, (_, key: keyof ActionContext, offset: number) => {
    const value = String(pr[key]);
    return encode && offset > 0 ? encodeURIComponent(value) : value;
  });
}

export const STEP_LABELS: Record<ActionStep["kind"], string> = {
  comment: "Comment",
  request: "Ask for reviews",
  unrequestMe: "Take me off the review",
  label: "Add labels",
  open: "Open a link",
  run: "Run a command",
};

async function runStep(action: Action, index: number, step: ActionStep, pr: ActionContext): Promise<string | null> {
  const base = `/repos/${pr.repo}`;
  switch (step.kind) {
    case "comment":
      if (!step.body.trim()) return null;
      await github("POST", `${base}/issues/${pr.number}/comments`, { body: fill(step.body, pr) });
      return null;
    case "request": {
      const users = step.reviewers.filter((r) => !r.includes("/"));
      const teams = step.reviewers.filter((r) => r.includes("/")).map((r) => r.split("/")[1]!);
      if (!users.length && !teams.length) return null;
      await github("POST", `${base}/pulls/${pr.number}/requested_reviewers`, { reviewers: users, team_reviewers: teams });
      return null;
    }
    case "unrequestMe":
      await github("DELETE", `${base}/pulls/${pr.number}/requested_reviewers`, { reviewers: [pr.me], team_reviewers: [] });
      return null;
    case "label":
      if (!step.labels.length) return null;
      await github("POST", `${base}/issues/${pr.number}/labels`, { labels: step.labels });
      return null;
    case "open":
      if (!step.url.trim()) return null;
      await bridge.openUrl(fill(step.url.trim(), pr, true));
      return null;
    case "run":
      return (await bridge.runAction(action, index, pr)) || null;
  }
}

/** Runs every step; resolves to what to tell the person. */
export async function runAction(action: Action, pr: ActionContext): Promise<string> {
  let said: string | null = null;
  for (const [index, step] of action.steps.entries()) {
    try {
      said = (await runStep(action, index, step, pr)) ?? said;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(action.steps.length > 1 ? `${STEP_LABELS[step.kind]}: ${message}` : message);
    }
  }
  return said ? `${action.name}: ${said}` : `${action.name}: done`;
}
