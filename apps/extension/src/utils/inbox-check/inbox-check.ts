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

/** How the background reads GitHub; tests hand in their own. */
export interface InboxSource {
  pulls: (list: PullList) => Promise<PullRequest[]>;
  notifications: () => Promise<{ me: string; activity: Activity[] }>;
  detail: (repo: string, number: number, anchor: string, me: string) => Promise<Detail>;
}

/** Pull request pages read on one look at most, so a burst of activity doesn't turn into a burst of requests. */
const DETAIL_LIMIT = 8;
/** Pull request pages read at once: each is a megabyte or so, and one after another, eight would take a quarter minute. */
const DETAIL_CONCURRENCY = 3;

/** Runs the tasks handed to it at most `size` at a time, each in the order it was handed in. */
export const pool = (size: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= size) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
};

export interface CheckResult {
  snapshot: InboxSnapshot;
  /** `null` when nothing was read, so the next look still compares against the last good one. */
  memory: InboxMemory | null;
  /** What the reader asked to be told about. */
  events: InboxEvent[];
}

/** The kinds a thread's latest event could turn out to be, before its page says what the review was. */
const possibleKinds = (activity: Activity): EventKind[] =>
  activity.kind === "review" && activity.reason === "author"
    ? ["approved", "changes-requested", "comment-mine"]
    : [activityKind(activity, null)].filter((kind): kind is EventKind => Boolean(kind));

/**
 * Tells the reviews asked of the reader's teams from the ones asked of them by name, by the list of the latter. A pull
 * request the reader was asked to review both ways is theirs.
 */
const markTeams = (reviews: PullRequest[], direct: PullRequest[]): PullRequest[] => {
  const named = new Set(direct.map((pull) => pull.url));
  return reviews.map((pull) => ({ ...pull, team: !named.has(pull.url) }));
};

/**
 * One look at GitHub: the reader's two lists, and with notifications on, what's new since the last look that they
 * asked to be told about. Reading the lists is all the popup needs, so without notifications nothing else is read.
 * When the reader's queue leaves out the reviews asked of their teams (`skipTeams`), or when a new review request is to be
 * told about, one more list tells those from the ones asked of the reader by name. Left out of the queue, a team's are
 * left out of what the reader is told about it too.
 */
export const checkInbox = async (
  source: InboxSource,
  settings: NotifySettings,
  memory: InboxMemory | null,
  { skipTeams = false }: { skipTeams?: boolean } = {},
): Promise<CheckResult> => {
  const checkedAt = Date.now();
  try {
    const watching = isWatching(settings);
    const [listed, mine, inbox] = await Promise.all([
      source.pulls("reviews"),
      source.pulls("authored"),
      watching ? source.notifications() : null,
    ]);
    const requests = watching && inbox ? reviewListEvents(memory?.reviews ?? null, listed) : [];
    // Without the list of the ones asked of the reader by name, none is known to be a team's.
    const reviews =
      skipTeams || requests.length
        ? await source.pulls("direct").then(
            (direct) => markTeams(listed, direct),
            () => listed,
          )
        : listed;
    const me = inbox?.me ?? "";
    const snapshot: InboxSnapshot = { me, reviews, mine, checkedAt, problem: null };
    if (!watching || !inbox) return { snapshot, memory: null, events: [] };

    let budget = DETAIL_LIMIT;
    const queue = pool(DETAIL_CONCURRENCY);
    // The budget is spent as pages are asked for, in order, so the first eight events are the ones looked into.
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
        // The reader's own comments and reviews aren't news to them.
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
