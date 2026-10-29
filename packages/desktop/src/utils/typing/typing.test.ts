import { describe, expect, it, vi } from "vite-plus/test";

import { forgetTyping, keepTyping, resetTyping, typed } from "@/utils/typing/typing";

describe("typing", () => {
  it("keeps what was typed, across a reload, until it's forgotten", () => {
    expect(typed("reply:1")).toBeNull();
    keepTyping("reply:1", "Half a reply");
    expect(typed("reply:1")).toBe("Half a reply");
    resetTyping();
    expect(typed("reply:1")).toBe("Half a reply");
    forgetTyping("reply:1");
    expect(typed("reply:1")).toBeNull();
  });

  it("forgets an empty field", () => {
    keepTyping("reply:1", "Something");
    keepTyping("reply:1", "  ");
    expect(typed("reply:1")).toBeNull();
    expect(localStorage.getItem("typing:reply:1")).toBeNull();
  });

  it("ignores what it can't read", () => {
    for (const stored of ["{", "null", '"text"', JSON.stringify({ text: 3 })]) {
      localStorage.setItem("typing:x", stored);
      expect(typed("x")).toBeNull();
    }
  });

  it("keeps only the most recent fields", () => {
    localStorage.setItem("typing:broken", "{");
    localStorage.setItem("typing:undated", JSON.stringify({ text: "a" }));
    for (let i = 0; i < 50; i++) localStorage.setItem(`typing:old-${i}`, JSON.stringify({ text: "a", at: i + 1 }));
    keepTyping("new", "b");
    const kept = Object.keys(localStorage).filter((key) => key.startsWith("typing:"));
    expect(kept).toHaveLength(50);
    expect(kept).toContain("typing:new");
    expect(kept).not.toContain("typing:broken");
    expect(kept).not.toContain("typing:old-0");
  });

  it("still works when storage doesn't", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Full");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("Denied");
    });
    keepTyping("a", "Kept in memory");
    expect(typed("a")).toBe("Kept in memory");
    forgetTyping("a");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Denied");
    });
    expect(typed("a")).toBeNull();
  });
});
