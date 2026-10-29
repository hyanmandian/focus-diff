import { type Args, fail, isRecord, json, maybeStr, str, texts, wait } from "@/utils/mock-ipc/mock-ipc";

type Actor = { __typename: string; login: string; name: string; avatarUrl: string; databaseId?: number };
type Reply = { status: number; body: string };

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
let ids = 9000;
const nextId = (prefix: string) => `${prefix}_${++ids}`;

const REACTIONS = ["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"];
const groups = (given: Record<string, string[]> = {}) =>
  REACTIONS.map((content) => ({
    content,
    viewerHasReacted: (given[content] ?? []).includes("you"),
    reactors: { totalCount: (given[content] ?? []).length, nodes: (given[content] ?? []).map((login) => ({ login })) },
  }));

type Groups = ReturnType<typeof groups>;
const isGroups = (value: unknown): value is Groups => Array.isArray(value);

const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const EMOJI: Record<string, string> = { tada: "🎉", rocket: "🚀", taco: "🌮", eyes: "👀", "+1": "👍", heart: "❤️" };

function markdown(text: string) {
  const out: string[] = [];
  const parts = text.replaceAll("\r\n", "\n").split(/^(`{3,}[^\n]*\n[\s\S]*?\n?`{3,})$/mu);
  for (const part of parts) {
    const fence = part.match(/^`{3,}(\w*)\n([\s\S]*?)\n?`{3,}$/u);
    if (fence) {
      out.push(
        fence[1] === "suggestion"
          ? `<pre lang="suggestion"><code>${escape(fence[2]!)}\n</code></pre>`
          : `<pre><code>${escape(fence[2]!)}</code></pre>`,
      );
      continue;
    }
    for (const block of part.split(/\n{2,}/u).filter((b) => b.trim())) {
      const inline = escape(block)
        .replaceAll(/`([^`]+)`/gu, "<code>$1</code>")
        .replaceAll(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
        .replaceAll(/(^|\s)@([\w-]+)/gu, '$1<a href="https://github.com/$2">@$2</a>')
        .replaceAll(/:([a-z0-9_+-]+):/gu, (code, name: string) => EMOJI[name] ?? code)
        .replaceAll("\n", "<br>");
      out.push(
        block.startsWith("&gt; ") || block.startsWith("> ")
          ? `<blockquote><p>${inline.replaceAll(/^&gt; ?/gmu, "").replaceAll(/<br>&gt; ?/gu, "<br>")}</p></blockquote>`
          : `<p>${inline}</p>`,
      );
    }
  }
  return out.join("\n");
}

const blob = (removed: string[], added: string[]) =>
  `<div class="my-2 border rounded-2 js-suggested-changes-blob diff-view" id=""><div class="f6 p-2 lh-condensed border-bottom d-flex"><div class="flex-auto flex-items-center color-fg-muted">Suggested change</div></div><div itemprop="text" class="blob-wrapper data file"><table class="d-table tab-size mb-0 width-full"><tbody>${removed
    .map(
      (l) =>
        `<tr class="border-0"><td class="blob-num blob-num-deletion" data-line-number="·"></td><td class="border-0 px-2 py-1 blob-code-inner blob-code-deletion">${l}</td></tr>`,
    )
    .join(
      "",
    )}${added.map((l) => `<tr class="border-0"><td class="blob-num blob-num-addition" data-line-number="·"></td><td class="border-0 px-2 py-1 blob-code-inner blob-code-addition">${l}</td></tr>`).join("")}</tbody></table></div><div class="js-apply-changes"></div></div>`;

type Comment = {
  id: string;
  databaseId: number;
  author: Actor;
  body: string;
  bodyHTML: string;
  createdAt: string;
  url: string;
  state: "SUBMITTED" | "PENDING";
  lastEditedAt: string | null;
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
  viewerCanReact: boolean;
  replyTo: { id: string } | null;
  reactionGroups: ReturnType<typeof groups>;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  originalStartLine: number | null;
  subjectType: "LINE" | "FILE";
};
type MockThread = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  subjectType: "LINE" | "FILE";
  diffSide: "LEFT" | "RIGHT";
  comments: Comment[];
};
type Item = Record<string, unknown> & { __typename: string; id: string };

type Seed = {
  people: Record<string, Actor>;
  threads: Array<{
    id: string;
    path: string;
    line: number | null;
    comments: { nodes: Array<{ id: string; author: Actor; bodyHTML: string; createdAt: string }> };
  }>;
  details: { pullRequest: { timelineItems: { nodes: Item[] }; bodyHTML: string } };
  files: Array<{ filename: string; patch?: string }>;
};

let state: {
  people: Record<string, Actor>;
  threads: MockThread[];
  pending: { id: string; comments: string[] } | null;
  timeline: Item[];
  pull: { body: string; bodyHTML: string; reactionGroups: ReturnType<typeof groups> };
  files: Seed["files"];
} | null = null;

function comment(author: Actor, body: string, minutesAgo: number, at: Partial<Comment> = {}): Comment {
  const id = nextId("PRRC");
  return {
    id,
    databaseId: ids,
    author,
    body,
    bodyHTML: markdown(body),
    createdAt: iso(minutesAgo),
    url: `https://github.com/acme/web/pull/1807#discussion_r${ids}`,
    state: "SUBMITTED",
    lastEditedAt: null,
    viewerCanUpdate: author.login === "you",
    viewerCanDelete: author.login === "you",
    viewerCanReact: true,
    replyTo: null,
    reactionGroups: groups(),
    path: "",
    line: null,
    originalLine: null,
    startLine: null,
    originalStartLine: null,
    subjectType: "LINE",
    ...at,
  };
}

