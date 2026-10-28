import {
  InboxError,
  type Activity,
  type Detail,
  type PullList,
  type PullRequest,
} from "@/utils/github-inbox/github-inbox";
import {
  activityKind,
  freshActivity,
  isWatching,
  mayNotify,
  needsDetail,
  QUEUE_KINDS,
  rememberThreads,
  reviewListEvents,
  wants,
  type EventKind,
  type InboxEvent,
  type InboxMemory,
  type InboxSnapshot,
  type NotifySettings,
} from "@/utils/inbox/inbox";

export interface InboxSource {
  pulls: (list: PullList) => Promise<PullRequest[]>;
  notifications: () => Promise<{ me: string; activity: Activity[] }>;
  detail: (repo: string, number: number, anchor: string, me: string) => Promise<Detail>;
}

const DETAIL_LIMIT = 8;
const DETAIL_CONCURRENCY = 3;

export const pool = (size: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= size)
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    else active += 1;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
};

export interface CheckResult {
  snapshot: InboxSnapshot;
  memory: InboxMemory | null;
  events: InboxEvent[];
}

const possibleKinds = (activity: Activity): EventKind[] =>
  activity.kind === "review" && activity.reason === "author"
    ? ["approved", "changes-requested", "comment-mine"]
    : [activityKind(activity, null)].filter((kind): kind is EventKind => Boolean(kind));

const markTeams = (reviews: PullRequest[], direct: PullRequest[]): PullRequest[] => {
  const named = new Set(direct.map((pull) => pull.url));
  return reviews.map((pull) => ({ ...pull, team: !named.has(pull.url) }));
};

export const checkInbox = async (
  source: InboxSource,
  settings: NotifySettings,
  memory: InboxMemory | null,
  {
    skipTeams = false,
    updates = false,
    merged = false,
  }: { skipTeams?: boolean; updates?: boolean; merged?: boolean } = {},
): Promise<CheckResult> => {
  const checkedAt = Date.now();
  const extra = (list: "updates" | "merged", wanted: boolean) =>
    wanted
      ? source.pulls(list).then(
          (pulls) => ({ [list]: pulls }),
          () => ({}),
        )
      : Promise.resolve({});
  try {
    const watching = isWatching(settings);
    const [listed, mine, inbox, added] = await Promise.all([
      source.pulls("reviews"),
      source.pulls("authored"),
      watching ? source.notifications() : null,
      Promise.all([extra("updates", updates), extra("merged", merged)]),
    ]);
    const requests = watching && inbox ? reviewListEvents(memory?.reviews ?? null, listed) : [];
    const reviews =
      skipTeams || requests.length > 0
        ? await source.pulls("direct").then(
            (direct) => markTeams(listed, direct),
            () => listed,
          )
        : listed;
    const me = inbox?.me ?? "";
    const snapshot: InboxSnapshot = { me, reviews, mine, ...added[0], ...added[1], checkedAt, problem: null };
    if (!watching || !inbox) return { snapshot, memory: null, events: [] };

    let budget = DETAIL_LIMIT;
    const queue = pool(DETAIL_CONCURRENCY);
    const detail = (repo: string, number: number, anchor: string) => {
      if (budget <= 0) return Promise.resolve(null);
      budget -= 1;
      return queue(() => source.detail(repo, number, anchor, me).catch(() => null));
    };

    const byUrl = new Map(reviews.map((pull) => [pull.url, pull]));
    const fromList = requests
      .map((event) => ({ ...event, team: byUrl.get(event.url)?.team ?? false }))
      .filter((event) => mayNotify(settings, event.kind, event.repo))
      .map(async (event) => {
        if (needsDetail(settings, event.kind, event.repo)) {
          const found = await detail(event.repo, event.number, "");
          event.approvedByMe = found?.myReview === "approved";
        }
        return wants(settings, event) ? event : null;
      });

    const drafts = new Map([...reviews, ...mine].map((pull) => [pull.url, pull.draft]));
    const fromActivity = freshActivity(memory?.threads ?? null, inbox.activity)
      .filter((activity) => possibleKinds(activity).some((kind) => mayNotify(settings, kind, activity.repo)))
      .map(async (activity): Promise<InboxEvent | null> => {
        const found = await detail(activity.repo, activity.number, activity.anchor);
        const kind = activityKind(activity, found?.review ?? null);
        if (!kind || !found || found.actor.toLowerCase() === me.toLowerCase()) return null;
        const event: InboxEvent = {
          kind,
          repo: activity.repo,
          number: activity.number,
          title: activity.title,
          url: activity.url,
          actor: found.actor,
          bot: found.bot,
          draft: drafts.get(`https://github.com/${activity.repo}/pull/${activity.number}`) ?? false,
          approvedByMe: found.myReview === "approved",
          team: byUrl.get(`https://github.com/${activity.repo}/pull/${activity.number}`)?.team ?? false,
          again: false,
          excerpt: found.excerpt,
        };
        return wants(settings, event) ? event : null;
      });

    const events = (await Promise.all([...fromList, ...fromActivity])).filter(
      (event): event is InboxEvent => event !== null && !(skipTeams && event.team && QUEUE_KINDS.includes(event.kind)),
    );
    return { snapshot, memory: { threads: rememberThreads(inbox.activity, memory?.threads ?? null), reviews }, events };
  } catch (error) {
    const problem = error instanceof InboxError ? error.problem : "unreadable";
    return { snapshot: { me: "", reviews: [], mine: [], checkedAt, problem }, memory: null, events: [] };
  }
};
