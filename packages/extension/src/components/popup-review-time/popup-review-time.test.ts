// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { HeldEvent } from "@/utils/inbox/inbox";
import type { Message } from "@/utils/messages/messages";
import {
  DEFAULT_REVIEW_TIME,
  newSession,
  type ReviewRun,
  type ReviewSession,
  type ReviewTimeSettings,
  type RunPull,
} from "@/utils/review-sessions/review-sessions";

import type { ReviewState } from "./popup-review-time";

const NOW = new Date(2026, 9, 7, 10, 0).getTime();

const pull = (number: number, extra: Partial<RunPull> = {}): RunPull => ({
  url: `https://github.com/acme/app/pull/${number}`,
  repo: "acme/app",
  number,
  title: `Pull ${number}`,
  author: "octocat",
  minutes: 10,
  files: 3,
  ...extra,
});

const run = (extra: Partial<ReviewRun> = {}): ReviewRun => ({
  session: "",
  name: "Morning review",
  minutes: 30,
  offeredAt: NOW,
  startedAt: null,
  pulls: [pull(1), pull(2)],
  left: 0,
  overBy: 0,
  filters: [],
  ...extra,
});

const session = (extra: Partial<ReviewSession> = {}): ReviewSession => ({ ...newSession(), id: "s1", ...extra });

const settings = (extra: Partial<ReviewTimeSettings> = {}): ReviewTimeSettings => ({
  ...DEFAULT_REVIEW_TIME,
  ...extra,
});

const held = (extra: Partial<HeldEvent> = {}): HeldEvent =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields the card shows matter here.
  ({
    url: "https://github.com/acme/app/pull/9",
    title: "Held one",
    repo: "acme/app",
    number: 9,
    actor: "hubot",
    until: "review",
    heldAt: NOW,
    ...extra,
  }) as HeldEvent;

const state = (extra: Partial<ReviewState> = {}): ReviewState => ({
  settings: settings(),
  run: null,
  waiting: new Set(),
  held: [],
  skipUntil: 0,
  ...extra,
});

const sendMessage = () =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the browser's types end on the callback overload; the card uses the promise one.
  vi.spyOn(fakeBrowser.runtime, "sendMessage") as unknown as MockInstance<(message: Message) => Promise<unknown>>;

const panelOptions = () => ({
  avatar: vi.fn<(login: string) => HTMLElement>((login) =>
    Object.assign(document.createElement("img"), { alt: login }),
  ),
  openOptions: vi.fn<(section: string) => void>(),
  skip: vi.fn<(until: number) => void>(),
  close: vi.fn<() => void>(),
});

const mount = async (initial: ReviewState, reply: unknown = true) => {
  vi.resetModules();
  const { renderReviewPanel } = await import("./popup-review-time");
  const card = document.createElement("div");
  card.id = "review-card";
  document.body.replaceChildren(card);
  const sent: Message[] = [];
  sendMessage().mockImplementation((message: Message) => {
    sent.push(message);
    return Promise.resolve(reply);
  });
  const options = panelOptions();
  let current = initial;
  const render = () => {
    renderReviewPanel(card, current, options, render);
  };
  render();
  const update = (next: ReviewState) => {
    current = next;
    render();
  };
  const button = (text: string) =>
    [...card.querySelectorAll("button")].find((each) => each.textContent === text) ?? null;
  const text = (selector: string) => card.querySelector(selector)?.textContent;
  return { card, sent, options, update, render, button, text };
};

const flush = async (turns = 5): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  if (turns > 1) await flush(turns - 1);
};

