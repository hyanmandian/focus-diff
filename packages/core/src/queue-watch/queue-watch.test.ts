import { describe, expect, it } from "vitest";

import { parsePullRequest } from "../github-pulls/github-pulls";
import { parseConfig, type Config } from "../queue-config/queue-config";
import { CACHE_VERSION, emptyCache, Failure, type Cache, type Gql } from "../queue-engine/queue-engine";
import type { EngineItem, Snapshot } from "../queue-panel/queue-panel";
import { ENGLISH, PORTUGUESE } from "../queue-words/queue-words";
import {
  EVENTS_VERSION,
  FIRST_BACKOFF,
  FULL_EVERY,
  LONGEST_BACKOFF,
  MAX_HELD,
  MOST_UNDONE,
  notificationWords,
  QueueWatch,
  readPersisted,
  searchKey,
  summary,
  type Held,
  type Note,
  type Persisted,
} from "./queue-watch";

const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z
const iso = (ms: number): string => new Date(ms).toISOString().replace(".000", "");

// MARK: The words (watch.rs's tests, ported)

const wordsItem = (viaTeams: string[] | null): EngineItem => ({
  queueId: "q",
  pr: parsePullRequest({
    id: "PR_1",
    number: 7,
    title: "Fix login",
    repository: { nameWithOwner: "acme/web" },
    author: { login: "ana", name: "Ana Lima" },
  })!,
  events: [],
  status: null,
  viaTeams,
  ci: null,
  passed: false,
  waitingSince: null,
});

const said = (
  item: EngineItem,
  kind: string,
  text: string | null,
  queueKind: "review" | "authored" | "custom" | "involved" | null,
  words = ENGLISH,
): [string, string] => {
  const who = { login: "bruno", name: "Bruno Costa" };
  const { title, body } = notificationWords(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- any kind, as Rust's words take any.
    { item, event: { key: "k", kind: kind as "new", at: 0, who, text } },
    queueKind,
    words,
  );
  return [title, body];
};

describe("notification words", () => {
  const mine = wordsItem([]);
  const team = wordsItem(["acme/web-platform"]);

  it("say what happened", () => {
    expect(said(mine, "new", null, "review")).toStrictEqual(["Bruno asked for your review", "Fix login\nacme/web#7"]);
    expect(said(team, "new", null, "review")).toStrictEqual([
      "Bruno asked your team for a review",
      "Fix login\nacme/web#7 · for web-platform",
    ]);
    expect(said(mine, "rerequest", null, "review")[0]).toBe("Bruno asked you to review again");
    expect(said(mine, "ready", null, "review")[0]).toBe("Bruno's pull request is ready for your review");
    expect(said(wordsItem(null), "comment", "Can you look?", "authored")).toStrictEqual([
      "Bruno commented on your pull request",
      "“Can you look?”\nacme/web#7 · Fix login",
    ]);
    expect(said(wordsItem(null), "new", null, "custom")[1]).toBe("Fix login\nacme/web#7 · by Ana");
  });

  it("say it in Portuguese", () => {
    expect(said(mine, "new", null, "review", PORTUGUESE)[0]).toBe("Bruno pediu sua revisão");
    expect(said(team, "new", null, "review", PORTUGUESE)).toStrictEqual([
      "Bruno pediu revisão ao seu time",
      "Fix login\nacme/web#7 · para web-platform",
    ]);
    expect(said(mine, "rerequest", null, "review", PORTUGUESE)[0]).toBe("Bruno pediu para você revisar de novo");
    expect(said(mine, "ready", null, "review", PORTUGUESE)[0]).toBe(
      "O pull request de Bruno está pronto para sua revisão",
    );
    expect(said(wordsItem(null), "comment", null, "authored", PORTUGUESE)[0]).toBe(
      "Bruno comentou no seu pull request",
    );
    expect(said(wordsItem(null), "new", null, "custom", PORTUGUESE)[1]).toBe("Fix login\nacme/web#7 · de Ana");
  });

  it("name someone by their first name, their login, or no one", () => {
    const named = (who: { login: string; name?: string } | null) =>
      notificationWords({ item: mine, event: { key: "k", kind: "mention", at: 0, who, text: null } }, null, ENGLISH)
        .title;
    expect(named({ login: "bruno", name: "  " })).toBe("bruno mentioned you");
    expect(named({ login: "" })).toBe("Someone mentioned you");
    expect(named(null)).toBe("Someone mentioned you");
    expect(said(wordsItem(["solo"]), "comment", null, "review")).toStrictEqual([
      "Bruno commented on a pull request you review",
      "Fix login\nacme/web#7 · for solo",
    ]);
    expect(said(mine, "anything", null, null)[0]).toBe("Something happened");
    expect(said(mine, "toString", null, null)[0]).toBe("Something happened");
  });

  it("sum several kept as one", () => {
    const note = (title: string): Held => ({ key: title, title, body: "Fix login\nacme/web#7", until: "review" });
    const notes = ["A", "B", "C", "D", "E", "F", "G"].map((title) => note(title));
    const { title, body } = summary(notes, "waitedForReview", ENGLISH);
    expect(title).toBe("7 updates waited for review time");
    expect(body.split("\n")[0]).toBe("A: Fix login");
    expect(body.endsWith("and 2 more")).toBe(true);
    const pt = summary(notes, "waitedForReview", PORTUGUESE);
    expect(pt.title).toBe("7 atualizações guardadas para o review time");
    expect(pt.body.endsWith("e mais 2")).toBe(true);
    expect(summary([note("A"), { ...note("B"), body: "" }], "cameIn", ENGLISH).body).toBe("A: Fix login\nB: ");
  });
});