function thread(path: string, line: number | null, comments: Comment[], at: Partial<MockThread> = {}): MockThread {
  const t: MockThread = {
    id: nextId("PRRT"),
    isResolved: false,
    isOutdated: false,
    path,
    line,
    originalLine: line,
    startLine: null,
    subjectType: line ? "LINE" : "FILE",
    diffSide: "RIGHT",
    comments: [],
    ...at,
  };
  t.comments = comments.map((c, i) => ({
    ...c,
    path,
    line,
    originalLine: line,
    startLine: t.startLine,
    subjectType: t.subjectType,
    replyTo: i ? { id: comments[0]!.id } : null,
  }));
  return t;
}

function seed({ people, threads, details, files }: Seed) {
  const { me, ana, bruno, carla, dev } = people as Record<"me" | "ana" | "bruno" | "carla" | "dev", Actor>;
  for (const [i, p] of Object.values(people).entries()) p.databaseId = 100 + i;
  const first = threads[0]!;
  const opener = first.comments.nodes[0]!;
  const t1 = thread(first.path, first.line, [
    {
      ...comment(opener.author, "Should `promoError` be cleared when the code is removed by hand?", 9, {
        reactionGroups: groups({ THUMBS_UP: ["ana-lima", "you"], EYES: ["carla-dias"] }),
      }),
      id: opener.id,
    },
  ]);
  t1.id = first.id;
  const suggestion = comment(
    ana,
    "Shorter, and the error goes when the code does:\n```suggestion\n    next.promo = check.ok ? cart.promo : null;\n    next.promoError = check.ok ? undefined : check.reason;\n```",
    7,
  );
  suggestion.bodyHTML = `${blob(["    next.promo = check.ok ? cart.promo : null;", "    next.promoError = check.ok ? null : check.reason;"], ["    next.promo = check.ok ? cart.promo : null;", "    next.promoError = check.ok ? undefined : check.reason;"])}\n<p>Shorter, and the error goes when the code does:</p>`;
  const t2 = thread("src/checkout/cart.ts", 15, [suggestion], { startLine: 14 });
  const long = thread(
    "api/promo.go",
    22,
    Array.from({ length: 12 }, (_, i) =>
      comment(
        [bruno, carla, dev, me][i % 4]!,
        i
          ? `${["Agreed.", "What about codes that expire mid-checkout?", "We re-check on submit.", "Then this is fine for now.", "Can we log the reason?", "Added a metric instead."][i % 6]} (${i + 1})`
          : "Should an expired code say *expired*, or just stop applying?",
        60 - i * 4,
      ),
    ),
  );
  const onFile = thread("docs/promo-codes.md", null, [
    comment(carla, "Could this page link to the support macro too?", 30),
  ]);
  const webDraft = comment(me, "Nit: this could use `errors.Is` once the sentinel exists.", 5, {
    state: "PENDING",
    viewerCanUpdate: true,
  });
  const pendingThread = thread("api/promo.go", 21, [webDraft]);
  const mine = comment(me, "Tried it locally: the code survives removing an item now. 🎉", 20);
  const older = Array.from({ length: 40 }, (_, i) => ({
    __typename: "IssueComment",
    id: nextId("IC"),
    author: [bruno, carla, dev, ana][i % 4],
    ...said(
      `Earlier note ${i + 1}: ${["CI is green again.", "Rebased on main.", "Pinged design for the copy.", "Looks like the flaky test is unrelated."][i % 4]}`,
      60 * 24 * 3 + (40 - i) * 30,
    ),
  }));
  const pr = details.pullRequest;
  const timeline: Item[] = [
    ...older,
    ...pr.timelineItems.nodes.map((n) => ({
      ...n,
      ...said(
        new DOMParser().parseFromString(typeof n.bodyHTML === "string" ? n.bodyHTML : "", "text/html").body.textContent,
        15,
      ),
      ...(n.__typename === "IssueComment"
        ? { reactionGroups: groups({ HEART: ["ana-lima", "bruno-costa", "you"], ROCKET: ["carla-dias"] }) }
        : {}),
    })),
    {
      __typename: "IssueComment",
      id: nextId("IC"),
      author: me,
      ...said(mine.body, 4),
      viewerCanUpdate: true,
      viewerCanDelete: true,
    },
  ];
  state = {
    people,
    threads: [t1, t2, long, onFile, pendingThread],
    pending: { id: nextId("PRR"), comments: [webDraft.id] },
    timeline,
    pull: {
      body: "Changing the cart used to drop the promo code, so people had to type it again. Now the code stays and is checked against the new total.\n\n- Re-validates the code when items change\n- Shows why a code stopped applying\n\nCloses #1790.",
      bodyHTML: pr.bodyHTML,
      reactionGroups: groups({ HOORAY: ["bruno-costa", "carla-dias"] }),
    },
    files,
  };
}

