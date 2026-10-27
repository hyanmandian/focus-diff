import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { useStack } from "@/hooks/use-stack/use-stack";
import type { Details } from "@/utils/details/details";
import { fakeDetails } from "@/utils/mock-pull/mock-pull";
import { loadStack, type StackPull } from "@/utils/stack/stack";

vi.mock("@/utils/stack/stack", () => ({ loadStack: vi.fn<typeof loadStack>() }));

let made = 0;
/** A pull request's details, a new head each time unless one is given. */
const details = (over: Partial<Details> = {}): Details =>
  fakeDetails({
    id: "PR_7",
    number: 7,
    title: "Keep the promo code",
    owner: "acme",
    repo: "shop",
    author: { login: "ana" },
    isDraft: false,
    reviewDecision: "REVIEW_REQUIRED",
    viewerDidAuthor: false,
    state: "OPEN",
    headRefName: "promo",
    baseRefName: "cart",
    headRefOid: `head-${made++}`,
    ...over,
  });

const pull = (number: number): StackPull => ({
  id: `PR_${number}`,
  number,
  title: `Part ${number}`,
  author: null,
  isDraft: false,
  decision: null,
});

describe("useStack", () => {
  it("finds the stack and where this one is in it, once per head", async () => {
    vi.mocked(loadStack).mockImplementation(({ self }) => Promise.resolve([pull(5), self, pull(9)]));
    const first = details();
    const { result, rerender } = renderHook(({ d }) => useStack(d), { initialProps: { d: first } });
    await waitFor(() => {
      expect(result.current?.at).toBe(1);
    });
    expect(result.current?.pulls.map((p) => p.number)).toEqual([5, 7, 9]);
    expect(vi.mocked(loadStack).mock.calls[0]![0]).toMatchObject({
      owner: "acme",
      repo: "shop",
      headRefName: "promo",
      baseRefName: "cart",
      self: { id: "PR_7", decision: "REVIEW_REQUIRED" },
    });
    // The same head read again: nothing's asked again.
    rerender({ d: { ...first } });
    await act(() => Promise.resolve());
    expect(loadStack).toHaveBeenCalledTimes(1);
  });

  it("has none for one alone, the author, a closed one, or nothing loaded yet", async () => {
    vi.mocked(loadStack).mockImplementation(({ self }) => Promise.resolve([self]));
    const [alone, mine, merged] = [details(), details({ viewerDidAuthor: true }), details({ state: "MERGED" })];
    const { result } = renderHook(() => useStack(alone));
    await act(() => Promise.resolve());
    expect(result.current).toBeNull();
    expect(renderHook(() => useStack(mine)).result.current).toBeNull();
    expect(renderHook(() => useStack(merged)).result.current).toBeNull();
    expect(renderHook(() => useStack(null)).result.current).toBeNull();
  });

  it("asks again after a failure, and drops an answer that comes after it's gone", async () => {
    const d = details();
    vi.mocked(loadStack).mockRejectedValueOnce(new Error("offline"));
    const failed = renderHook(() => useStack(d));
    await act(() => Promise.resolve());
    expect(failed.result.current).toBeNull();
    failed.unmount();
    let answer!: (pulls: StackPull[]) => void;
    vi.mocked(loadStack).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const gone = renderHook(() => useStack(d));
    expect(loadStack).toHaveBeenCalledTimes(2);
    gone.unmount();
    act(() => {
      answer([pull(5), pull(7)]);
    });
    await act(() => Promise.resolve());
    expect(gone.result.current).toBeNull();
  });
});
