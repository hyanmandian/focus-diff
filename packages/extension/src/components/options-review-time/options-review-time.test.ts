// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import page from "@/entrypoints/options/index.html?raw";
import { normalize, type Config } from "@/utils/filters/filters";
import {
  newSession,
  normalizeReviewTime,
  type ReviewSession,
  type ReviewTimeSettings,
} from "@/utils/review-sessions/review-sessions";
import { learnedItem } from "@/utils/storage/storage";

// Its names are read in the reader's language as it loads, once the fake browser speaks it.
const load = () => import("./options-review-time");

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the element the selector finds.
const $ = <T extends HTMLElement = HTMLInputElement>(selector: string, root: ParentNode = document): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`No ${selector}`);
  return found;
};
const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
const fire = (element: HTMLElement, type: string) => element.dispatchEvent(new Event(type, { bubbles: true }));
const pick = (input: HTMLInputElement | HTMLSelectElement, value: string | boolean) => {
  if (typeof value === "boolean" && input instanceof HTMLInputElement) input.checked = value;
  else input.value = String(value);
  fire(input, "change");
};
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve);
  });
const pressed = (root: ParentNode) => all('[aria-pressed="true"]', root).map((chip) => chip.textContent);

/** A Wednesday, 10:00 local. */
const NOW = new Date(2026, 9, 21, 10).getTime();

const session = (extra: Partial<ReviewSession> = {}): ReviewSession => ({ ...newSession(), id: "a", ...extra });

