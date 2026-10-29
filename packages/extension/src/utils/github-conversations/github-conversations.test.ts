// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThreadSummary } from "@/utils/provider/provider";
import type { FileInfo } from "@/utils/review-files/review-files";

import { conversations } from "./github-conversations";

const fileWith = (path: string, threads: ThreadSummary[], diff: HTMLElement | null = null): FileInfo => ({
  path,
  anchor: path,
  stats: null,
  viewed: false,
  diff: diff ? { element: diff, container: diff } : null,
  threads,
});

const summary = (id: string, line: string, state: ThreadSummary["state"] = "waiting", comment = ""): ThreadSummary => ({
  id,
  line,
  state,
  comment,
});

type GoToFile = (file: FileInfo) => Promise<HTMLElement | null>;

const element = (selector: string) => document.querySelector<HTMLElement>(selector)!;

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = `<meta name="user-login" content="reader" />`;
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the newer view's conversations", () => {
  it("lists GitHub's data in file then line order, kept current with the conversations open on the page", () => {
    document.body.innerHTML = `
      <div id="diff"><table>
        <tr><td data-line-number="5" data-diff-side="right"></td></tr>
        <tr><td data-line-number="9" data-diff-side="right">
          <div data-marker-id="2"><div id="r20"><a data-hovercard-type="user">reader</a></div></div></td></tr>
        <tr><td data-line-number="7" data-diff-side="right">
          <div data-marker-id="4"><div id="r40"><a data-hovercard-type="user">ada</a></div></div></td></tr>
      </table></div>`;
    const drawn = fileWith(
      "a.ts",
      [summary("1", "R5"), summary("2", "R9"), summary("3", "R30", "resolved")],
      element("#diff"),
    );
    const elsewhere = fileWith("b.ts", [summary("5", "Rx")]);
    const found = conversations([drawn, elsewhere], true);
    expect(found.map(({ file, line, state, element: target }) => [file.path, line, state, target])).toEqual([
      ["a.ts", 7, "waiting", null],
      ["a.ts", 9, "answered", null],
      ["a.ts", 30, "resolved", null],
      ["b.ts", null, "waiting", null],
    ]);
  });

  it("keeps GitHub's data for a drawn file with no conversation open", () => {
    document.body.innerHTML = `<div id="diff"></div>`;
    const found = conversations([fileWith("a.ts", [summary("1", "R5")], element("#diff"))], true);
    expect(found.map(({ line }) => line)).toEqual([5]);
  });

  it("opens a conversation through GitHub's comment link, without adding to the reader's history", async () => {
    addEventListener(
      "hashchange",
      () => {
        document.body.innerHTML = `<div data-marker-id="1"><div id="r10"></div></div>`;
      },
      { once: true },
    );
    const [target] = conversations([fileWith("a.ts", [summary("1", "R5", "waiting", "10")])], true);
    const goToFile = vi.fn<GoToFile>();
    const length = history.length;
    const opened = target!.open({ goToFile, stale: () => false });
    await vi.runAllTimersAsync();
    expect(await opened).toBe(element('[data-marker-id="1"]'));
    expect(location.hash).toBe("#r10");
    expect(history.length).toBe(length);
    expect(goToFile).not.toHaveBeenCalled();
  });

  it("gives up on a jump a newer one has taken over", async () => {
    const [target] = conversations([fileWith("a.ts", [summary("1", "R5", "waiting", "10")])], true);
    const goToFile = vi.fn<GoToFile>();
    const opened = target!.open({ goToFile, stale: () => true });
    await vi.runAllTimersAsync();
    expect(await opened).toBeNull();
    expect(goToFile).not.toHaveBeenCalled();
  });

  it("without a link, opens the file and finds the conversation's marker among its lines", async () => {
    document.body.innerHTML = `<div id="diff">
      <div class="CommentIndicator-module__commentIndicator_a" id="first"></div>
      <div class="CommentIndicator-module__commentIndicator_a" id="second"></div></div>`;
    vi.spyOn(element("#first"), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 10, 1, 1));
    vi.spyOn(element("#second"), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 20, 1, 1));
    const file = fileWith("a.ts", [summary("1", "R5"), summary("2", "R5"), summary("3", "R8")]);
    const targets = conversations([file], true);
    const goToFile = vi.fn<GoToFile>(() => Promise.resolve(element("#diff")));
    const opened = targets[2]!.open({ goToFile, stale: () => false });
    await vi.runAllTimersAsync();
    expect(await opened).toBe(element("#second"));
    expect(goToFile).toHaveBeenCalledWith(file);
  });

  it("settles for the file when its marker doesn't show, after the link didn't open it", async () => {
    document.body.innerHTML = `<div id="diff"></div>`;
    const [target] = conversations([fileWith("a.ts", [summary("1", "R5", "waiting", "10")])], true);
    const opened = target!.open({ goToFile: () => Promise.resolve(element("#diff")), stale: () => false });
    await vi.runAllTimersAsync();
    expect(await opened).toBe(element("#diff"));
  });

  it("stops when the file can't be opened or a newer jump took over", async () => {
    document.body.innerHTML = `<div id="diff"></div>`;
    const [target] = conversations([fileWith("a.ts", [summary("1", "R5")])], true);
    expect(await target!.open({ goToFile: () => Promise.resolve(null), stale: () => false })).toBeNull();
    expect(await target!.open({ goToFile: () => Promise.resolve(element("#diff")), stale: () => true })).toBeNull();
  });
});

describe("the classic view's conversations", () => {
  it("lists the threads drawn in each file", () => {
    document.body.innerHTML = `<div id="diff"><table>
      <tr><td data-line-number="3"></td></tr>
      <tr><td><review-thread-collapsible data-resolved="true"></review-thread-collapsible></td></tr></table></div>`;
    const found = conversations([fileWith("a.ts", [], element("#diff")), fileWith("b.ts", [])], false);
    expect(found.map(({ file, line, state, element: target }) => [file.path, line, state, target])).toEqual([
      ["a.ts", 3, "resolved", element("review-thread-collapsible")],
    ]);
  });

  it("opens a collapsed thread and waits for its comments", async () => {
    document.body.innerHTML = `<div id="diff"><review-thread-collapsible>
      <button aria-expanded="false" data-target="review-thread-collapsible.button"></button></review-thread-collapsible></div>`;
    const thread = element("review-thread-collapsible");
    element("button").addEventListener("click", () => {
      setTimeout(() => {
        thread.insertAdjacentHTML("beforeend", `<div id="r1"></div>`);
      }, 200);
    });
    const [target] = conversations([fileWith("a.ts", [], element("#diff"))], false);
    const opened = target!.open({ goToFile: vi.fn<GoToFile>(), stale: () => false });
    await vi.runAllTimersAsync();
    expect(await opened).toBe(thread);
    expect(thread.querySelector("#r1")).not.toBeNull();
  });

  it("opens an expanded thread right away", async () => {
    document.body.innerHTML = `<div id="diff"><review-thread-collapsible><div id="r1"></div></review-thread-collapsible></div>`;
    const [target] = conversations([fileWith("a.ts", [], element("#diff"))], false);
    expect(await target!.open({ goToFile: vi.fn<GoToFile>(), stale: () => false })).toBe(
      element("review-thread-collapsible"),
    );
  });
});