describe("renderReviewPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubGlobal("Option", function Option(text: string, value: string) {
      return Object.assign(document.createElement("option"), { text, value });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("with a review time offered", () => {
    it("lists the pull requests picked, each with its estimate, to start, put off or skip", async () => {
      const { card, text, button, sent } = await mount(
        state({
          run: run({
            pulls: [pull(1), pull(2, { author: "", files: null, again: true }), pull(3, { files: 1 })],
            left: 2,
          }),
          waiting: new Set([pull(1).url, pull(2).url, pull(3).url]),
        }),
      );
      expect(text("h2")).toBe("Morning review");
      expect(text(".run-clock")).toBe("30 min set aside");
      expect(card.querySelector(".run-bar")).toBeNull();
      expect(text(".run-summary")).toBe("3 pull requests picked · about 30 min. 2 more didn’t fit.");
      const rows = [...card.querySelectorAll<HTMLAnchorElement>(".run-row a")];
      expect(rows.map((row) => row.getAttribute("href"))).toEqual([
        `${pull(1).url}/changes`,
        `${pull(2).url}/changes`,
        `${pull(3).url}/changes`,
      ]);
      expect(rows[0]?.querySelector("img")?.alt).toBe("octocat");
      expect(rows[0]?.querySelector(".repo-number")?.textContent).toBe("app#1");
      expect(rows[0]?.querySelector(".pull-author")?.textContent).toBe("octocat");
      expect(rows[0]?.querySelector(".pull-again")).toBeNull();
      expect(rows[0]?.querySelector(".pull-time")?.textContent).toBe("3 files");
      expect(rows[0]?.querySelector(".estimate")?.textContent).toBe("~10 min");
      expect(rows[1]?.querySelector(".pull-author")).toBeNull();
      expect(rows[1]?.querySelector(".pull-again")?.textContent).toBe("Re-review");
      expect(rows[1]?.querySelector(".pull-time")?.textContent).toBe("size unknown");
      expect(rows[2]?.querySelector(".pull-time")?.textContent).toBe("1 file");
      expect(card.querySelector(".reviewed")).toBeNull();

      button("Start")?.click();
      button("Later")?.click();
      button("Skip")?.click();
      await flush();
      expect(sent).toEqual([{ type: "review-start" }, { type: "review-snooze" }, { type: "review-skip" }]);
    });

    it("says when only one was picked", async () => {
      const { text } = await mount(state({ run: run({ pulls: [pull(1)] }), waiting: new Set([pull(1).url]) }));
      expect(text(".run-summary")).toBe("1 pull request picked · about 10 min.");
    });

    it("says when the one picked takes longer than the time set aside", async () => {
      const { text } = await mount(state({ run: run({ pulls: [pull(1, { minutes: 45 })], overBy: 15 }) }));
      expect(text(".run-over")).toBe("The one picked takes about 45 min, 15 min more than the 30 min set aside.");
    });

    it("with nothing picked, only offers to put it away", async () => {
      const { text, button, sent, card } = await mount(state({ run: run({ pulls: [], overBy: 5 }) }));
      expect(text(".run-summary")).toBe("Nothing’s waiting for your review.");
      expect(text(".run-over")).toBe("The one picked takes about 0 min, 5 min more than the 30 min set aside.");
      expect(button("Start")).toBeNull();
      expect(card.querySelector(".pulls")?.childElementCount).toBe(0);
      button("Done")?.click();
      await flush();
      expect(sent).toEqual([{ type: "review-skip" }]);
    });
  });

  describe("with a review time under way", () => {
    const started = (extra: Partial<ReviewRun> = {}) => run({ startedAt: NOW - 6 * 60_000, ...extra });

    it("shows the time left, how far along, and which are reviewed", async () => {
      const { card, text, button, sent } = await mount(
        state({ run: started({ pulls: [pull(1), pull(2)] }), waiting: new Set([pull(2).url]) }),
      );
      expect(text(".run-clock")).toBe("24 min left");
      const bar = card.querySelector(".run-bar")!;
      expect(bar.getAttribute("aria-valuenow")).toBe("20");
      expect(bar.getAttribute("aria-label")).toBe("Time used");
      expect(bar.getAttribute("aria-valuetext")).toMatch(/^Ends at /u);
      expect(card.querySelector<HTMLElement>(".run-bar span")?.style.getPropertyValue("--done")).toBe("20%");
      expect(text(".run-summary")).toBe("1 of 2 reviewed · about 20 min planned.");
      const [first, second] = card.querySelectorAll(".run-row a");
      expect(first?.classList.contains("reviewed")).toBe(true);
      expect(first?.querySelector(".done-mark")).not.toBeNull();
      expect(first?.querySelector(".visually-hidden")?.textContent).toBe("Reviewed");
      expect(second?.classList.contains("reviewed")).toBe(false);
      expect(second?.querySelector(".visually-hidden")).toBeNull();

      button("End now")?.click();
      await flush();
      expect(sent).toEqual([{ type: "review-end" }]);
    });

    it("says how many of one were reviewed", async () => {
      const { text } = await mount(state({ run: started({ pulls: [pull(1)] }), waiting: new Set([pull(1).url]) }));
      expect(text(".run-summary")).toBe("0 of 1 reviewed · about 10 min planned.");
    });

    it("ticks the minutes in place as they go by, and stops at the end", async () => {
      const { card, render, text } = await mount(state({ run: started(), waiting: new Set() }));
      const heading = card.querySelector("h2");
      vi.setSystemTime(NOW + 9 * 60_000);
      render();
      expect(card.querySelector("h2")).toBe(heading);
      expect(text(".run-clock")).toBe("15 min left");
      expect(card.querySelector(".run-bar")?.getAttribute("aria-valuenow")).toBe("50");
      expect(card.querySelector<HTMLElement>(".run-bar span")?.style.getPropertyValue("--done")).toBe("50%");
      vi.setSystemTime(NOW + 60 * 60_000);
      render();
      expect(text(".run-clock")).toBe("0 min left");
      expect(card.querySelector(".run-bar")?.getAttribute("aria-valuenow")).toBe("100");
    });

    it("ticks what is left of the card", async () => {
      const { card, render } = await mount(state({ run: started() }));
      card.querySelector(".run-clock")?.remove();
      card.querySelector(".run-bar")?.remove();
      vi.setSystemTime(NOW + 60_000);
      expect(() => {
        render();
      }).not.toThrow();
    });

    it("leaves one offered as it is while the minutes go by", async () => {
      const { card, render, text } = await mount(state({ run: run() }));
      const heading = card.querySelector("h2");
      vi.setSystemTime(NOW + 5 * 60_000);
      render();
      expect(card.querySelector("h2")).toBe(heading);
      expect(text(".run-clock")).toBe("30 min set aside");
    });

    it("draws again when something changes", async () => {
      const { card, update, text } = await mount(state({ run: started(), waiting: new Set([pull(1).url]) }));
      const heading = card.querySelector("h2");
      update(state({ run: started(), waiting: new Set() }));
      expect(card.querySelector("h2")).not.toBe(heading);
      expect(text(".run-summary")).toBe("2 of 2 reviewed · about 20 min planned.");
    });
  });

  describe("the updates kept for review time", () => {
    it("lists them under the card, with who did what", async () => {
      const { card } = await mount(
        state({ held: [held(), held({ url: "https://github.com/acme/app/pull/10", number: 10, actor: "" })] }),
      );
      expect(card.querySelector(".held .group-count")?.textContent).toBe("2");
      expect(card.querySelector(".held h2")?.textContent).toBe("Kept for review time2");
      const links = [...card.querySelectorAll<HTMLAnchorElement>(".held-link")];
      expect(links.map((link) => link.querySelector(".pull-meta")?.textContent)).toEqual([
        "acme/app#9 · hubot",
        "acme/app#10",
      ]);
      expect(links[0]?.href).toBe("https://github.com/acme/app/pull/9");
    });

    it("lists them under a review time too", async () => {
      const { card } = await mount(state({ run: run(), held: [held()] }));
      expect(card.querySelectorAll(".held-link")).toHaveLength(1);
    });

    it("shows nothing for them when there are none", async () => {
      const { card } = await mount(state());
      expect(card.querySelector(".held")).toBeNull();
    });
  });

  describe("with none under way", () => {
    it("asks how long the reader has, and starts one now", async () => {
      const { card, button, sent, options, text } = await mount(state(), true);
      expect(text("h2")).toBe("Review now");
      const pressed = () => card.querySelector('.minutes [aria-pressed="true"]')?.textContent;
      expect(pressed()).toBe("30 min");
      expect([...card.querySelectorAll(".minutes .chip")].map((chip) => chip.textContent)).toEqual([
        "15 min",
        "30 min",
        "45 min",
        "60 min",
        "90 min",
      ]);
      expect(card.querySelector("#review-like")).toBeNull();
      expect(card.querySelector(".run-next")).toBeNull();

      button("45 min")?.click();
      expect(pressed()).toBe("45 min");
      expect(document.activeElement?.textContent).toBe("45 min");

      button("Start")?.click();
      const busy = button("Picking pull requests…");
      expect(busy?.disabled).toBe(true);
      expect(busy?.getAttribute("aria-busy")).toBe("true");
      await flush();
      expect(sent).toEqual([{ type: "review-start-now", minutes: 45, session: "" }]);
      expect(button("Start")?.disabled).toBe(false);
      expect(text(".run-next")).toBeUndefined();
      expect(document.activeElement).toBe(card.querySelector("h2"));

      card.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click();
      expect(options.close).toHaveBeenCalledOnce();
      button("Set up review times")?.click();
      expect(options.openOptions).toHaveBeenCalledWith("review-time");
    });

    it("says so when nothing is waiting, and keeps the focus on Start", async () => {
      const { button, text, card } = await mount(state(), false);
      button("Start")?.click();
      await flush();
      expect(text(".run-next")).toBe("Nothing’s waiting for your review.");
      expect(document.activeElement).toBe(card.querySelector(".button"));
    });

    it("says nothing is waiting when the message can't be sent", async () => {
      vi.resetModules();
      const { renderReviewPanel } = await import("./popup-review-time");
      const card = document.createElement("div");
      card.id = "review-card";
      document.body.replaceChildren(card);
      sendMessage().mockRejectedValue(new Error("No listener"));
      const options = panelOptions();
      const render = () => {
        renderReviewPanel(card, state(), options, render);
      };
      render();
      [...card.querySelectorAll("button")].find((each) => each.textContent === "Start")?.click();
      await flush();
      expect(card.querySelector(".run-next")?.textContent).toBe("Nothing’s waiting for your review.");
    });

    it("leaves the form as it is when nothing changed", async () => {
      const { card, render } = await mount(state());
      const heading = card.querySelector("h2");
      render();
      expect(card.querySelector("h2")).toBe(heading);
    });

    it("starts one like one of the reader's review times, taking its length", async () => {
      const sessions = [session({ id: "a", name: "Afternoon", minutes: 60 }), session({ id: "b", name: "" })];
      const { card, button, sent } = await mount(state({ settings: settings({ sessions }) }));
      const like = () => card.querySelector<HTMLSelectElement>("#review-like")!;
      expect([...like().options].map((option) => option.text)).toEqual(["the defaults", "Afternoon", "Review time"]);
      expect(card.querySelector("label")?.htmlFor).toBe("review-like");
      like().value = "a";
      like().dispatchEvent(new Event("change"));
      expect(like().value).toBe("a");
      expect(document.activeElement).toBe(like());
      expect(card.querySelector('.minutes [aria-pressed="true"]')?.textContent).toBe("60 min");
      like().value = "";
      like().dispatchEvent(new Event("change"));
      expect(card.querySelector('.minutes [aria-pressed="true"]')?.textContent).toBe("60 min");
      like().value = "a";
      like().dispatchEvent(new Event("change"));
      button("Start")?.click();
      await flush();
      expect(sent).toEqual([{ type: "review-start-now", minutes: 60, session: "a" }]);
    });

    describe("with review times on", () => {
      const on = (sessions: ReviewSession[]) => settings({ enabled: true, sessions });

      it("says when the next one is, and skips it or the rest of today", async () => {
        const { text, button, options } = await mount(
          state({ settings: on([session({ name: "Afternoon", times: ["15:00", "17:00"] })]) }),
        );
        expect(button("Review time settings")).not.toBeNull();
        expect(text(".run-next span")).toMatch(/^Next: .+ · Afternoon · 30 min$/u);
        button("Skip it")?.click();
        expect(options.skip).toHaveBeenCalledWith(new Date(2026, 9, 7, 15, 0).getTime() + 1);
        button("Skip the rest of today")?.click();
        expect(options.skip).toHaveBeenLastCalledWith(new Date(2026, 9, 8).getTime());
      });

      it("only offers to skip the next one when it's the last today", async () => {
        const { text, button } = await mount(state({ settings: on([session({ name: "" })]) }));
        expect(text(".run-next span")).toMatch(/· Review time · 30 min$/u);
        expect(button("Skip it")).not.toBeNull();
        expect(button("Skip the rest of today")).toBeNull();
      });

      it("says until when review times are skipped, and resumes them", async () => {
        const skipUntil = new Date(2026, 9, 8).getTime();
        const { text, button, options } = await mount(state({ settings: on([session()]), skipUntil }));
        expect(text(".run-next span")).toMatch(/^Skipping until .+\.$/u);
        button("Resume")?.click();
        expect(options.skip).toHaveBeenCalledWith(0);
      });

      it("says they're skipped when none comes after", async () => {
        const { text } = await mount(state({ settings: on([]), skipUntil: NOW + 60_000 }));
        expect(text(".run-next span")).toBe("Review times are skipped for now.");
      });

      it("says nothing of the next one when there is none", async () => {
        const { card } = await mount(state({ settings: on([]) }));
        expect(card.querySelector(".run-next")).toBeNull();
      });
    });
  });
});
