import { describe, expect, it, vi } from "vite-plus/test";

import { reviewRun, startReview } from "@/utils/ai-runs/ai-runs";
import type { AiReview } from "@/utils/ai/ai";

const REVIEW: AiReview = { summary: "Fine", findings: [], project: false, at: 1 };

describe("AI review runs", () => {
  it("runs once per head, keeps the result, and lets go when done", async () => {
    const work = vi.fn<() => Promise<AiReview>>(() => Promise.resolve(REVIEW));
    const first = startReview("acme/web#1", "abc", work);
    expect(startReview("acme/web#1", "abc", work)).toBe(first);
    expect(reviewRun("acme/web#1")?.head).toBe("abc");
    await expect(first).resolves.toEqual({ head: "abc", review: REVIEW });
    expect(work).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem("ai-review:acme/web#1") ?? "null")).toEqual({ head: "abc", review: REVIEW });
    expect(reviewRun("acme/web#1")).toBeNull();
  });

  it("starts over for new commits and keeps only the newest run", async () => {
    let finish: (review: AiReview) => void = () => {};
    const old = startReview(
      "acme/web#1",
      "abc",
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const fresh = startReview("acme/web#1", "def", () => Promise.resolve(REVIEW));
    await fresh;
    finish(REVIEW);
    await old;
    expect(reviewRun("acme/web#1")).toBeNull();
  });

  it("still answers when storage doesn't work", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Full");
    });
    await expect(startReview("acme/web#2", "abc", () => Promise.resolve(REVIEW))).resolves.toEqual({
      head: "abc",
      review: REVIEW,
    });
  });
});