// MARK: The watch

const ME = "me";

/** A pull request as GitHub has it, in full. */
const github = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  number: Number(id.replaceAll(/\D/gu, "")) || 1,
  title: `Title ${id}`,
  url: `https://github.com/acme/web/pull/${id}`,
  state: "OPEN",
  createdAt: iso(T0 - 600 * 60_000),
  updatedAt: iso(T0 - 10 * 60_000),
  headRefOid: "head",
  mergeable: "MERGEABLE",
  repository: { nameWithOwner: "acme/web" },
  author: { __typename: "User", login: "ana", name: "Ana Lima" },
  reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: ME } }] },
  commits: { nodes: [{ commit: { committedDate: iso(T0), statusCheckRollup: { state: "SUCCESS" } } }] },
  ...extra,
});

const REVIEW = { id: "r", name: "Review", kind: "review", notify: ["new", "rerequest", "comment"], drafts: "show" };
const MINE = { id: "a", name: "Mine", kind: "authored", notify: ["ci-passed", "comment"], drafts: "show" };

interface Env {
  watch: QueueWatch;
  notes: Note[];
  snapshots: Snapshot[];
  badges: Array<[number, boolean]>;
  calls: string[];
  /** What GitHub has: pull requests in full, and what each search finds (by a part of its query). */
  prs: Record<string, Record<string, unknown>>;
  found: Record<string, string[]>;
  setNow: (ms: number) => void;
  setLogin: (login: string | null | Error) => void;
  setConfig: (config: unknown) => void;
  fail: (failure: Failure | null) => void;
  saved: () => Persisted;
  savedCache: () => Cache | undefined;
}