const setUp = async (saved: Partial<ReviewTimeSettings> = {}, config: Config = normalize({})) => {
  const { createReviewTime } = await load();
  const onChange = vi.fn<() => void>();
  const say = vi.fn<(text: string, tone: "error") => void>();
  const onEnabled = vi.fn<(on: boolean) => void>();
  let filters = config;
  const reviewTime = createReviewTime({ onChange, say, config: () => filters, onEnabled });
  reviewTime.render(normalizeReviewTime({ enabled: true, sessions: [session()], ...saved }));
  await settle();
  return {
    reviewTime,
    onChange,
    onEnabled,
    setConfig: (next: Config) => {
      filters = next;
    },
  };
};
const card = (index = 0) => all(".session")[index]!;
const expand = (index = 0) => {
  $<HTMLButtonElement>(".session-expand", card(index)).click();
  return card(index);
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  document.body.innerHTML = /<body>([\s\S]*)<script/u.exec(page)![1]!;
  // happy-dom has no Option constructor.
  vi.stubGlobal("Option", function makeOption(label: string, value: string) {
    const option = document.createElement("option");
    option.textContent = label;
    option.value = value;
    return option;
  });
  Object.assign(fakeBrowser.runtime, { getManifest: () => ({ optional_permissions: ["notifications"] }) });
  // The callback overloads hide the promise ones from vi.spyOn.
  Object.assign(fakeBrowser.permissions, {
    contains: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    request: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the section", () => {
  it("shows the settings saved", async () => {
    await setUp({
      pace: "careful",
      perPull: 5,
      opens: "all",
      snooze: 15,
      learn: false,
      remindEnd: false,
      sound: { id: "chime", volume: 30 },
    });
    expect($("#review-on").checked).toBe(true);
    expect($("#review-body").hidden).toBe(false);
    expect($('#pace input[value="careful"]').checked).toBe(true);
    expect($('#pace input[value="steady"]').checked).toBe(false);
    expect($("#pace-hint").textContent).toContain("About 500 changed lines an hour");
    expect($<HTMLSelectElement>("#review-per-pull").value).toBe("5");
    expect($<HTMLSelectElement>("#review-per-pull").options[0]?.textContent).toBe("None");
    expect($<HTMLSelectElement>("#review-opens").value).toBe("all");
    expect($<HTMLSelectElement>("#review-snooze").value).toBe("15");
    expect($("#review-learn").checked).toBe(false);
    expect($("#learned").hidden).toBe(true);
    expect($("#review-remind-end").checked).toBe(false);
    expect($("#review-filters").checked).toBe(true);
    expect($<HTMLSelectElement>("#review-sound-choice").value).toBe("chime");
    expect($("#add-session").hidden).toBe(false);
  });

  it("says when the next review time is, and that there is one", async () => {
    const { onEnabled } = await setUp();
    expect($("#review-on-hint").textContent).toBe("Next: Wednesday 3:00 PM, “Review time” for 30 min.");
    expect(onEnabled).toHaveBeenLastCalledWith(true);
  });

  it("names the next one by its own name", async () => {
    await setUp({ sessions: [session({ name: "Backend" })] });
    expect($("#review-on-hint").textContent).toContain("“Backend”");
  });

  it("says so when none is coming, or review time is off", async () => {
    const { onEnabled } = await setUp({ sessions: [session({ on: false })] });
    expect($("#review-on-hint").textContent).toBe("No review time is on. Turn one on, or give it a day and a time.");
    expect(onEnabled).toHaveBeenLastCalledWith(false);
    await setUp({ enabled: false });
    expect($("#review-on-hint").textContent).toContain("Pick when and for how long");
    expect($("#review-body").hidden).toBe(true);
  });

  it("starts with one review time, open, when turned on with none", async () => {
    const { reviewTime, onChange } = await setUp({ enabled: false, sessions: [] });
    pick($("#review-on"), true);
    await settle();
    expect($("#review-body").hidden).toBe(false);
    expect(all(".session")).toHaveLength(1);
    expect($(".session-body", card()).hidden).toBe(false);
    expect(reviewTime.value()).toMatchObject({ enabled: true, sessions: [{ minutes: 30 }] });
    expect(onChange).toHaveBeenCalled();
  });

  it("keeps the review times it has when turned on, and hides them when turned off", async () => {
    const { reviewTime } = await setUp({ enabled: false });
    pick($("#review-on"), true);
    await settle();
    expect(reviewTime.value().sessions.map((each) => each.id)).toEqual(["a"]);
    pick($("#review-on"), false);
    await settle();
    expect($("#review-body").hidden).toBe(true);
    expect(reviewTime.value().enabled).toBe(false);
  });

  it("adds review times, open, up to ten", async () => {
    const { reviewTime } = await setUp({
      sessions: Array.from({ length: 8 }, (_, index) => session({ id: `s${index}` })),
    });
    $<HTMLButtonElement>("#add-session").click();
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
    expect(all(".session")).toHaveLength(9);
    expect($(".session-body", card(8)).hidden).toBe(false);
    expect(document.activeElement).toBe($(".session-name", card(8)));
    expect($("#add-session").hidden).toBe(false);
    $<HTMLButtonElement>("#add-session").click();
    expect($("#add-session").hidden).toBe(true);
    expect(reviewTime.value().sessions).toHaveLength(10);
  });

  it("hides the add button with ten already", async () => {
    await setUp({ sessions: Array.from({ length: 10 }, (_, index) => session({ id: `s${index}` })) });
    expect($("#add-session").hidden).toBe(true);
  });

  it("keeps how estimates are made and what happens when it's time", async () => {
    const { reviewTime, onChange } = await setUp();
    pick($('#pace input[value="quick"]'), true);
    expect($("#pace-hint").textContent).toContain("About 2000 changed lines");
    pick($("#review-per-pull"), "10");
    pick($("#review-opens"), "none");
    pick($("#review-opens"), "nonsense");
    pick($("#review-snooze"), "30");
    pick($("#review-learn"), false);
    expect($("#learned").hidden).toBe(true);
    pick($("#review-learn"), true);
    expect($("#learned").hidden).toBe(false);
    pick($("#review-hold"), true);
    expect(reviewTime.value()).toMatchObject({
      pace: "quick",
      perPull: 10,
      opens: "none",
      snooze: 30,
      learn: true,
      holdWhileReviewing: true,
    });
    expect(onChange).toHaveBeenCalledTimes(8);
  });

  it("is fine with whatever is wrong while turned off", async () => {
    const { reviewTime } = await setUp({ enabled: false, sessions: [session({ days: [] })] });
    expect(reviewTime.check()).toBe(true);
  });
});

describe("what was learned", () => {
  it("says nothing is yet", async () => {
    await setUp();
    expect($("#learned").textContent).toContain("Nothing learned yet");
  });

  it("says how the reader's pace differs per kind, and forgets it on request", async () => {
    await learnedItem.setValue({
      all: { actual: 40, expected: 40, files: 3 },
      kinds: {
        code: { actual: 30, expected: 10, files: 1 },
        tests: { actual: 0, expected: 10, files: 1 },
        docs: { actual: 10, expected: 10, files: 1 },
        styles: { actual: 0, expected: 0, files: 0 },
      },
    });
    await setUp();
    expect($(".learned-title").textContent).toBe("Learned from 3 files you reviewed:");
    expect(all(".learned-list div").map((row) => row.textContent)).toEqual([
      "Tests50% faster than the starting pace",
      "Docsabout the starting pace",
      "Code100% slower than the starting pace",
    ]);
    $<HTMLButtonElement>("#learned button").click();
    await settle();
    expect(await learnedItem.getValue()).toBeNull();
    expect(document.activeElement).toBe($("#review-learn"));
    expect($("#learned").textContent).toContain("Nothing learned yet");
  });
});

describe("a review time's card", () => {
  it("is folded to its switch, name and when", async () => {
    await setUp();
    const head = card();
    expect($(".session-summary", head).textContent).toBe("Weekdays at 3:00 PM · 30 min");
    expect($(".session-body", head).hidden).toBe(true);
    expect($(".session-expand", head).getAttribute("aria-expanded")).toBe("false");
    expect($('[role="switch"]', head).getAttribute("aria-label")).toBe("“Review time” on");
    expect($(".session-expand", head).getAttribute("aria-label")).toBe("Edit “Review time”");
    expect($(".session-remove", head).title).toBe("Remove Review time");
  });

  it("unfolds and folds, staying unfolded when drawn again", async () => {
    const { reviewTime } = await setUp();
    expand();
    expect($(".session-body", card()).hidden).toBe(false);
    reviewTime.redraw();
    expect($(".session-body", card()).hidden).toBe(false);
    expand();
    expect($(".session-body", card()).hidden).toBe(true);
  });

  it("turns off, greyed out", async () => {
    const { reviewTime } = await setUp({ sessions: [session({ on: false })] });
    expect(card().classList.contains("off")).toBe(true);
    pick($('[role="switch"]', card()), true);
    expect(card().classList.contains("off")).toBe(false);
    expect(reviewTime.value().sessions[0]?.on).toBe(true);
  });

  it("takes a name, labelling its controls with it", async () => {
    const { reviewTime } = await setUp();
    const name = $(".session-name", card());
    name.value = "Backend";
    fire(name, "input");
    expect($(".session-expand", card()).getAttribute("aria-label")).toBe("Edit “Backend”");
    expect(reviewTime.value().sessions[0]?.name).toBe("Backend");
  });

  it("is removed, focusing the add button", async () => {
    const { reviewTime } = await setUp({ sessions: [session(), session({ id: "b" })] });
    expand();
    $<HTMLButtonElement>(".session-remove", card()).click();
    expect(all(".session")).toHaveLength(1);
    expect(document.activeElement).toBe($("#add-session"));
    expect(reviewTime.value().sessions.map((each) => each.id)).toEqual(["b"]);
  });
});

describe("when", () => {
  it("picks days, in the week's order", async () => {
    const { reviewTime } = await setUp();
    const days = all(".chips", expand())[0]!;
    expect(pressed(days)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(days.querySelector("button")?.getAttribute("aria-label")).toBe("Sunday");
    all("button", days)[0]!.click();
    all("button", days)[1]!.click();
    expect(reviewTime.value().sessions[0]?.days).toEqual([0, 2, 3, 4, 5]);
    expect($(".session-summary", card()).textContent).toContain("Sun, Tue, Wed, Thu, and Fri");
  });

  it("adds a time by its button or Enter, and removes one", async () => {
    const { reviewTime } = await setUp();
    const body = expand();
    const input = $("#session-a-time");
    const add = $<HTMLButtonElement>(".time-picker .btn", body);
    add.click();
    expect(document.activeElement).toBe(input);
    input.value = "09:00";
    add.click();
    input.value = "12:30";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(reviewTime.value().sessions[0]?.times).toEqual(["09:00", "15:00"]);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(input.value).toBe("");
    expect(all(".time-picker .repo-chip span", body).map((chip) => chip.textContent)).toEqual([
      "9:00 AM",
      "12:30 PM",
      "3:00 PM",
    ]);
    const remove = $<HTMLButtonElement>(".time-picker .chip-remove", body);
    expect(remove.getAttribute("aria-label")).toBe("Remove 9:00 AM");
    remove.click();
    expect(document.activeElement).toBe(input);
    expect(reviewTime.value().sessions[0]?.times).toEqual(["12:30", "15:00"]);
  });

  it("repeats every few hours between two times instead", async () => {
    const { reviewTime } = await setUp();
    const body = expand();
    expect($(".session-every", body).hidden).toBe(true);
    pick($("#session-a-repeat-every"), true);
    expect($(".session-times", body).hidden).toBe(true);
    expect($(".session-every", body).hidden).toBe(false);
    pick($("#session-a-every"), "3");
    pick($("#session-a-from"), "08:00");
    pick($("#session-a-to"), "");
    expect($("#session-a-to").value).toBe("18:00");
    expect(reviewTime.value().sessions[0]).toMatchObject({ repeat: "every", every: 3, from: "08:00", to: "18:00" });
    expect($(".session-summary", card()).textContent).toBe("Weekdays every 3 hours from 8:00 AM to 6:00 PM · 30 min");
  });
});

describe("how long", () => {
  it("picks a preset, keeping the focus on it", async () => {
    const { reviewTime } = await setUp();
    const presets = all(".chips", expand())[1]!;
    expect(pressed(presets)).toEqual(["30 min"]);
    all("button", presets)[3]!.click();
    expect(pressed(presets)).toEqual(["60 min"]);
    expect(document.activeElement?.textContent).toBe("60 min");
    expect($("#session-a-minutes").value).toBe("60");
    expect(reviewTime.value().sessions[0]?.minutes).toBe(60);
  });

  it("takes other minutes, within bounds, and keeps them on nonsense", async () => {
    const { reviewTime } = await setUp();
    const presets = all(".chips", expand())[1]!;
    const other = $("#session-a-minutes");
    pick(other, "999");
    expect(other.value).toBe("240");
    pick(other, "2");
    expect(other.value).toBe("5");
    pick(other, "abc");
    expect(other.value).toBe("5");
    pick(other, "20");
    expect(pressed(presets)).toEqual([]);
    expect(reviewTime.value().sessions[0]?.minutes).toBe(20);
  });

  it("picks the order", async () => {
    const { reviewTime } = await setUp();
    expand();
    expect($("#session-a-order-oldest").checked).toBe(true);
    pick($("#session-a-order-quickest"), true);
    expect(reviewTime.value().sessions[0]?.order).toBe("quickest");
  });
});

describe("what to review", () => {
  const config = normalize({
    global: [
      { id: "f1", name: "Backend", include: "server/" },
      { id: "f2", name: " ", include: "x" },
    ],
    repos: [{ repo: "a/b", filters: [{ id: "f3", name: "Docs", include: "docs/" }] }],
  });

  it("offers the named filters, letting go of ones since deleted", async () => {
    const { reviewTime } = await setUp({ sessions: [session({ filters: ["f3", "gone"] })] }, config);
    const chips = all(".chips", expand())[2]!;
    expect(all("button", chips).map((chip) => chip.textContent)).toEqual(["All files", "Backend", "Docs · a/b"]);
    expect(pressed(chips)).toEqual(["Docs · a/b"]);
    expect(reviewTime.value().sessions[0]?.filters).toEqual(["f3"]);
    expect(card().textContent).toContain("Only these filters’ files count");
  });

  it("picks filters, or all files, which press each other off", async () => {
    const { reviewTime } = await setUp({}, config);
    const chips = all(".chips", expand())[2]!;
    all("button", chips)[1]!.click();
    all("button", chips)[2]!.click();
    expect(pressed(chips)).toEqual(["Backend", "Docs · a/b"]);
    expect(document.activeElement?.textContent).toBe("Docs · a/b");
    all("button", chips)[1]!.click();
    expect(reviewTime.value().sessions[0]?.filters).toEqual(["f3"]);
    all("button", chips)[0]!.click();
    expect(pressed(chips)).toEqual(["All files"]);
    expect(reviewTime.value().sessions[0]?.filters).toEqual([]);
  });

  it("says what filters are for when there are none, and follows new ones when drawn again", async () => {
    const { reviewTime, setConfig } = await setUp();
    expect(card().textContent).toContain("With filters set up");
    setConfig(config);
    reviewTime.redraw();
    expect(all("button", all(".chips", card())[2])).toHaveLength(3);
  });

  it("takes drafts, and the repositories it's for and never", async () => {
    const { reviewTime } = await setUp();
    expand();
    pick($("#session-a-drafts"), true);
    for (const [id, repo] of [
      ["#session-a-repos", "a/b"],
      ["#session-a-excludeRepos", "c/*"],
    ] as const) {
      const input = $(id);
      input.value = repo;
      fire(input, "blur");
    }
    expect(reviewTime.value().sessions[0]).toMatchObject({ drafts: true, repos: ["a/b"], excludeRepos: ["c/*"] });
  });
});

describe("checking before saving", () => {
  it("passes when everything reads right", async () => {
    const { reviewTime } = await setUp();
    expect(reviewTime.check()).toBe(true);
    reviewTime.focusError();
    expect(document.activeElement).toBe(document.body);
  });

  it("adds a time typed but not added", async () => {
    const { reviewTime } = await setUp({ sessions: [session({ times: [] })] });
    $("#session-a-time").value = "08:15";
    expect(reviewTime.check()).toBe(true);
    expect(reviewTime.value().sessions[0]?.times).toEqual(["08:15"]);
  });

  it("asks for a time, unfolding the card and focusing the field", async () => {
    const { reviewTime } = await setUp({ sessions: [session({ times: [] })] });
    expect(reviewTime.check()).toBe(false);
    expect($(".session-body", card()).hidden).toBe(false);
    expect($(".session-expand", card()).getAttribute("aria-expanded")).toBe("true");
    expect($("#session-a-times-error").textContent).toBe("Add at least one time.");
    reviewTime.focusError();
    expect(document.activeElement).toBe($("#session-a-time"));
    $("#session-a-time").value = "08:00";
    $<HTMLButtonElement>(".time-picker .btn", card()).click();
    expect($("#session-a-time").hasAttribute("aria-invalid")).toBe(false);
    expect($("#session-a-times-error").textContent).toBe("");
  });

  it("keeps a card unfolded for a fix unfolded when drawn again", async () => {
    const { reviewTime } = await setUp({ sessions: [session({ times: [] })] });
    expect(reviewTime.check()).toBe(false);
    reviewTime.redraw();
    expect($(".session-body", card()).hidden).toBe(false);
    expect($(".session-expand", card()).getAttribute("aria-expanded")).toBe("true");
  });

  it("asks for a day, focusing the first", async () => {
    const { reviewTime } = await setUp({ sessions: [session({ days: [] })] });
    expect(reviewTime.check()).toBe(false);
    expect($("#session-a-days-error").textContent).toBe("Pick at least one day.");
    reviewTime.focusError();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Sunday");
  });

  it("finds a span that ends before it starts, leaving a card already open as it is", async () => {
    const { reviewTime } = await setUp({
      sessions: [session({ repeat: "every", from: "18:00", to: "09:00" }), session({ id: "b" })],
    });
    expand();
    expect(reviewTime.check()).toBe(false);
    expect($("#session-a-span-error").textContent).toBe("The end comes before the start.");
    expect($(".session-body", card(1)).hidden).toBe(true);
  });

  it("finds a repository that doesn't read as one", async () => {
    const { reviewTime } = await setUp();
    $("#session-a-repos").value = "nope";
    expect(reviewTime.check()).toBe(false);
    reviewTime.focusError();
    expect(document.activeElement).toBe($("#session-a-repos"));
  });

  it("does nothing on an error with nothing to focus before it", async () => {
    const { reviewTime } = await setUp();
    const error = document.createElement("p");
    error.className = "error";
    error.textContent = "Odd";
    $("#sessions").prepend(error);
    reviewTime.focusError();
    expect(document.activeElement).toBe(document.body);
  });
});
