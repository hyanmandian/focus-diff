import { describe, expect, it } from "vitest";
import { nextAfter } from "@/utils/arrange/arrange";
import type { Item } from "@/utils/engine/engine";

const item = (id: string, repo: string, updatedAt: string, isDraft = false): Item =>
  ({ queueId: "q", pr: { id, repository: { nameWithOwner: repo }, updatedAt, isDraft }, events: [], ci: null }) as unknown as Item;

describe("nextAfter", () => {
  const list = [item("a", "o/one", "2026-01-03"), item("b", "o/one", "2026-01-01"), item("c", "o/two", "2026-01-02"), item("d", "o/one", "2026-01-04", true)];
  const read = () => false;

  it("follows the panel's order: by repository, then the drafts", () => {
    expect(nextAfter(list, "a", read)?.pr.id).toBe("b");
    expect(nextAfter(list, "b", read)?.pr.id).toBe("c");
    expect(nextAfter(list, "c", read)?.pr.id).toBe("d");
  });

  it("goes back to the top past the end, and to it when the current one has left", () => {
    expect(nextAfter(list, "d", read)?.pr.id).toBe("a");
    expect(nextAfter(list, "gone", read)?.pr.id).toBe("a");
  });

  it("has none when it's the only one", () => {
    expect(nextAfter([list[0]!], "a", read)).toBeNull();
    expect(nextAfter([], "a", read)).toBeNull();
  });
});