const environment = ({
  config = { queues: [REVIEW] },
  state,
  cache,
}: { config?: unknown; state?: unknown; cache?: unknown } = {}): Env => {
  let now = T0;
  let login: string | null | Error = ME;
  let setup: Config | null = parseConfig(config);
  let failure: Failure | null = null;
  let persisted: Persisted | undefined;
  let stored: Cache | undefined;
  const env = {
    notes: [] as Note[],
    snapshots: [] as Snapshot[],
    badges: [] as Array<[number, boolean]>,
    calls: [] as string[],
    prs: {} as Record<string, Record<string, unknown>>,
    found: {} as Record<string, string[]>,
  };
  const light = (id: string) => {
    const pr = env.prs[id]!;
    return { id, updatedAt: pr.updatedAt, headRefOid: pr.headRefOid, mergeable: pr.mergeable, commits: pr.commits };
  };
  const gql: Gql = {
    query: (query, variables) => {
      if (failure) return Promise.reject(failure);
      if (query.includes("organizations")) {
        env.calls.push("orgs");
        return Promise.resolve({ viewer: { organizations: { nodes: [] } } });
      }
      if (query.includes("search(")) {
        const q = String(variables.q);
        env.calls.push(`search ${q}`);
        const ids = Object.entries(env.found).find(([part]) => q.includes(part))?.[1] ?? [];
        return Promise.resolve({ search: { pageInfo: { hasNextPage: false }, nodes: ids.map((id) => light(id)) } });
      }
      const ids = [variables.ids].flat().map(String);
      env.calls.push(`details ${ids.join(",")}`);
      return Promise.resolve({ nodes: ids.map((id) => env.prs[id] ?? null) });
    },
  };
  const watch = new QueueWatch({
    gql,
    login: () => (login instanceof Error ? Promise.reject(login) : Promise.resolve(login)),
    config: () => Promise.resolve(setup),
    now: () => now,
    storage: {
      loadState: () => Promise.resolve(state),
      saveState: (p) => {
        persisted = structuredClone(p);
      },
      loadCache: () => Promise.resolve(cache),
      saveCache: (c) => {
        stored = structuredClone(c);
        return Promise.resolve();
      },
    },
    notify: (note) => {
      env.notes.push(note);
    },
    words: ENGLISH,
    publish: (snapshot) => {
      env.snapshots.push(snapshot);
    },
    badge: (count, animate) => {
      env.badges.push([count, animate]);
    },
  });
  return {
    ...env,
    watch,
    setNow: (ms) => {
      now = ms;
    },
    setLogin: (l) => {
      login = l;
    },
    setConfig: (c) => {
      setup = parseConfig(c);
    },
    fail: (f) => {
      failure = f;
    },
    saved: () => persisted!,
    savedCache: () => stored,
  };
};

/** Booted with one pull request waiting for review, its first look done (quietly). */
const booted = async (config?: unknown): Promise<Env> => {
  const env = environment(config === undefined ? {} : { config });
  env.prs.A = github("A");
  env.found["review-requested"] = ["A"];
  await env.watch.boot();
  return env;
};

const later = (env: Env, minutes: number): void => {
  env.setNow(T0 + minutes * 60_000);
};

/** A second pull request asks for review, and the watch looks again. */
const another = async (env: Env, id = "B") => {
  env.prs[id] = github(id);
  env.found["review-requested"] = [...(env.found["review-requested"] ?? []), id];
  await env.watch.refresh(true);
};

