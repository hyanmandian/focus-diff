import { describe, expect, it } from "vite-plus/test";

import { mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Args } from "@/utils/platform/platform";
import { loadStack, type StackPull } from "@/utils/stack/stack";

type Pull = StackPull & {
  headRefName: string;
  baseRefName: string;
  isCrossRepository: boolean;
  reviewDecision: StackPull["decision"];
};

const pull = (number: number, head: string, base: string, extra: Partial<Pull> = {}): Pull => ({
  id: `PR_${number}`,
  number,
  title: `Part ${number}`,
  author: { login: "ana", name: "Ana" },
  isDraft: false,
  decision: null,
  reviewDecision: null,
  headRefName: head,
  baseRefName: base,
  isCrossRepository: false,
  ...extra,
});

function variables(args: Args | undefined): Record<string, string> {
  if (args === undefined || args instanceof Uint8Array) return {};
  const body: unknown = JSON.parse(String(args.body));
  const isVariables = (v: unknown): v is { variables: Record<string, string> } =>
    typeof v === "object" && v !== null && "variables" in v;
  return isVariables(body) ? body.variables : {};
}

function repository(pulls: Pull[]) {
  let asked = 0;
  mockCommands((_cmd, args) => {
    asked++;
    const { head, base } = variables(args);
    const data = {
      repository: {
        above: { nodes: pulls.filter((p) => p.baseRefName === head) },
        below: { nodes: pulls.filter((p) => p.headRefName === base) },
      },
    };
    return { status: 200, body: JSON.stringify({ data }) };
  });
  return () => asked;
}

const self = (p: Pull): StackPull => ({
  id: p.id,
  number: p.number,
  title: p.title,
  author: p.author,
  isDraft: p.isDraft,
  decision: p.decision,
});
const at = (p: Pull) => ({
  owner: "acme",
  repo: "web",
  headRefName: p.headRefName,
  baseRefName: p.baseRefName,
  self: self(p),
});

describe("finding a pull request's stack", () => {
  const one = pull(1, "one", "main", { reviewDecision: "APPROVED" });
  const two = pull(2, "two", "one");
  const three = pull(3, "three", "two", { isDraft: true, reviewDecision: "CHANGES_REQUESTED" });
  const four = pull(4, "four", "three");

  it("follows the branches down to the bottom and up to the top, in order", async () => {
    repository([one, two, three, four]);
    const stack = await loadStack(at(two));
    expect(stack.map((p) => p.number)).toEqual([1, 2, 3, 4]);
    expect(stack[0]).toEqual({
      id: "PR_1",
      number: 1,
      title: "Part 1",
      author: { login: "ana", name: "Ana" },
      isDraft: false,
      decision: "APPROVED",
    });
    expect(stack[2]).toMatchObject({ isDraft: true, decision: "CHANGES_REQUESTED" });
  });

  it("is the pull request alone when nothing is built on it or under it", async () => {
    repository([pull(9, "solo", "main")]);
    expect((await loadStack(at(pull(9, "solo", "main")))).map((p) => p.number)).toEqual([9]);
  });

  it("leaves out a fork's pull request whose branch shares a name", async () => {
    repository([pull(5, "one", "main", { isCrossRepository: true }), one, two]);
    expect((await loadStack(at(two))).map((p) => p.number)).toEqual([1, 2]);
  });

  it("stops at a loop instead of going round it", async () => {
    const a = pull(10, "a", "b");
    const b = pull(11, "b", "a");
    repository([a, b]);
    expect((await loadStack(at(a))).map((p) => p.number)).toEqual([11, 10]);
  });

  it("goes no further than a dozen each way", async () => {
    const tall = Array.from({ length: 30 }, (_, i) => pull(100 + i, `b${i}`, i === 0 ? "main" : `b${i - 1}`));
    const asked = repository(tall);
    const stack = await loadStack(at(tall[15]!));
    expect(stack).toHaveLength(25);
    expect(stack[0]!.number).toBe(103);
    expect(stack.at(-1)!.number).toBe(127);
    expect(asked()).toBe(25);
  });
});
