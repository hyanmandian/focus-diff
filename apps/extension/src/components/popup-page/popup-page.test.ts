import { normalizeLearned } from "@focus-diff/core/estimate";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { renderReviewPanel } from "@/components/popup-review-time/popup-review-time";
import html from "@/entrypoints/popup/index.html?raw";
import { h } from "@/utils/dom/dom";
import { $ } from "@/utils/extension-page/extension-page";
import type { PullRequest } from "@/utils/github-inbox/github-inbox";
import { DEFAULT_NOTIFY, type HeldEvent, type InboxSnapshot } from "@/utils/inbox/inbox";
import type { Message } from "@/utils/messages/messages";
import { DEFAULT_REVIEW_TIME, type ReviewRun } from "@/utils/review-sessions/review-sessions";
import {
  appearanceItem,
  doneItem,
  heldItem,
  inboxItem,
  learnedItem,
  notifyItem,
  popupItem,
  pullFilesItem,
  reviewRunItem,
  reviewSkipItem,
  reviewTimeItem,
} from "@/utils/storage/storage";

import { startPopup } from "./popup-page";

vi.mock(import("@/components/popup-review-time/popup-review-time"), () => ({
  renderReviewPanel: vi.fn<typeof renderReviewPanel>(),
}));

const NOW = Date.parse("2026-10-26T12:00:00Z");

const pull = (over: Partial<PullRequest> = {}): PullRequest => ({
  repo: "acme/web",
  number: 1,
  title: "Fix the header",
  url: "https://github.com/acme/web/pull/1",
  author: "ana",
  draft: false,
  comments: 0,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-26T09:00:00Z",
  unread: false,
  headSha: "abc",
  ...over,
});

const inbox = (over: Partial<InboxSnapshot> = {}): InboxSnapshot => ({
  me: "me",
  reviews: [],
  mine: [],
  checkedAt: NOW - 5 * 60_000,
  problem: null,
  ...over,
});

/** Lets the storage reads, the messages and the frames they wait on settle. */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(50);
};

/** The ResizeObservers the popup makes, to say a size changed. */
let resized: (() => void)[] = [];

/** The messages the popup sent the background, and how the background answers. */
let sent: Message[] = [];
let answer: "ok" | "never" | "fail" = "ok";

const held = (until: HeldEvent["until"]): HeldEvent => ({
  kind: "review-requested",
  repo: "acme/web",
  number: 1,
  title: "Fix the header",
  url: "u",
  actor: "ana",
  bot: false,
  draft: false,
  approvedByMe: false,
  team: false,
  again: false,
  excerpt: "",
  until,
  heldAt: NOW,
});

const start = async () => {
  startPopup();
  await settle();
};

const $$ = <T extends Element = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
const titles = (panel = "#panel-reviews") =>
  $$(`${panel} .groups > :not(details) .pull-title`).map((t) => t.textContent);