describe("QueueWatch", () => {
  it("starts quietly: the first look is the baseline", async () => {
    const env = await booted();
    const snapshot = env.watch.snapshot();
    expect(snapshot).toMatchObject({
      ready: true,
      signedIn: true,
      me: ME,
      arrivals: [],
      seen: {},
      dismissed: {},
      review: null,
    });
    expect(snapshot.status).toStrictEqual({ phase: "idle", updatedAt: T0 });
    expect(snapshot.items.r?.map((i) => i.pr.id)).toStrictEqual(["A"]);
    expect(env.notes).toStrictEqual([]);
    // Nobody, then you.
    expect(env.badges).toStrictEqual([
      [0, false],
      [1, false],
    ]);
    expect(env.saved().keys).toStrictEqual(["r:A:new"]);
    expect(env.saved().searches.r).toContain("review-requested:me");
    expect(env.saved().eventsVersion).toBe(EVENTS_VERSION);
    expect(env.savedCache()?.prs.A?.pr.title).toBe("Title A");
    expect(env.snapshots.map((s) => s.status.phase)).toContain("loading");
    expect(env.watch.pollMs()).toBe(60_000);
  });

  it("notifies about what's new after that, and calls it out", async () => {
    const env = await booted();
    await another(env);
    expect(env.notes).toStrictEqual([
      { title: "Ana asked for your review", body: "Title B\nacme/web#1", sound: false },
    ]);
    expect(env.watch.snapshot().arrivals).toStrictEqual(["B"]);
    expect(env.badges.at(-1)).toStrictEqual([2, true]);
    await env.watch.refresh(true);
    expect(env.notes).toHaveLength(1);
  });

  it("keeps a queue that's new, or searches differently, quiet on its first look", async () => {
    const env = await booted();
    env.setConfig({ queues: [{ ...REVIEW, drafts: "hide" }] });
    env.prs.B = github("B");
    env.found["review-requested"] = ["A", "B"];
    await env.watch.configChanged();
    expect(env.notes).toStrictEqual([]);
    await another(env, "C");
    expect(env.notes).toHaveLength(1);
  });

  it("starts quietly when it knows new kinds of event", async () => {
    const env = environment({ state: { keys: [], eventsVersion: 0 } });
    env.prs.A = github("A");
    env.found["review-requested"] = ["A"];
    await env.watch.boot();
    expect(env.notes).toStrictEqual([]);
  });

  it("shows a few at most, with one sound", async () => {
    const env = await booted({ queues: [REVIEW], sound: true });
    for (const id of ["B", "C", "D", "E", "F", "G"]) env.prs[id] = github(id);
    env.found["review-requested"] = ["A", "B", "C", "D", "E", "F", "G"];
    await env.watch.refresh(true);
    expect(env.notes.map((n) => n.sound)).toStrictEqual([true, false, false, false, false]);
    expect(env.notes.at(-1)).toStrictEqual({
      title: "2 more pull request updates",
      body: "Open Focus Diff to see them",
      sound: false,
    });
  });

  it("tells when CI passes again on the same commit", async () => {
    const failing = {
      commits: { nodes: [{ commit: { committedDate: iso(T0), statusCheckRollup: { state: "FAILURE" } } }] },
    };
    const env = environment({ config: { queues: [MINE] } });
    env.prs.M1 = github("M1", { author: { login: ME }, ...failing });
    env.found["author:me"] = ["M1"];
    await env.watch.boot();
    env.prs.M1 = github("M1", { author: { login: ME }, updatedAt: iso(T0) });
    await env.watch.refresh(true);
    expect(env.notes).toStrictEqual([{ title: "CI passed", body: "Title M1\nacme/web#1", sound: false }]);
  });

  describe("clicks", () => {
    it("mark a card, or a whole queue, as seen", async () => {
      const env = await booted();
      await another(env);
      await env.watch.markSeen("r", "B");
      expect(env.watch.snapshot()).toMatchObject({ seen: { "r:B:new": true }, arrivals: [] });
      expect(env.badges.at(-1)).toStrictEqual([1, false]);
      await env.watch.markSeen("r", "nope");
      await env.watch.markQueueSeen("r");
      expect(env.watch.snapshot().seen).toStrictEqual({ "r:A:new": true, "r:B:new": true });
      expect(env.badges.at(-1)).toStrictEqual([0, false]);
      expect(env.saved().seen).toStrictEqual({ "r:A:new": true, "r:B:new": true });
    });

    it("take a pull request off a queue until it leaves the search, with Undo", async () => {
      const env = await booted();
      await env.watch.markSeen("r", "A");
      await another(env);
      await env.watch.dismiss("r", "B");
      expect(env.watch.snapshot()).toMatchObject({ dismissed: { "r:B": true }, arrivals: [] });
      expect(env.watch.snapshot().items.r?.map((i) => i.pr.id)).toStrictEqual(["A"]);
      await env.watch.refresh(true);
      expect(env.watch.snapshot().items.r?.map((i) => i.pr.id)).toStrictEqual(["A"]);

      await env.watch.restore("r", "B");
      expect(env.watch.snapshot().dismissed).toStrictEqual({});
      expect(env.watch.snapshot().items.r?.map((i) => i.pr.id)).toStrictEqual(["A", "B"]);
      expect(env.watch.snapshot().seen).toStrictEqual({ "r:A:new": true });
      await env.watch.restore("r", "B");
      expect(env.watch.snapshot().items.r).toHaveLength(2);

      // Seen already stays seen after Undo; out of the search, it's forgotten.
      await env.watch.dismiss("r", "A");
      await env.watch.dismiss("other", "Z");
      expect(env.watch.snapshot().dismissed).toStrictEqual({ "r:A": true, "other:Z": true });
      env.found["review-requested"] = ["B"];
      await env.watch.refresh(true);
      expect(env.watch.snapshot().dismissed).toStrictEqual({ "other:Z": true });
      await env.watch.restore("r", "A");
      expect(env.watch.snapshot().seen).toStrictEqual({});
    });

    it("put back the item as it was, even after a refresh", async () => {
      const env = await booted();
      await env.watch.dismiss("r", "A");
      await env.watch.refresh(true);
      await env.watch.restore("r", "A");
      expect(env.watch.snapshot().items.r?.map((i) => i.pr.id)).toStrictEqual(["A"]);
    });

    it("can be undone for the latest few only", async () => {
      const env = await booted();
      const ids = Array.from({ length: MOST_UNDONE + 1 }, (_, i) => `P${i}`);
      for (const id of ids) env.prs[id] = github(id);
      env.found["review-requested"] = ids;
      await env.watch.refresh(true);
      for (const id of ids) await env.watch.dismiss("r", id); // oxlint-disable-line eslint/no-await-in-loop -- clicks come one after another.
      for (const id of ids) await env.watch.restore("r", id); // oxlint-disable-line eslint/no-await-in-loop -- clicks come one after another.
      expect(env.watch.snapshot().items.r?.map((i) => i.pr.id)).toStrictEqual(ids.slice(1));
    });

    it("mark only that queue as seen", async () => {
      const env = await booted({ queues: [REVIEW, { ...REVIEW, id: "r2" }] });
      await env.watch.markQueueSeen("r2");
      expect(env.watch.snapshot().seen).toStrictEqual({ "r2:A:new": true });
    });

    it("put back nothing where the queue's gone or the pull request's back", async () => {
      const env = await booted();
      await env.watch.dismiss("r", "A");
      env.found["review-requested"] = [];
      await env.watch.refresh(true);
      env.found["review-requested"] = ["A"];
      await env.watch.refresh(true);
      await env.watch.restore("r", "A");
      expect(env.watch.snapshot().items.r?.map((i) => i.pr.id)).toStrictEqual(["A"]);
      await env.watch.dismiss("r", "A");
      env.setConfig({ queues: [] });
      await env.watch.configChanged();
      await env.watch.restore("r", "A");
      expect(env.watch.snapshot().items).toStrictEqual({});
    });

    it("clear what's called out once the panel shows it", async () => {
      const env = await booted();
      await another(env);
      const published = env.snapshots.length;
      env.watch.clearArrival("nope");
      expect(env.snapshots).toHaveLength(published);
      env.watch.clearArrival("B");
      expect(env.snapshots).toHaveLength(published + 1);
      expect(env.watch.snapshot().arrivals).toStrictEqual([]);
    });
  });

  describe("refreshing", () => {
    it("waits for its rhythm unless forced or after an error", async () => {
      const env = await booted();
      const asked = env.calls.length;
      await env.watch.refresh();
      expect(env.calls).toHaveLength(asked);
      later(env, 1);
      await env.watch.refresh();
      expect(env.calls.length).toBeGreaterThan(asked);
    });

    it("makes several refreshes asked for at once one", async () => {
      const env = await booted();
      const asked = env.calls.length;
      await Promise.all([env.watch.refresh(), env.watch.refresh(true), env.watch.refresh()]);
      expect(env.calls.length - asked).toBe(1);
    });

    it("fetches everything again every so often", async () => {
      const env = await booted();
      env.calls.length = 0;
      await env.watch.refresh(true);
      expect(env.calls).toStrictEqual([expect.stringContaining("search")]);
      env.setNow(T0 + FULL_EVERY + 1);
      await env.watch.refresh(true);
      expect(env.calls).toContain("details A");
      expect(env.savedCache()?.fullAt).toBe(T0 + FULL_EVERY + 1);
    });

    it("waits longer each time GitHub asks to slow down", async () => {
      const env = await booted();
      env.fail(new Failure(403, "API rate limit exceeded"));
      await env.watch.refresh(true);
      expect(env.watch.snapshot().status).toStrictEqual({
        phase: "error",
        error: "GitHub asked Focus Diff to slow down: trying again in 5 minutes",
        updatedAt: T0,
      });
      env.fail(null);
      const asked = env.calls.length;
      await env.watch.refresh(true);
      expect(env.calls).toHaveLength(asked);
      env.setNow(T0 + FIRST_BACKOFF);
      env.fail(new Failure(429, ""));
      await env.watch.refresh(true);
      expect(env.watch.snapshot().status.error).toContain("10 minutes");
      for (let i = 0; i < 4; i += 1) {
        env.setNow(T0 + (i + 1) * LONGEST_BACKOFF);
        // oxlint-disable-next-line eslint/no-await-in-loop -- each refresh after the one before, as time passes.
        await env.watch.refresh(true);
      }
      expect(env.watch.snapshot().status.error).toContain("30 minutes");
      env.fail(null);
      env.setNow(T0 + 6 * LONGEST_BACKOFF);
      await env.watch.refresh(true);
      expect(env.watch.snapshot().status.phase).toBe("idle");
      env.fail(new Failure(403, "rate limit"));
      await env.watch.refresh(true);
      expect(env.watch.snapshot().status.error).toContain("5 minutes");
    });

    it("says what GitHub said, and keeps what came in", async () => {
      const env = await booted();
      env.fail(new Failure(502, "Bad gateway"));
      await env.watch.refresh(true);
      expect(env.watch.snapshot().status).toMatchObject({ phase: "error", error: "Bad gateway" });
      expect(env.watch.snapshot().items.r).toHaveLength(1);
      expect(env.savedCache()?.prs.A).toBeDefined();
      env.fail(null);
      await env.watch.refresh();
      expect(env.watch.snapshot().status.phase).toBe("idle");
    });

    it("follows GitHub signing you out", async () => {
      const env = await booted();
      env.fail(new Failure(401, "Bad credentials"));
      env.setLogin(null);
      await env.watch.refresh(true);
      expect(env.watch.snapshot()).toMatchObject({
        signedIn: false,
        me: null,
        items: {},
        status: { phase: "idle", updatedAt: 0 },
      });
      expect(env.badges.at(-1)).toStrictEqual([0, false]);
      const asked = env.calls.length;
      await env.watch.refresh(true);
      expect(env.calls).toHaveLength(asked);
    });

    it("says GitHub signed you out when the token stops working", async () => {
      const env = await booted();
      env.fail(new Failure(401, "Bad credentials"));
      await env.watch.refresh(true);
      expect(env.watch.snapshot()).toMatchObject({
        signedIn: true,
        status: { phase: "error", error: "GitHub signed you out" },
      });
    });

    it("keeps the account it knew while GitHub can't say who's signed in", async () => {
      const env = environment({ cache: { ...emptyCache(), version: CACHE_VERSION, me: ME } });
      env.setLogin(new Error("offline"));
      await env.watch.boot();
      expect(env.watch.snapshot()).toMatchObject({
        signedIn: true,
        me: ME,
        status: { phase: "error", error: "offline" },
      });
      expect(env.calls).toStrictEqual([]);
      env.setLogin(ME);
      env.found["review-requested"] = [];
      await env.watch.refresh();
      expect(env.watch.snapshot().status.phase).toBe("idle");
      expect(env.calls).toHaveLength(1);
    });

    it("starts over for someone else", async () => {
      const env = await booted();
      env.setLogin("someone");
      await env.watch.authChanged();
      expect(env.watch.snapshot()).toMatchObject({ me: "someone", arrivals: [] });
      expect(env.calls.some((call) => call.includes("review-requested:someone"))).toBe(true);
    });

    it("does nothing without a setup or anyone signed in", async () => {
      const env = environment({ config: null });
      await env.watch.boot();
      expect(env.watch.snapshot()).toMatchObject({ ready: true, items: {} });
      expect(env.watch.pollMs()).toBe(60_000);
      const out = environment();
      out.setLogin(null);
      await out.watch.boot();
      expect(out.calls).toStrictEqual([]);
      await out.watch.endReview();
      await out.watch.tick();
    });

    it("says when a queue's file pattern can't be used", async () => {
      const env = await booted({ queues: [REVIEW, { id: "p", name: "Paths", kind: "review", includePaths: "(?=x)" }] });
      expect(env.watch.snapshot().status).toMatchObject({
        phase: "error",
        error: 'Paths: the file pattern "(?=x)" isn\'t supported',
      });
      expect(env.watch.snapshot().items.p).toStrictEqual([]);
    });

    it("shows last time's pull requests before GitHub answers", async () => {
      const first = await booted();
      const env = environment({ state: first.saved(), cache: first.savedCache() });
      env.prs.A = github("A");
      env.found["review-requested"] = ["A"];
      await env.watch.boot();
      expect(env.snapshots[0]).toMatchObject({ ready: true, me: ME });
      expect(env.snapshots[0]?.items.r?.map((i) => i.pr.id)).toStrictEqual(["A"]);
      expect(env.notes).toStrictEqual([]);
    });

    it("reads last time's state as it finds it", async () => {
      const cache = {
        ...emptyCache(),
        version: CACHE_VERSION,
        me: "",
        lists: { r: { search: "", ids: ["gone"], at: 0 } },
      };
      const env = environment({ cache, state: { dismissed: { nocolon: true } } });
      env.setLogin(new Error("offline"));
      await env.watch.boot();
      expect(env.watch.snapshot()).toMatchObject({ signedIn: false, items: {}, dismissed: { nocolon: true } });
      const known = environment({ cache: { ...cache, me: ME }, state: { dismissed: { nocolon: true } } });
      known.setLogin(new Error("offline"));
      await known.watch.boot();
      expect(known.watch.snapshot()).toMatchObject({ items: { r: [] }, dismissed: { nocolon: true } });
      const noSetup = environment({ config: null, cache: { ...cache, me: ME } });
      await noSetup.watch.boot();
      expect(noSetup.watch.snapshot().items).toStrictEqual({});
    });

    it("shows a queue with nothing found yet as empty", async () => {
      const env = environment({ cache: { ...emptyCache(), version: CACHE_VERSION, me: ME } });
      env.setLogin(new Error("offline"));
      await env.watch.boot();
      expect(env.watch.snapshot().items).toStrictEqual({ r: [] });
    });

    it("carries on after a job fails", async () => {
      const env = await booted();
      const watch = new QueueWatch({
        gql: { query: () => Promise.resolve({}) },
        login: () => Promise.resolve(ME),
        config: () => Promise.reject(new Error("unreadable")),
        now: () => T0,
        storage: {
          loadState: () => Promise.resolve(null),
          saveState: () => Promise.resolve(),
          loadCache: () => Promise.resolve(null),
          saveCache: () => Promise.resolve(),
        },
        notify: () => {
          // Nothing to show.
        },
        words: ENGLISH,
      });
      await expect(watch.boot()).rejects.toThrow("unreadable");
      await expect(watch.tick()).resolves.toBeUndefined();
      expect(env).toBeDefined();
    });
  });

  describe("review time", () => {
    const scheduled = {
      enabled: true,
      sessions: [{ id: "s", days: [1, 2, 3, 4, 5], times: ["15:00"] }],
    };

    it("keeps a review queue's notifications for review time, while one is coming", async () => {
      const env = await booted({ queues: [REVIEW], reviewTime: scheduled, sound: true });
      await another(env);
      await another(env, "C");
      expect(env.notes).toStrictEqual([]);
      expect(env.saved().held.map((h) => [h.key, h.until])).toStrictEqual([
        ["r:B:new", "review"],
        ["r:C:new", "review"],
      ]);
      expect(env.badges.at(-1)).toStrictEqual([3, false]);
      await env.watch.tick();
      expect(env.notes).toStrictEqual([]);
      // None coming any more: they show, summed up.
      env.setConfig({ queues: [REVIEW], sound: true });
      await env.watch.configChanged();
      await env.watch.tick();
      expect(env.notes).toStrictEqual([
        {
          title: "2 updates came in",
          body: "Ana asked for your review: Title B\nAna asked for your review: Title C",
          sound: true,
        },
      ]);
      expect(env.saved().held).toStrictEqual([]);
    });

    it("shows one kept notification as it was", async () => {
      const env = await booted({ queues: [REVIEW], reviewTime: scheduled });
      await another(env);
      env.setConfig({ queues: [REVIEW] });
      await env.watch.configChanged();
      await env.watch.tick();
      expect(env.notes).toStrictEqual([
        { title: "Ana asked for your review", body: "Title B\nacme/web#1", sound: false },
      ]);
    });

    it("keeps the latest few, once each", async () => {
      const env = await booted({ queues: [{ ...REVIEW, notifyAt: "review" }], reviewTime: scheduled });
      const ids = Array.from({ length: MAX_HELD + 2 }, (_, i) => `H${i}`);
      for (const id of ids) env.prs[id] = github(id);
      env.found["review-requested"] = ["A", ...ids];
      await env.watch.refresh(true);
      expect(env.saved().held).toHaveLength(MAX_HELD);
    });

    it("lets queues that don't wait notify right away", async () => {
      const env = await booted({ queues: [{ ...REVIEW, notifyAt: "now" }], reviewTime: scheduled });
      await another(env);
      expect(env.notes).toHaveLength(1);
    });

    it("keeps everything for the end of one under way, when asked to", async () => {
      const run = { session: "s", name: "Review time", minutes: 30, startedAt: T0, pulls: [], left: 0, overBy: 0 };
      const env = environment({
        config: { queues: [REVIEW], reviewTime: { holdWhileReviewing: true }, sound: true },
        state: { run },
      });
      env.prs.A = github("A");
      env.found["review-requested"] = ["A"];
      await env.watch.boot();
      expect(env.watch.snapshot().review).toStrictEqual({ run, endsAt: T0 + 30 * 60_000 });
      await another(env);
      expect(env.notes).toStrictEqual([]);
      expect(env.saved().held.map((h) => h.until)).toStrictEqual(["end"]);
      await env.watch.tick();
      expect(env.notes).toStrictEqual([]);
      await env.watch.endReview();
      expect(env.notes).toStrictEqual([
        { title: "Ana asked for your review", body: "Title B\nacme/web#1", sound: true },
      ]);
      expect(env.watch.snapshot().review).toBeNull();
      await env.watch.endReview();
      expect(env.notes).toHaveLength(1);
    });
  });
});