function said(body: string, minutesAgo: number) {
  return {
    body,
    bodyHTML: markdown(body),
    createdAt: iso(minutesAgo),
    url: `https://github.com/acme/web/pull/1807#issuecomment-${++ids}`,
    lastEditedAt: null,
    viewerCanUpdate: false,
    viewerCanDelete: false,
    viewerCanReact: true,
    reactionGroups: groups(),
  };
}

function fileAt(path: string) {
  const patch = state!.files.find((f) => f.filename === path)?.patch ?? "";
  const lines = new Map<number, string>();
  let n = 0;
  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/u);
    if (hunk) n = Number(hunk[1]);
    else if (line[0] === " " || line[0] === "+") lines.set(n++, line.slice(1));
  }
  const last = Math.max(30, ...lines.keys());
  return `${Array.from({ length: last }, (_, i) => lines.get(i + 1) ?? `// line ${i + 1}`).join("\n")}\n`;
}

const ok = (data: unknown): Reply => ({ status: 200, body: JSON.stringify({ data }) });
const allComments = () => state!.threads.flatMap((t) => t.comments);

export function conversationMock(cmd: string, args: Args, seedWith: () => Seed): unknown {
  state ??= (seed(seedWith()), state);
  const s = state!;
  if (cmd.startsWith("drafts_")) return drafts(cmd, args);
  if (cmd !== "github") return undefined;
  const path = str(args, "path");
  if (path === "/markdown") {
    const text = str(json(args, "body"), "text");
    return wait(250).then(() => ({ status: 200, body: markdown(text) }));
  }
  if (path.includes("/contents/"))
    return { status: 200, body: fileAt(decodeURIComponent(path.split("/contents/")[1]!.split("?")[0]!)) };
  if (path !== "/graphql") return undefined;
  const body = json(args, "body");
  const query = str(body, "query");
  const variables = isRecord(body.variables) ? body.variables : {};
  const v = texts(variables);

  if (query.includes("reviewThreads(first: 100"))
    return ok({
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: s.threads.map((t) => ({
              ...t,
              comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: t.comments },
            })),
          },
        },
      },
    });
  if (query.includes("reviews(states: PENDING")) {
    const comments = allComments().filter((c) => s.pending?.comments.includes(c.id));
    return ok({
      repository: {
        pullRequest: {
          reviews: {
            nodes: s.pending
              ? [
                  {
                    id: s.pending.id,
                    viewerDidAuthor: true,
                    comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: comments },
                  },
                ]
              : [],
          },
        },
      },
    });
  }
  if (query.includes("timelineItems(first: 100")) {
    const nodes = s.timeline.map((n) =>
      n.__typename === "PullRequestReview"
        ? { ...n, comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }
        : n,
    );
    return ok({
      repository: {
        pullRequest: {
          ...(variables.first
            ? {
                body: s.pull.body,
                bodyHTML: s.pull.bodyHTML,
                viewerCanUpdate: true,
                viewerCanReact: true,
                viewerCanApplySuggestion: true,
                headRefName: "ana/keep-promo-code",
                headRefOid: "abc123",
                headRepository: { nameWithOwner: "acme/web" },
                reactionGroups: s.pull.reactionGroups,
              }
            : {}),
          timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
        },
      },
    });
  }
  if (query.includes("mentionableUsers"))
    return ok({
      repository: {
        mentionableUsers: {
          nodes: [
            ...Object.values(s.people),
            { login: "dana", name: "Dana Reyes", avatarUrl: "https://avatars.githubusercontent.com/dana?s=40" },
          ].filter((p) => p.login !== "you"),
        },
      },
    });
  if (query.includes("search(query:"))
    return ok({
      search: {
        nodes: [
          { __typename: "Issue", number: 1790, title: "Promo code disappears when the cart changes", state: "OPEN" },
          {
            __typename: "PullRequest",
            number: 1784,
            title: "Checkout: show the promo field on mobile",
            state: "MERGED",
          },
          { __typename: "Issue", number: 1702, title: "Expired codes say “invalid”", state: "CLOSED" },
        ].filter((n) => !v.q?.match(/\d{3,}/u) || String(n.number).startsWith(v.q.match(/\d+/u)![0])),
      },
    });
  if (query.includes("savedReplies"))
    return ok({
      viewer: {
        savedReplies: {
          nodes: [
            { id: "SR_1", title: "Thanks!", body: "Thanks for the quick fix! 🙏" },
            { id: "SR_2", title: "Needs a test", body: "Could you add a test that covers this case?" },
            { id: "SR_3", title: "Nit", body: "Nit, not blocking: " },
          ],
        },
      },
    });

  const reaction = query.match(/(addReaction|removeReaction)/u)?.[1];
  if (reaction) {
    const target =
      allComments().find((c) => c.id === v.id) ??
      s.timeline.find((n) => n.id === v.id) ??
      (v.id === "PR_1807" ? s.pull : null);
    const current = target?.reactionGroups;
    if (target && isGroups(current)) {
      target.reactionGroups = current.map((g) => {
        if (g.content !== v.content) return g;
        const on = reaction === "addReaction";
        const nodes = on
          ? [{ login: "you" }, ...g.reactors.nodes.filter((n) => n.login !== "you")]
          : g.reactors.nodes.filter((n) => n.login !== "you");
        return { ...g, viewerHasReacted: on, reactors: { totalCount: nodes.length, nodes } };
      });
    }
    return ok({ [reaction]: { clientMutationId: null } });
  }
  const edit = query.match(
    /(updatePullRequestReviewComment|updateIssueComment|updatePullRequestReview|updatePullRequest)\(/u,
  )?.[1];
  if (edit) {
    const bodyHTML = markdown(v.body ?? "");
    const target =
      edit === "updatePullRequest"
        ? s.pull
        : (allComments().find((c) => c.id === v.id) ?? s.timeline.find((n) => n.id === v.id));
    if (target) Object.assign(target, { body: v.body, bodyHTML, lastEditedAt: iso(0) });
    const field = {
      updatePullRequestReviewComment: "pullRequestReviewComment",
      updateIssueComment: "issueComment",
      updatePullRequestReview: "pullRequestReview",
      updatePullRequest: "pullRequest",
    }[edit]!;
    return ok({ [edit]: { [field]: { bodyHTML } } });
  }
  if (query.includes("deleteIssueComment")) {
    s.timeline = s.timeline.filter((n) => n.id !== v.id);
    return ok({ deleteIssueComment: { clientMutationId: null } });
  }
  if (query.includes("deletePullRequestReviewComment")) {
    removeComment(v.id!);
    return ok({ deletePullRequestReviewComment: { clientMutationId: null } });
  }
  if (query.includes("resolveReviewThread") || query.includes("unresolveReviewThread")) {
    const t = s.threads.find((x) => x.id === v.id);
    if (t) t.isResolved = !query.includes("unresolve");
    return ok({ resolveReviewThread: { thread: { id: v.id } } });
  }
  if (
    query.includes("submitPullRequestReview") ||
    query.includes("addPullRequestReview(input: { pullRequestId: $id, event")
  ) {
    for (const c of allComments()) if (s.pending?.comments.includes(c.id)) c.state = "SUBMITTED";
    s.pending = null;
    s.timeline.push({
      __typename: "PullRequestReview",
      id: nextId("PRR"),
      author: s.people.me!,
      state: v.event === "APPROVE" ? "APPROVED" : v.event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED",
      ...said(v.body ?? "", 0),
    });
    return ok({ submitPullRequestReview: { clientMutationId: null } });
  }
  if (query.includes("deletePullRequestReview(")) {
    for (const id of s.pending?.comments ?? []) removeComment(id);
    s.pending = null;
    return ok({ deletePullRequestReview: { clientMutationId: null } });
  }
  if (query.includes("createCommitOnBranch"))
    return wait(600).then(() => ok({ createCommitOnBranch: { commit: { oid: "def456" } } }));
  return undefined;
}

