// Viewed marks on their way to GitHub, as the desktop's outbox.rs. What's marked in a review is what counts: each mark
// is kept in storage and sent until GitHub takes it, through failures and restarts, the latest mark per file winning.

import { storage } from "#imports";
import type { GitHubApi } from "@/utils/github-api/github-api";
import { isRecord } from "@/utils/record/record";
import { createSender, type Outcome } from "@/utils/sender/sender";

/** One file to mark viewed, or not, on a pull request (its node id). */
export type Mark = {
  pull: string;
  path: string;
  viewed: boolean;
  /** Times GitHub answered but didn't take it, to give up on one it never will. */
  refused: number;
};

/** A mark GitHub keeps refusing (the file left the pull request, the pull request is gone) is dropped after this
 *  many tries. */
export const MOST_REFUSALS = 8;

export const outboxItem = storage.defineItem<Mark[]>("local:outbox", { fallback: [] });

/** How a mark went: GitHub took it, couldn't be reached or is busy, or answered no. */
export type Sent = "done" | "later" | "refused";

export const send = async (api: Pick<GitHubApi, "requestForPage">, mark: Mark): Promise<Sent> => {
  const field = mark.viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
  const body = JSON.stringify({
    query: `mutation($id: ID!, $path: String!) { ${field}(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`,
    variables: { id: mark.pull, path: mark.path },
  });
  let reply: { status: number; body: string };
  try {
    // As a page's write, so what the pages read next isn't from before it.
    reply = await api.requestForPage("POST", "/graphql", body, null);
  } catch {
    // Offline, or signed out for now.
    return "later";
  }
  const { status } = reply;
  if (status === 200) {
    let answer: unknown = null;
    try {
      answer = JSON.parse(reply.body);
    } catch {
      // Not JSON: not taken.
    }
    const data = isRecord(answer) && isRecord(answer.data) ? answer.data[field] : null;
    // A refusal still comes back as 200, with the field empty.
    return isRecord(data) ? "done" : "refused";
  }
  // Signed out for now, rate limited or GitHub having trouble.
  return status === 401 || status === 403 || status === 429 || status >= 500 ? "later" : "refused";
};

export type Outbox = Awaited<ReturnType<typeof startOutbox>>;

/** Reads what was left from last time and starts sending it. */
export const startOutbox = async (api: Pick<GitHubApi, "requestForPage">) => {
  const stored = await outboxItem.getValue();
  let marks: Mark[] = Array.isArray(stored) ? structuredClone(stored) : [];
  const save = () => outboxItem.setValue(structuredClone(marks));

  const sender = createSender(async (): Promise<Outcome> => {
    const next = marks[0];
    if (!next) return "idle";
    const sent = await send(api, next);
    // Only if it's still the latest mark for that file: a newer one made meanwhile stays.
    const still = marks.findIndex((m) => m.pull === next.pull && m.path === next.path && m.viewed === next.viewed);
    if (still !== -1 && sent === "done") marks.splice(still, 1);
    if (still !== -1 && sent === "refused") {
      const [mark] = marks.splice(still, 1);
      mark!.refused += 1;
      // To the back, so one GitHub won't take doesn't hold up the rest.
      if (mark!.refused < MOST_REFUSALS) marks.push(mark!);
    }
    await save();
    // A refusal waits like a failure, so it isn't asked again at once.
    return sent === "done" ? "sent" : "failed";
  });

  if (marks.length > 0) sender.wake();

  return {
    /** Queues a mark, replacing any earlier one for the same file, and sends it now. */
    add: async (pull: string, path: string, viewed: boolean) => {
      marks = marks.filter((m) => !(m.pull === pull && m.path === path));
      marks.push({ pull, path, viewed, refused: 0 });
      await save();
      sender.wake();
    },
    /** The marks still on their way for a pull request, by path: what GitHub says of these files is older than what's
     *  been marked here. */
    pending: (pull: string): Record<string, boolean> =>
      Object.fromEntries(marks.filter((m) => m.pull === pull).map((m) => [m.path, m.viewed])),
  };
};