describe("readPersisted", () => {
  it("reads what was saved", () => {
    const saved: Persisted = {
      seen: { k: true },
      keys: ["k"],
      ci: { A: { oid: "h", state: null }, B: { oid: "h", state: "SUCCESS" } },
      dismissed: { "q:A": true },
      searches: { q: "is:pr" },
      eventsVersion: 1,
      held: [{ key: "k", title: "t", body: "b", until: "end" }],
      run: {
        session: "s",
        name: "n",
        minutes: 30,
        startedAt: 5,
        pulls: [{ id: "A", title: "t", repo: "r", number: 1, url: "u", minutes: 5, again: true }],
        left: 0,
        overBy: 0,
      },
      reviewCheckedAt: 9,
    };
    expect(readPersisted(JSON.parse(JSON.stringify(saved)))).toStrictEqual(saved);
    expect(readPersisted({ seen: { k: false } }).seen).toStrictEqual({ k: true });
  });

  it("starts afresh from what doesn't read", () => {
    const empty = readPersisted({});
    expect(empty).toStrictEqual({
      seen: {},
      keys: null,
      ci: {},
      dismissed: {},
      searches: {},
      eventsVersion: 0,
      held: [],
      run: null,
      reviewCheckedAt: 0,
    });
    for (const bad of [
      null,
      "x",
      { seen: { k: 1 } },
      { held: [{ until: "later" }] },
      { searches: { q: 1 } },
      { ci: { A: null } },
    ]) {
      expect(readPersisted(bad)).toStrictEqual(empty);
    }
  });
});

describe("searchKey", () => {
  it("leaves out the date a merged queue moves along", () => {
    expect(searchKey("is:pr is:merged merged:>=2026-01-01 -author:me")).toBe("is:pr is:merged -author:me");
  });
});