function removeComment(id: string) {
  const s = state!;
  s.threads = s.threads
    .map((t) => ({ ...t, comments: t.comments.filter((c) => c.id !== id) }))
    .filter((t) => t.comments.length);
  if (s.pending) s.pending.comments = s.pending.comments.filter((c) => c !== id);
}

type Put = {
  key: string;
  pull: string;
  path: string;
  line: number;
  side: string;
  startLine?: number | null;
  file?: boolean;
  body: string;
  id?: string | null;
  replyTo?: string | null;
};
type Job = {
  change: ({ op: "put" } & Put) | { op: "remove"; key: string; pull: string; id?: string | null };
  error: string | null;
};
const queue: { jobs: Job[]; ids: Record<string, string> } = { jobs: [], ids: {} };
let emit: (event: string, payload: unknown) => void = () => {};
export const setEmitter = (f: typeof emit) => void (emit = f);

const isPut = (value: unknown): value is Put =>
  isRecord(value) && typeof value.key === "string" && typeof value.pull === "string" && typeof value.body === "string";

function drafts(cmd: string, args: Args): unknown {
  switch (cmd) {
    case "drafts_put": {
      const put = args.put;
      if (!isPut(put)) return null;
      queue.jobs = queue.jobs.filter((j) => !(j.change.op === "put" && j.change.key === put.key));
      queue.jobs.push({ change: { op: "put", ...put }, error: null });
      later();
      return null;
    }
    case "drafts_remove":
      queue.jobs = queue.jobs.filter((j) => j.change.key !== args.key);
      queue.jobs.push({
        change: { op: "remove", key: str(args, "key"), pull: str(args, "pull"), id: maybeStr(args, "id") },
        error: null,
      });
      later();
      return null;
    case "drafts_state":
      return structuredClone(queue);
    case "drafts_retry":
      for (const j of queue.jobs) j.error = null;
      later();
      return null;
    case "drafts_forget":
      queue.jobs = [];
      queue.ids = {};
      return null;
    case "drafts_flush":
      return flushed();
  }
  return undefined;
}

