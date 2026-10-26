import { afterEach, describe, expect, it, vi } from "vitest";

import { MOST_REFUSALS, outboxItem, send, startOutbox, type Mark } from "./viewed-outbox";

type Reply = { status?: number; body?: string } | Error;

const gitHub = (...replies: Reply[]) => {
  const asked: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const api = {
    requestForPage: vi.fn<(m: string, p: string, body: string | null) => Promise<{ status: number; body: string }>>(
      (_m, _p, body) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test reads back, or plants, data in the shape it knows
        asked.push(JSON.parse(body!) as (typeof asked)[number]);
        const reply = replies.length > 1 ? replies.shift()! : replies[0]!;
        return reply instanceof Error
          ? Promise.reject(reply)
          : Promise.resolve({ status: reply.status ?? 200, body: reply.body ?? "" });
      },
    ),
  };
  return { api, asked };
};

const mark = (viewed = true): Mark => ({ pull: "PR_1", path: "a.ts", viewed, refused: 0 });
const took = (field: string) => ({ body: JSON.stringify({ data: { [field]: { clientMutationId: null } } }) });

afterEach(() => {
  vi.useRealTimers();
});

describe("a viewed mark", () => {
  it("is GitHub's markFileAsViewed or unmarkFileAsViewed", async () => {
    const { api, asked } = gitHub(took("markFileAsViewed"), took("x"));
    await expect(send(api, mark())).resolves.toBe("done");
    await expect(send(api, mark(false))).resolves.toBe("refused");
    expect(asked[0]!.query).toContain("markFileAsViewed(input");
    expect(asked[1]!.query).toContain("unmarkFileAsViewed(input");
    expect(asked[0]!.variables).toEqual({ id: "PR_1", path: "a.ts" });
  });

  it("is refused when GitHub says no, and later when it can't take it now", async () => {
    const outcome = (reply: Reply) => send(gitHub(reply).api, mark());
    expect(await outcome({ body: "not json" })).toBe("refused");
    expect(await outcome({ status: 422 })).toBe("refused");
    // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
    for (const status of [401, 403, 429, 500]) expect(await outcome({ status })).toBe("later");
    expect(await outcome(new Error("offline"))).toBe("later");
  });
});

describe("the outbox", () => {
  it("sends marks as they come, the latest per file, and keeps what's left in storage", async () => {
    let release: () => void = () => {};
    let held = true;
    const { api } = gitHub({
      body: JSON.stringify({ data: { markFileAsViewed: {}, unmarkFileAsViewed: {} } }),
    });
    const slow = {
      requestForPage: (...args: Parameters<typeof api.requestForPage>) =>
        held
          ? new Promise<{ status: number; body: string }>((resolve) => {
              release = () => {
                held = false;
                void api.requestForPage(...args).then(resolve);
              };
            })
          : api.requestForPage(...args),
    };
    const outbox = await startOutbox(slow);
    await outbox.add("PR_1", "a.ts", true);
    await outbox.add("PR_1", "a.ts", false);
    await outbox.add("PR_2", "b.ts", true);
    expect(outbox.pending("PR_1")).toEqual({ "a.ts": false });
    await expect(outboxItem.getValue()).resolves.toHaveLength(2);
    release();
    await vi.waitFor(() => {
      expect([outbox.pending("PR_1"), outbox.pending("PR_2")]).toEqual([{}, {}]);
    });
  });

  it("starts with what was left, puts a refused mark at the back, and gives up on it in the end", async () => {
    vi.useFakeTimers();
    await outboxItem.setValue([mark(), { ...mark(), path: "b.ts" }]);
    const { api, asked } = gitHub({ status: 422 });
    const outbox = await startOutbox(api);
    await vi.advanceTimersByTimeAsync(0);
    expect(asked.map((a) => a.variables.path)).toEqual(["a.ts"]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked.map((a) => a.variables.path).slice(0, 3)).toEqual(["a.ts", "b.ts", "a.ts"]);
    expect(asked).toHaveLength(MOST_REFUSALS * 2);
    expect(outbox.pending("PR_1")).toEqual({});
  });

  it("keeps a mark GitHub couldn't take, and tries again", async () => {
    vi.useFakeTimers();
    const { api, asked } = gitHub(new Error("offline"), took("markFileAsViewed"));
    const outbox = await startOutbox(api);
    await outbox.add("PR_1", "a.ts", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.pending("PR_1")).toEqual({ "a.ts": true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(asked).toHaveLength(2);
    expect(outbox.pending("PR_1")).toEqual({});
  });

  it("leaves a newer mark made while one was on its way", async () => {
    let release: () => void = () => {};
    const { api } = gitHub({ status: 422 });
    const slow = {
      requestForPage: (...args: Parameters<typeof api.requestForPage>) =>
        new Promise<{ status: number; body: string }>((resolve) => {
          release = () => void api.requestForPage(...args).then(resolve);
        }),
    };
    vi.useFakeTimers();
    const outbox = await startOutbox(slow);
    await outbox.add("PR_1", "a.ts", true);
    await outbox.add("PR_1", "a.ts", false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(outboxItem.getValue()).resolves.toEqual([{ ...mark(false), refused: 0 }]);
  });

  it("starts empty from what doesn't read", async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test reads back, or plants, data in the shape it knows
    await outboxItem.setValue("broken" as unknown as Mark[]);
    const outbox = await startOutbox(gitHub({}).api);
    expect(outbox.pending("PR_1")).toEqual({});
  });
});