const layout = (element: Element, sizes: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(sizes)) Object.defineProperty(element, key, { configurable: true, value });
};
const press = (target: Element, key: string) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "requestAnimationFrame", "Date"] });
  vi.setSystemTime(NOW);
  const body = /<body>([\s\S]*)<\/body>/u.exec(html)?.[1] ?? "";
  document.head.replaceChildren();
  document.documentElement.removeAttribute("style");
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/u, "");
  localStorage.clear();
  resized = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        resized.push(callback);
      }
      observe() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  sent = [];
  answer = "ok";
  fakeBrowser.runtime.onMessage.addListener((message: Message, _sender, respond: () => void) => {
    sent.push(message);
    if (answer === "fail") throw new Error("gone");
    if (answer === "ok") respond();
    // oxlint-disable-next-line typescript/strict-void-return -- true keeps the message open for an answer, as in Chrome; the types leave it out.
    return true;
  });
  vi.spyOn(fakeBrowser.tabs, "create");
  vi.spyOn(window, "close").mockImplementation(() => {});
  vi.mocked(renderReviewPanel).mockReset();
  // An author's picture is still loading as it's placed.
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "offsetParent");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("startPopup", () => {
  it("lists the review queue by repository, with news first", async () => {
    await inboxItem.setValue(
      inbox({
        reviews: [
          pull({ url: "u1", title: "Old", updatedAt: "2026-10-20T00:00:00Z" }),
          pull({ url: "u2", title: "Fresh", unread: true, updatedAt: "2026-10-21T00:00:00Z" }),
          pull({ url: "u3", title: "Again", again: true, updatedAt: "2026-10-19T00:00:00Z" }),
          pull({ url: "u4", title: "Other", repo: "acme/api", updatedAt: "2026-10-25T00:00:00Z" }),
        ],
      }),
    );
    await start();
    expect($$("#panel-reviews .group-title").map((t) => t.textContent)).toStrictEqual(["acme/web3", "acme/api1"]);
    expect(titles()).toStrictEqual(["Again", "Fresh", "Old", "Other"]);
    expect($("#count-reviews").textContent).toBe("4");
    expect($("#updated").textContent).toBe("Updated 5m ago");
    expect(document.documentElement.classList.contains("pending")).toBe(false);
    expect(sent).toContainEqual({ type: "inbox-refresh" });
  });

  it("shows a row's details: author, estimate, time, comments, and labels", async () => {
    await reviewTimeItem.setValue({ ...DEFAULT_REVIEW_TIME, learn: true });
    await learnedItem.setValue(normalizeLearned({}));
    await pullFilesItem.setValue({
      big: { sha: "abc", files: [["a.ts", 4000, 0, false]] },
      none: { sha: "abc", files: [] },
    });
    await inboxItem.setValue(
      inbox({
        reviews: [
          pull({ url: "big", title: "Big", comments: 3, unread: true, again: true }),
          pull({ url: "none", title: "Nothing", author: "", updatedAt: "" }),
          pull({ url: "draft", title: "Draft", draft: true, author: "cy" }),
        ],
        mine: [pull({ url: "mine", title: "Mine", draft: true, updatedAt: "2025-01-01T00:00:00Z" })],
      }),
    );
    await start();
    const big = $("#panel-reviews a[href='big/changes']");
    expect(big.classList.contains("unread")).toBe(true);
    expect(big.querySelector(".pull-author")?.textContent).toBe("ana");
    expect(big.querySelector(".pull-estimate .visually-hidden")?.textContent).toMatch(/^About \d.* to review$/u);
    expect(big.querySelector(".pull-comments > span[aria-hidden]")?.textContent).toBe("3");
    expect(big.querySelector(".pull-again")?.textContent).toBe("Re-review");
    expect(big.querySelector(".pull-time")?.textContent).toBe("3h ago");
    expect(big.querySelector(".avatar img")?.getAttribute("src")).toBe(
      "https://avatars.githubusercontent.com/ana?size=48",
    );
    const none = $("#panel-reviews a[href='none/changes']");
    expect(none.querySelector(".pull-author")).toBeNull();
    expect(none.querySelector(".pull-estimate")).toBeNull();
    expect(none.querySelector(".pull-time")).toBeNull();
    // Drafts on the review queue wait folded, and the count leaves them out.
    expect($("#count-reviews").textContent).toBe("2");
    const drafts = $<HTMLDetailsElement>("#panel-reviews details");
    expect(drafts.querySelector("summary")?.textContent).toBe("Drafts1");
    expect(drafts.open).toBe(false);
    // My own say draft on the row, and open on the conversation.
    const mine = $("#panel-mine a[href='mine']");
    expect(mine.querySelector(".pull-draft")?.textContent).toBe("Draft");
    expect(mine.querySelector(".pull-time")?.textContent).toBe("2y ago");
    expect(mine.querySelector(".avatar img")).toBeNull();
  });

  it("leaves estimates out when the reader turns them off, and with a pace not learned", async () => {
    await reviewTimeItem.setValue({ ...DEFAULT_REVIEW_TIME, queueEstimates: false });
    await pullFilesItem.setValue({ big: { sha: "abc", files: [["a.ts", 40, 0, false]] } });
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "big" })] }));
    await start();
    expect($$(".pull-estimate")).toHaveLength(0);
    await reviewTimeItem.setValue({ ...DEFAULT_REVIEW_TIME, queueEstimates: true, learn: false });
    await settle();
    expect($$(".pull-estimate")).toHaveLength(1);
  });

  it("says when a moment ago was, and keeps the clock on", async () => {
    await inboxItem.setValue(inbox({ checkedAt: NOW - 1000, reviews: [pull({ updatedAt: "2026-10-26T11:59:59Z" })] }));
    await start();
    expect($("#updated").textContent).toBe("Updated now");
    expect($(".pull-time").textContent).toBe("now");
  });

  it("wears the reader's own theme over the defaults", async () => {
    await appearanceItem.setValue({
      theme: "mine",
      themes: [{ id: "mine", name: "Mine", colors: { accent: "#123456" } }],
    });
    await start();
    const style = document.head.querySelector("style")!.textContent;
    expect(style).toContain("#123456");
    expect(style).not.toContain(":host");
    await appearanceItem.setValue({ theme: "provider", themes: [] });
    await settle();
    expect(document.head.querySelector("style")!.textContent).not.toContain("#123456");
  });

  it("shows a skeleton while the first look is on its way", async () => {
    answer = "never";
    await start();
    expect($("#panel-reviews").getAttribute("aria-busy")).toBe("true");
    expect($$("#panel-reviews .skeleton")).toHaveLength(1);
    expect($("#panel-reviews .empty").hidden).toBe(true);
    expect($("#updated").textContent).toBe("Updating…");
    expect($("#count-reviews").textContent).toBe("");
  });

  it("says when nothing's waiting, once the look is back even if it failed", async () => {
    answer = "fail";
    await start();
    expect($("#panel-reviews .empty").hidden).toBe(false);
    expect($("#updated").textContent).toBe("");
  });

  it.each([
    ["signed-out", "Sign in to GitHub in this browser to see your pull requests.", false],
    ["unreadable", "GitHub’s pages didn’t read as expected, so the lists may be out of date.", true],
  ] as const)("puts a %s problem in place of the lists", async (problem, text, retry) => {
    await inboxItem.setValue(inbox({ problem }));
    await start();
    expect($("#problem").hidden).toBe(false);
    expect($("#notice").hidden).toBe(true);
    expect($("#problem-text").textContent).toBe(text);
    expect($("#problem-link").hidden).toBe(retry);
    expect($("#problem-retry").hidden).toBe(!retry);
    expect($("#panel-reviews").classList.contains("blocked")).toBe(true);
    expect($("#updated").textContent).toBe("");
    sent = [];
    $("#problem-retry").click();
    expect(sent).toContainEqual({ type: "inbox-refresh" });
  });

  it("keeps the earlier lists under a note when a look fails", async () => {
    await inboxItem.setValue(inbox({ problem: "offline", reviews: [pull()] }));
    await start();
    expect($("#problem").hidden).toBe(true);
    expect($("#notice").hidden).toBe(false);
    expect($("#notice-text").textContent).toBe("GitHub can’t be reached right now, so the lists may be out of date.");
    expect($("#updated").textContent).toBe("Last updated 5m ago");
  });

  it("leaves out the repositories the reader doesn't want here", async () => {
    await popupItem.setValue({ repos: [], excludeRepos: ["acme/api"], teams: true });
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a" }), pull({ url: "b", repo: "acme/api" })] }));
    await start();
    expect($$("#panel-reviews .pull")).toHaveLength(1);
    await popupItem.setValue({ repos: [], excludeRepos: [], teams: true });
    await settle();
    expect($$("#panel-reviews .pull")).toHaveLength(2);
  });

  it("narrows a list to one repository with its chips", async () => {
    const animate = vi.spyOn(HTMLElement.prototype, "animate");
    await inboxItem.setValue(
      inbox({
        reviews: [
          pull({ url: "a", repo: "acme/web" }),
          pull({ url: "b", repo: "acme/api" }),
          pull({ url: "c", repo: "other/web", unread: true }),
          pull({ url: "d", repo: "acme/web", draft: true }),
        ],
      }),
    );
    await start();
    const chips = () => $$<HTMLButtonElement>("#panel-reviews .chip");
    expect(chips().map((chip) => chip.textContent)).toStrictEqual(["All3", "other/web1", "acme/web1", "api1"]);
    chips()[0]!.click();
    expect(animate).not.toHaveBeenCalled();
    chips()[3]!.click();
    expect(titles()).toHaveLength(1);
    expect($$("#panel-reviews .group.untitled")).toHaveLength(1);
    expect($$("#panel-reviews details")).toHaveLength(0);
    expect(document.activeElement).toBe(chips()[3]);
    expect(animate).toHaveBeenLastCalledWith(
      [expect.objectContaining({ transform: "translateX(24px)" }), expect.anything()],
      expect.anything(),
    );
    chips()[2]!.click();
    expect($$("#panel-reviews details")).toHaveLength(1);
    expect(animate).toHaveBeenLastCalledWith(
      [expect.objectContaining({ transform: "translateX(-24px)" }), expect.anything()],
      expect.anything(),
    );
    // A repository that's gone lets go of the narrowing.
    await inboxItem.setValue(
      inbox({ reviews: [pull({ url: "b", repo: "acme/api" }), pull({ url: "c", repo: "x/y" })] }),
    );
    await settle();
    expect(titles()).toHaveLength(2);
    expect(chips()[0]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("slides the chips' highlight to the one picked, and brings it out from under the fade", async () => {
    await inboxItem.setValue(
      inbox({ reviews: [pull({ url: "a", repo: "acme/web" }), pull({ url: "b", repo: "acme/api" })] }),
    );
    await start();
    const row = () => $("#panel-reviews .filters");
    const highlight = () => $("#panel-reviews .indicator");
    const lay = () => {
      $$("#panel-reviews .chip").forEach((chip, index) => {
        layout(chip, { offsetLeft: index * 100, offsetWidth: 90, offsetTop: 2, offsetHeight: 20 });
      });
      layout(row(), { clientWidth: 150 });
      layout(highlight(), { offsetHeight: 24 });
    };
    // Without a size yet, nothing to place.
    for (const callback of resized) callback();
    expect(highlight().style.width).toBe("");
    lay();
    for (const callback of resized) callback();
    expect(highlight().style.width).toBe("290px");
    expect(highlight().style.clipPath).toBe("inset(2px 200px 2px 0px round 8px)");
    expect(highlight().classList.contains("ready")).toBe(true);
    // Drawn again with another chip picked, the highlight starts where it was.
    const before = highlight().style.clipPath;
    $$<HTMLButtonElement>("#panel-reviews .chip")[2]!.click();
    expect(highlight().style.clipPath).toBe(before);
    lay();
    await settle();
    expect(row().scrollLeft).toBe(200 - 56);
    expect(highlight().style.clipPath).toBe("inset(2px 0px 2px 200px round 8px)");
    expect(highlight().classList.contains("ready")).toBe(true);
    // A chip that fits leaves the row where it starts.
    $$<HTMLButtonElement>("#panel-reviews .chip")[0]!.click();
    lay();
    layout(row(), { clientWidth: 1000 });
    await settle();
    expect(row().scrollLeft).toBe(0);
  });

  it("names a repository whole when two owners have one by its name", async () => {
    await inboxItem.setValue(
      inbox({
        reviews: [
          pull({ url: "a", repo: "acme/web", updatedAt: "2026-10-25T00:00:00Z" }),
          pull({ url: "a2", repo: "acme/web", updatedAt: "2026-10-01T00:00:00Z" }),
          pull({ url: "b", repo: "other/web", updatedAt: "2026-10-26T00:00:00Z" }),
        ],
      }),
    );
    await start();
    expect($$("#panel-reviews .chip-label").map((label) => label.textContent)).toStrictEqual([
      "All",
      "other/web",
      "acme/web",
    ]);
  });

  it("marks the picked pull requests done, and takes them back with Undo", async () => {
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a", title: "A" }), pull({ url: "b", title: "B" })] }));
    await start();
    const box = (url: string) =>
      $<HTMLInputElement>(`#panel-reviews a[href='${url}/changes']`).parentElement!.querySelector<HTMLInputElement>(
        ".pick",
      )!;
    box("a").click();
    expect(box("a").closest(".row")!.classList.contains("picked")).toBe(true);
    expect($("#selection").hidden).toBe(false);
    expect($("#updated").hidden).toBe(true);
    expect($("#selection-text").textContent).toContain("1");
    expect($("#panel-reviews").classList.contains("selecting")).toBe(true);
    box("b").click();
    box("b").click();
    expect(box("b").closest(".row")!.classList.contains("picked")).toBe(false);
    $("#mark-done").click();
    expect(titles()).toStrictEqual(["B"]);
    expect(await doneItem.getValue()).toStrictEqual({ a: "2026-10-26T09:00:00Z" });
    expect($("#undo-done").hidden).toBe(false);
    expect($("#mark-done").hidden).toBe(true);
    const done = $<HTMLDetailsElement>("#panel-reviews details");
    expect(done.querySelector("summary")?.textContent).toBe("Done1");
    $("#undo-done").click();
    expect(titles()).toStrictEqual(["A", "B"]);
    expect(await doneItem.getValue()).toStrictEqual({});
    expect($("#selection").hidden).toBe(true);
    // Undo stays a few seconds, then goes.
    box("a").click();
    $("#mark-done").click();
    vi.advanceTimersByTime(6000);
    expect($("#selection").hidden).toBe(true);
  });

  it("takes back one marked done from the Done section", async () => {
    await doneItem.setValue({ a: "2026-10-26T09:00:00Z" });
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a", title: "A" })] }));
    await start();
    const restore = $<HTMLButtonElement>("#panel-reviews .restore");
    expect(restore.getAttribute("aria-label")).toBe("Not done: “A”");
    restore.click();
    expect(titles()).toStrictEqual(["A"]);
    // Marked elsewhere, it goes here too.
    await doneItem.setValue({ a: "2026-10-26T09:00:00Z" });
    await settle();
    expect(titles()).toStrictEqual([]);
  });

  it("lets go of the picks with Clear, and of picks that left the list", async () => {
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a" })] }));
    await start();
    $<HTMLInputElement>("#panel-reviews .pick").click();
    $("#selection-clear").click();
    expect($<HTMLInputElement>("#panel-reviews .pick").checked).toBe(false);
    expect($("#selection").hidden).toBe(true);
    $<HTMLInputElement>("#panel-reviews .pick").click();
    // Drawn again, what's picked stays picked.
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a" }), pull({ url: "a2" })] }));
    await settle();
    expect($$("#panel-reviews .row.picked")).toHaveLength(1);
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "b" })] }));
    await settle();
    expect($("#panel-reviews").classList.contains("selecting")).toBe(true);
    $<HTMLInputElement>("#panel-reviews .pick").click();
    $<HTMLInputElement>("#panel-reviews .pick").click();
    expect($("#panel-reviews").classList.contains("selecting")).toBe(false);
  });

  it("works the rows from the keyboard", async () => {
    // Rows on screen have somewhere to be laid out in.
    Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get: () => document.body });
    await inboxItem.setValue(
      inbox({
        reviews: [pull({ url: "a", title: "A" }), pull({ url: "b", title: "B" }), pull({ url: "c", title: "C" })],
      }),
    );
    await start();
    const links = () => $$("#panel-reviews a.pull");
    links()[0]!.focus();
    expect(press(links()[0]!, "ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(links()[1]);
    press(links()[1]!, "End");
    expect(document.activeElement).toBe(links()[2]);
    press(links()[2]!, "ArrowDown");
    expect(document.activeElement).toBe(links()[2]);
    press(links()[2]!, "Home");
    expect(document.activeElement).toBe(links()[0]);
    press(links()[0]!, "ArrowUp");
    expect(document.activeElement).toBe(links()[0]);
    expect(press(links()[0]!, "Enter").defaultPrevented).toBe(false);
    expect(press(links()[0]!, "Escape").defaultPrevented).toBe(false);
    expect(press(links()[0]!, "x").defaultPrevented).toBe(true);
    expect($<HTMLInputElement>("#panel-reviews .pick").checked).toBe(true);
    expect(press(links()[0]!, "Escape").defaultPrevented).toBe(true);
    expect($("#selection").hidden).toBe(true);
    // Keys elsewhere are left alone.
    expect(press($("#panel-reviews .see-all"), "ArrowDown").defaultPrevented).toBe(false);
    const text = document.createTextNode("");
    $("main").append(text);
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
  });

  it("doesn't move when no row is on screen", async () => {
    await inboxItem.setValue(inbox({ reviews: [pull()] }));
    await start();
    expect(press($("#panel-reviews a.pull"), "ArrowDown").defaultPrevented).toBe(false);
  });

  it("switches lists with the tabs, and remembers the last one", async () => {
    const animate = vi.spyOn(HTMLElement.prototype, "animate");
    await start();
    const [reviews, mine] = [$("#tab-reviews"), $("#tab-mine")];
    layout(reviews, { offsetLeft: 0, offsetWidth: 80 });
    layout(mine, { offsetLeft: 80, offsetWidth: 60 });
    mine.click();
    expect(mine.getAttribute("aria-selected")).toBe("true");
    expect($("#panel-mine").hidden).toBe(false);
    expect($("#panel-reviews").hidden).toBe(true);
    expect(localStorage.getItem("focus-diff:popup-tab")).toBe("mine");
    const indicator = $(".tab-indicator");
    expect(indicator.style.getPropertyValue("--left")).toBe("80px");
    await settle();
    expect(indicator.classList.contains("ready")).toBe(true);
    mine.click();
    expect(animate).toHaveBeenCalledTimes(1);
    press(mine, "ArrowLeft");
    expect(document.activeElement).toBe(reviews);
    press(reviews, "ArrowLeft");
    expect(document.activeElement).toBe(mine);
    press(mine, "Home");
    expect(document.activeElement).toBe(reviews);
    press(reviews, "End");
    expect(document.activeElement).toBe(mine);
    press(mine, "ArrowRight");
    expect(document.activeElement).toBe(reviews);
    expect(press(reviews, "a").defaultPrevented).toBe(false);
    // With reduced motion, a list only fades in.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.documentElement.style.setProperty("--ease", "linear");
    mine.click();
    expect(animate).toHaveBeenLastCalledWith([expect.objectContaining({ transform: "none" }), expect.anything()], {
      duration: 120,
      easing: "linear",
    });
  });

  it("opens on the list it was on", async () => {
    localStorage.setItem("focus-diff:popup-tab", "mine");
    await start();
    expect($("#tab-mine").getAttribute("aria-selected")).toBe("true");
  });

  it("goes on without remembering the tab when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await start();
    $("#tab-mine").click();
    expect($("#tab-mine").getAttribute("aria-selected")).toBe("true");
  });

  it("unfolds a folded section, and folds it back", async () => {
    const animate = vi.spyOn(HTMLElement.prototype, "animate");
    const scrollTo = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a" }), pull({ url: "d", draft: true })] }));
    await start();
    const section = $<HTMLDetailsElement>("#panel-reviews details");
    const summary = section.querySelector("summary")!;
    summary.click();
    expect(section.open).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(animate).toHaveBeenCalledTimes(1);
    section.dispatchEvent(new Event("toggle"));
    // Drawn again, it stays open.
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a" }), pull({ url: "d", draft: true, title: "New" })] }));
    await settle();
    const again = $<HTMLDetailsElement>("#panel-reviews details");
    expect(again.open).toBe(true);
    again.querySelector("summary")!.click();
    expect(again.open).toBe(true);
    for (const animation of again.querySelector(".fold-body")!.getAnimations()) animation.finish();
    expect(again.open).toBe(false);
    // With reduced motion, at once.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    animate.mockClear();
    again.querySelector("summary")!.click();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
    again.querySelector("summary")!.click();
    expect(again.open).toBe(false);
    expect(animate).not.toHaveBeenCalled();
    // Outside a scrolling list, nothing to scroll.
    scrollTo.mockClear();
    again.closest(".scroll")!.classList.remove("scroll");
    again.querySelector("summary")!.click();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("opens a pull request in a tab behind the popup", async () => {
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "https://github.com/a/b/pull/1", unread: true })] }));
    await start();
    const link = $("#panel-reviews a.pull");
    link.click();
    expect(fakeBrowser.tabs.create).toHaveBeenCalledWith({
      url: "https://github.com/a/b/pull/1/changes",
      active: false,
    });
    expect(link.classList.contains("unread")).toBe(false);
    vi.mocked(fakeBrowser.tabs.create).mockClear();
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 1 }));
    $("#settings").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("click"));
    expect(fakeBrowser.tabs.create).not.toHaveBeenCalled();
  });

  it("opens one of review time's with its filters on", async () => {
    await start();
    const link = Object.assign(document.createElement("a"), { target: "_blank", href: "https://x" });
    Object.assign(link.dataset, { repo: "acme/web", url: "https://github.com/acme/web/pull/1" });
    document.body.append(link);
    link.click();
    expect(sent).toContainEqual({
      type: "review-open",
      url: "https://github.com/acme/web/pull/1",
      repo: "acme/web",
    });
    expect(fakeBrowser.tabs.create).not.toHaveBeenCalled();
  });

  it("opens settings, and the notifications' from the footer", async () => {
    await notifyItem.setValue({ ...DEFAULT_NOTIFY, enabled: true });
    await start();
    expect($("#notify-setup").textContent).toBe("Notifications on");
    expect($("#notify-setup").classList.contains("on")).toBe(true);
    $("#settings").click();
    await settle();
    expect(sent).toContainEqual({ type: "open-options", section: undefined });
    expect(window.close).toHaveBeenCalled();
    $("#notify-setup").click();
    await settle();
    expect(sent).toContainEqual({ type: "open-options", section: "notifications" });
    await notifyItem.setValue({ ...DEFAULT_NOTIFY, enabled: false });
    await settle();
    expect($("#notify-setup").textContent).toBe("Turn on notifications");
  });

  it("shows review time on asking to review now, and puts it away", async () => {
    await heldItem.setValue([held("review"), held("end")]);
    await doneItem.setValue({ b: "2026-10-26T09:00:00Z" });
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a" }), pull({ url: "b" })] }));
    await start();
    const clock = $("#review-now");
    const card = $("#review-card");
    expect(card.hidden).toBe(true);
    expect(clock.dataset.count).toBe("1");
    expect(clock.getAttribute("aria-label")).toContain("1");
    vi.mocked(renderReviewPanel).mockImplementation((target) => {
      target.replaceChildren(h("button", { "aria-pressed": "true" }));
    });
    clock.click();
    expect(card.hidden).toBe(false);
    expect(clock.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(card.querySelector("button"));
    const [, state, options] = vi.mocked(renderReviewPanel).mock.lastCall!;
    expect([...state.waiting]).toStrictEqual(["a"]);
    // What the card asks of the popup.
    expect(options.avatar("bo").textContent).toBe("B");
    options.openOptions("review-time");
    await settle();
    expect(sent).toContainEqual({ type: "open-options", section: "review-time" });
    options.skip(123);
    await settle();
    expect(await reviewSkipItem.getValue()).toBe(123);
    // Keys other than Escape stay on the card.
    expect(press(card, "a").defaultPrevented).toBe(false);
    expect(press(card, "Escape").defaultPrevented).toBe(true);
    expect(card.hidden).toBe(true);
    expect(document.activeElement).toBe(clock);
    expect(press(card, "Escape").defaultPrevented).toBe(false);
    clock.click();
    options.close();
    expect(card.hidden).toBe(true);
    clock.click();
    clock.click();
    expect(card.hidden).toBe(true);
    await heldItem.setValue([]);
    await settle();
    expect(clock.dataset.count).toBe("");
    expect(clock.getAttribute("aria-label")).toBe("Review now");
  });

  it("shows a review time under way, its minutes going down", async () => {
    const run: ReviewRun = {
      session: "",
      name: "Now",
      minutes: 30,
      offeredAt: NOW,
      startedAt: null,
      pulls: [],
      left: 0,
      overBy: 0,
      filters: [],
    };
    await reviewRunItem.setValue(run);
    await start();
    expect($("#review-card").hidden).toBe(false);
    expect($("#review-now").hidden).toBe(true);
    const calls = vi.mocked(renderReviewPanel).mock.calls.length;
    vi.advanceTimersByTime(20_000);
    expect(vi.mocked(renderReviewPanel).mock.calls).toHaveLength(calls);
    await reviewRunItem.setValue({ ...run, startedAt: NOW });
    await settle();
    const started = vi.mocked(renderReviewPanel).mock.calls.length;
    vi.advanceTimersByTime(20_000);
    expect(vi.mocked(renderReviewPanel).mock.calls).toHaveLength(started + 1);
    expect(press($("#review-card"), "Escape").defaultPrevented).toBe(false);
  });

  it("gives an author's picture a second address, then their initial", async () => {
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a", author: "ana" })] }));
    await start();
    const images = () => $$<HTMLImageElement>("#panel-reviews .avatar img");
    const [image] = images();
    image!.dispatchEvent(new Event("error"));
    expect(image!.src).toBe("https://github.com/ana.png?size=48");
    expect(image!.isConnected).toBe(true);
    image!.dispatchEvent(new Event("error"));
    expect(image!.isConnected).toBe(false);
    // Drawn again, they keep their initial.
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "c", author: "ana" })] }));
    await settle();
    expect(images()).toHaveLength(0);
    expect($("#panel-reviews .avatar").textContent).toBe("A");
  });

  it("loads a picture once, copying it while it's on screen", async () => {
    const shown = () => $<HTMLImageElement>("#panel-reviews .avatar img");
    const draw = async (url: string, author: string) => {
      await inboxItem.setValue(inbox({ reviews: [pull({ url, author })] }));
      await settle();
    };
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a", author: "bo" })] }));
    await start();
    const image = shown();
    await draw("b", "bo");
    expect(shown()).not.toBe(image);
    expect(shown().src).toBe(image.src);
    await draw("c", "cy");
    await draw("d", "bo");
    expect(shown()).toBe(image);
    // One that failed while off the page has no error left to fire.
    await draw("e", "cy");
    layout(image, { complete: true, naturalWidth: 0 });
    await draw("f", "bo");
    expect($$("#panel-reviews .avatar img")).toHaveLength(0);
  });

  it("gives each of an author's rows drawn together a picture of its own", async () => {
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "a", author: "bo" }), pull({ url: "b", author: "bo" })] }));
    await start();
    const images = $$<HTMLImageElement>("#panel-reviews .avatar img");
    expect(images).toHaveLength(2);
    expect(images[0]).not.toBe(images[1]);
    // The copy has the same fallback as the first.
    images[1]!.dispatchEvent(new Event("error"));
    expect(images[1]!.src).toBe("https://github.com/bo.png?size=48");
  });

  it("leaves the rows alone when a look finds the same", async () => {
    await inboxItem.setValue(inbox({ reviews: [pull()] }));
    await start();
    const row = $("#panel-reviews a.pull");
    await inboxItem.setValue(inbox({ reviews: [pull()], checkedAt: NOW }));
    await settle();
    expect($("#panel-reviews a.pull")).toBe(row);
  });

  it("estimates again once a pull request's files are read, and a pace learned", async () => {
    await inboxItem.setValue(inbox({ reviews: [pull({ url: "big" })] }));
    await start();
    expect($$(".pull-estimate")).toHaveLength(0);
    await pullFilesItem.setValue({ big: { sha: "abc", files: [["a.ts", 40, 0, false]] } });
    await settle();
    expect($$(".pull-estimate")).toHaveLength(1);
    await learnedItem.setValue(normalizeLearned({}));
    await settle();
    await pullFilesItem.setValue({});
    await settle();
    expect($$(".pull-estimate")).toHaveLength(0);
  });
});
