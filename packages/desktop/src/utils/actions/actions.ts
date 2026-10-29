import { bridge, github, type ActionContext } from "@/utils/bridge/bridge";
import type { Action, ActionStep } from "@/utils/config/config";
import { errorText } from "@/utils/error/error";
import { i18n } from "@/utils/i18n/i18n";

export function fill(template: string, pr: ActionContext, encode = false): string {
  return template.replaceAll(
    /\{(number|title|url|repo|author|me)\}/gu,
    (_, key: keyof ActionContext, offset: number) => {
      const value = String(pr[key]);
      return encode && offset > 0 ? encodeURIComponent(value) : value;
    },
  );
}

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
      if (users.length === 0 && teams.length === 0) return null;
      await github("POST", `${base}/pulls/${pr.number}/requested_reviewers`, {
        reviewers: users,
        team_reviewers: teams,
      });
      return null;
    }
    case "unrequestMe":
      await github("DELETE", `${base}/pulls/${pr.number}/requested_reviewers`, {
        reviewers: [pr.me],
        team_reviewers: [],
      });
      return null;
    case "label":
      if (step.labels.length === 0) return null;
      await github("POST", `${base}/issues/${pr.number}/labels`, { labels: step.labels });
      return null;
    case "open":
      if (!step.url.trim()) return null;
      await bridge.openUrl(fill(step.url.trim(), pr, true));
      return null;
    case "run":
      break;
  }
  return (await bridge.runAction(action, index, pr)) || null;
}

export async function runAction(action: Action, pr: ActionContext): Promise<string> {
  let said: string | null = null;
  for (const [index, step] of action.steps.entries()) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another: a failed step stops the rest
      said = (await runStep(action, index, step, pr)) ?? said;
    } catch (e) {
      const message = errorText(e);
      throw new Error(
        action.steps.length > 1
          ? i18n()("config.action.failed", { step: i18n()(`config.step.${step.kind}`), message })
          : message,
        { cause: e },
      );
    }
  }
  return said
    ? i18n()("config.action.said", { action: action.name, said })
    : i18n()("config.action.done", { action: action.name });
}