async function flushed(): Promise<null> {
  const refused = queue.jobs.find((j) => j.error);
  if (refused) return fail(refused.error);
  if (queue.jobs.length === 0) return null;
  await wait(100);
  return flushed();
}

function later() {
  setTimeout(() => {
    const job = queue.jobs.find((j) => !j.error);
    if (!job) return;
    const s = state!;
    const change = job.change;
    const id = change.id ?? queue.ids[change.key];
    if (change.op === "remove") {
      if (id) removeComment(id);
      delete queue.ids[change.key];
    } else {
      const existing = id ? allComments().find((c) => c.id === id) : undefined;
      if (existing) Object.assign(existing, { body: change.body, bodyHTML: markdown(change.body) });
      else if (/fail/iu.test(change.body)) {
        job.error = "pull_request_review_thread.line must be part of the diff";
      } else {
        s.pending ??= { id: nextId("PRR"), comments: [] };
        const line = change.file ? null : change.line;
        const made = comment(s.people.me!, change.body, 0, {
          state: "PENDING",
          viewerCanUpdate: true,
          viewerCanDelete: true,
        });
        const answered = change.replyTo ? s.threads.find((t) => t.id === change.replyTo) : undefined;
        if (answered)
          answered.comments.push({
            ...made,
            path: answered.path,
            line: answered.line,
            originalLine: answered.line,
            replyTo: { id: answered.comments[0]!.id },
          });
        else
          s.threads.push(
            thread(change.path, line, [made], {
              diffSide: change.side === "deletions" ? "LEFT" : "RIGHT",
              startLine: change.startLine ?? null,
            }),
          );
        const stored = answered ? made.id : s.threads.at(-1)!.comments[0]!.id;
        s.pending.comments.push(stored);
        queue.ids[change.key] = stored;
      }
    }
    if (!job.error) queue.jobs = queue.jobs.filter((j) => j !== job);
    emit("drafts", change.pull);
    if (queue.jobs.some((j) => !j.error)) later();
  }, 700);
}
