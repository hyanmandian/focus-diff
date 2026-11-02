import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { useSaved } from "@/hooks/use-saved/use-saved";
import type { Saved } from "@/utils/bridge/bridge";
import { emit, mockCommands } from "@/utils/fake-platform/fake-platform";
import { deferred } from "@/utils/mock-render/mock-render";

const run = (id: string): Saved => ({
  id,
  kind: "analysis",
  key: "",
  head: "abc",
  at: 1,
  status: "done",
  project: false,
  meta: "",
  archived: false,
  dismissed: [],
});

describe("useSaved", () => {
  it("reads what the AI kept for the pull request, and again whenever it changes", async () => {
    let kept = [run("a")];
    const asked: unknown[] = [];
    mockCommands((cmd, args) => {
      asked.push([cmd, args]);
      return kept;
    });
    const { result } = renderHook(() => useSaved("PR_1"));
    expect(result.current).toBeNull();
    await waitFor(() => {
      expect(result.current?.map((r) => r.id)).toEqual(["a"]);
    });
    expect(asked).toEqual([["ai_saved", { pull: "PR_1" }]]);
    kept = [run("a"), run("b")];
    await act(() => emit("ai-saved", "PR_2"));
    expect(asked).toHaveLength(1);
    await act(() => emit("ai-saved", "PR_1"));
    await waitFor(() => {
      expect(result.current?.map((r) => r.id)).toEqual(["a", "b"]);
    });
  });

  it("keeps only the latest answer, and none for a pull request it moved away from", async () => {
    const first = deferred<Saved[]>();
    const answers = [first.promise, Promise.resolve([run("new")])];
    mockCommands(() => answers.shift() ?? Promise.reject(new Error("offline")));
    const { result, rerender, unmount } = renderHook(({ pull }) => useSaved(pull), { initialProps: { pull: "PR_1" } });
    await act(() => emit("ai-saved", "PR_1"));
    await waitFor(() => {
      expect(result.current?.map((r) => r.id)).toEqual(["new"]);
    });
    await act(async () => {
      first.resolve([run("old")]);
      await first.promise;
    });
    expect(result.current?.map((r) => r.id)).toEqual(["new"]);
    rerender({ pull: "PR_2" });
    expect(result.current).toBeNull();
    unmount();
  });
});
