/**
 * The TypeScript queue engine against the desktop app's Rust one, output for output. rust-parity.json holds inputs
 * (`fixtures`: queues, GitHub pull requests, search settings, comments…) and what Rust made of them (`rust`), from a
 * small program that ran engine.rs, config.rs and watch.rs's words as they were when this port was made (desktop
 * commit e2b3aa7). Rust's JSON has its keys sorted (serde_json's maps), so items are compared in that form, byte for
 * byte.
 */

import { describe, expect, it } from "vitest";

import { parsePullRequest, time, type PullRequest } from "../github-pulls/github-pulls";
import { parseConfig, type Queue } from "../queue-config/queue-config";
import { fragment, LIGHT, LIGHT_WITH_CHECKS, searchFor } from "../queue-engine/queue-engine";
import { freshEvents, itemsFor, mentions, snippet, type CiMemo, type Fresh } from "../queue-items/queue-items";
import { panelItem, type EngineItem } from "../queue-panel/queue-panel";
import { notificationWords, searchKey, summary, type Held, type Why } from "../queue-watch/queue-watch";
import { ENGLISH, PORTUGUESE, type Words } from "../queue-words/queue-words";
import parity from "./rust-parity.json";

interface Fixtures {
  me: string;
  now: number;
  searches: Array<{ queue: unknown; now: number; orgs: string[] }>;
  times: string[];
  snippets: string[];
  mentions: Array<[string, string]>;
  prs: unknown[];
  queues: unknown[];
  ci: Record<string, CiMemo>;
  held: Held[];
}

type FreshRow = [string, string, string, number];

interface Rust {
  fragments: string[];
  light: string[];
  searches: string[];
  searchKeys: string[];
  times: number[];
  snippets: Array<string | null>;
  mentions: boolean[];
  parsed: string[];
  items: Array<{ queue: string; items?: unknown[]; error?: string }>;
  fresh: Array<{ none: FreshRow[]; half: FreshRow[] } | null>;
  freshAll: FreshRow[];
  words: { en: Array<[string, string]>; pt: Array<[string, string]> };
  summaries: { en: Array<[string, string]>; pt: Array<[string, string]> };
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shape the program that wrote rust-parity.json gave it.
const { fixtures, rust } = parity as unknown as { fixtures: Fixtures; rust: Rust };
const { me, now } = fixtures;

/** JSON as serde_json writes a `Value`: keys sorted. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

const readQueue = (raw: unknown): Queue => parseConfig({ queues: [raw] })!.queues[0]!;

const queues = fixtures.queues.map((raw) => readQueue(raw));
const prs = fixtures.prs.map((raw) => parsePullRequest(raw)).filter((pr): pr is PullRequest => pr !== null);
const results = queues.map((q) => itemsFor(q, prs, me, fixtures.ci));
const all: EngineItem[] = results.flatMap((r) => (r.ok ? r.items : []));
const rows = (fresh: Fresh[]): FreshRow[] => fresh.map((f) => [f.item.queueId, f.event.key, f.event.kind, f.event.at]);

describe("the same output as the desktop's Rust engine", () => {
  it("asks GitHub the same queries", () => {
    expect([fragment(false, false), fragment(true, false), fragment(false, true), fragment(true, true)]).toStrictEqual(
      rust.fragments,
    );
    expect([LIGHT, LIGHT_WITH_CHECKS]).toStrictEqual(rust.light);
  });

  it("makes the same searches", () => {
    const searches = fixtures.searches.map((s) => searchFor(readQueue(s.queue), me, s.now, s.orgs));
    expect(searches).toStrictEqual(rust.searches);
    expect(searches.map((s) => searchKey(s))).toStrictEqual(rust.searchKeys);
  });

  it("reads dates, comments and mentions the same way", () => {
    expect(fixtures.times.map((t) => time(t))).toStrictEqual(rust.times);
    expect(fixtures.snippets.map((s) => snippet(s))).toStrictEqual(rust.snippets);
    expect(fixtures.mentions.map(([body, login]) => mentions(body, login))).toStrictEqual(rust.mentions);
  });

  it("reads the same pull requests from GitHub's replies", () => {
    expect(prs.map((pr) => pr.id)).toStrictEqual(rust.parsed);
  });

  it("makes the same items, serialized the same, or the same error", () => {
    const made = results.map((result, i) =>
      result.ok
        ? { queue: queues[i]!.id, items: canonical(result.items.map((item) => panelItem(item))) }
        : { queue: queues[i]!.id, error: ENGLISH.unsupportedPattern(result.problem.queue, result.problem.pattern) },
    );
    const expected = rust.items.map(({ queue, items: list, error }) =>
      list ? { queue, items: canonical(list) } : { queue, error },
    );
    expect(made).toStrictEqual(expected);
  });

  it("finds the same events worth a notification", () => {
    const found = results.map((result, i) => {
      if (!result.ok) return null;
      const keys = result.items.flatMap((item) => item.events.map((e) => e.key)).toSorted();
      const previous = new Set(keys.filter((_k, n) => n % 2 === 0));
      const seen = Object.fromEntries(keys.filter((_k, n) => n % 3 === 1).map((k) => [k, true]));
      return {
        none: rows(freshEvents(result.items, [queues[i]!], new Set(), {}, now)),
        half: rows(freshEvents(result.items, [queues[i]!], previous, seen, now)),
      };
    });
    expect(found).toStrictEqual(rust.fresh);
    expect(rows(freshEvents(all, queues, new Set(), {}, now))).toStrictEqual(rust.freshAll);
  });

  it.each([
    ["en", ENGLISH],
    ["pt", PORTUGUESE],
  ] as const)("words notifications the same (%s)", (locale, words: Words) => {
    const said: Array<[string, string]> = [];
    for (const item of all) {
      const kind = queues.find((q) => q.id === item.queueId)?.kind ?? null;
      for (const event of item.events) {
        const { title, body } = notificationWords({ item, event }, kind, words);
        said.push([title, body]);
      }
    }
    for (const f of freshEvents(all, queues, new Set(), {}, now)) {
      if (f.event.kind === "ci-passed") {
        const { title, body } = notificationWords(f, "authored", words);
        said.push([title, body]);
      }
    }
    expect(said).toStrictEqual(rust.words[locale]);

    const sums: Array<[string, string]> = [];
    for (const n of [1, 2, 5, 6, 9]) {
      for (const why of ["cameIn", "waitedForReview", "cameInWhileReviewing"] satisfies Why[]) {
        const { title, body } = summary(fixtures.held.slice(0, n), why, words);
        sums.push([title, body]);
      }
    }
    expect(sums).toStrictEqual(rust.summaries[locale]);
  });
});
