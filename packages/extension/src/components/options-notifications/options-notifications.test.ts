// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import page from "@/entrypoints/options/index.html?raw";
import { $ } from "@/utils/extension-page/extension-page";
import { samplePull } from "@/utils/github-sample-pull/github-sample-pull";
import { EXCEPTIONS, normalizeNotify, type NotifySettings } from "@/utils/inbox/inbox";
import { pageBody } from "@/utils/page-body/page-body";
import { inboxItem } from "@/utils/storage/storage";

import type { createNotifications as CreateNotifications } from "./options-notifications";

let createNotifications: typeof CreateNotifications;

const field = (selector: string, root?: ParentNode) => $<HTMLInputElement>(selector, root);
const change = (input: HTMLInputElement | HTMLSelectElement, value?: string | boolean) => {
  if (typeof value === "boolean" && input instanceof HTMLInputElement) input.checked = value;
  else if (value !== undefined) input.value = String(value);
  input.dispatchEvent(new Event("change"));
};
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve);
  });

const setUp = async (saved: unknown = {}) => {
  const onChange = vi.fn<() => void>();
  const say = vi.fn<(text: string, tone: "error") => void>();
  const notifications = createNotifications({ onChange, say });
  notifications.render(normalizeNotify(saved));
  await settle();
  return { notifications, onChange, say };
};

describe("createNotifications", () => {
  beforeEach(async () => {
    ({ createNotifications } = await import("./options-notifications"));
    document.body.innerHTML = pageBody(page);
    vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({
      manifest_version: 3,
      name: "Focus Diff",
      version: "1.2.0",
      optional_permissions: ["notifications"],
    });
    Object.assign(fakeBrowser.permissions, { contains: () => Promise.resolve(true) });
    vi.stubEnv("FIREFOX", "");
    vi.stubGlobal("Option", function Option(text: string, value?: string) {
      return Object.assign(
        document.createElement("option"),
        { textContent: text },
        value === undefined ? {} : { value },
      );
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shows the saved settings: on, how often, quiet hours, how they show and each event", async () => {
    await setUp({
      enabled: true,
      interval: 10,
      quiet: { on: true, from: "20:00", to: "08:00", weekends: false },
      delivery: { grouped: true, sticky: true },
      events: { mention: { on: true, except: ["bots"], repos: ["acme/web"], when: "now" } },
    });
    expect(field("#notify-on").checked).toBe(true);
    expect(field("#notify-body").hidden).toBe(false);
    expect(field("#notify-on-hint").textContent).toContain("10");
    expect($<HTMLSelectElement>("#notify-interval").value).toBe("10");
    expect(field("#quiet-fields").hidden).toBe(false);
    expect([field("#quiet-from").value, field("#quiet-to").value, field("#quiet-weekends").checked]).toEqual([
      "20:00",
      "08:00",
      false,
    ]);
    expect([field("#delivery-grouped").checked, field("#delivery-sticky").checked]).toEqual([true, true]);
    expect(field("#events-reviewing").children).toHaveLength(3);
    expect(field("#events-mine").children).toHaveLength(3);
    expect(field("#event-mention-repos").hidden).toBe(false);
    expect(field("#event-mention-repos").textContent).toContain("acme/web");
    expect(field(".event-repos-toggle", field("#events-other")).textContent).toContain("1");
    expect(field("#event-comment-mine").getAttribute("aria-label")).toBeTruthy();
    expect(field("#event-approved").getAttribute("aria-label")).toBeNull();
    expect(field(".chrome-only").hidden).toBe(false);
  });

  it("hides what Firefox can't do", async () => {
    vi.stubEnv("FIREFOX", "true");
    await setUp();
    expect(field(".chrome-only").hidden).toBe(true);
  });

  it("offers the repositories the reader has pull requests in, and their owners", async () => {
    await inboxItem.setValue({
      me: "me",
      checkedAt: 0,
      problem: null,
      reviews: [samplePull(1, { repo: "acme/web" })],
      mine: [samplePull(2, { repo: "beta/api" }), samplePull(3, { repo: "acme/web" })],
    });
    await setUp();
    expect([...field("#repo-suggestions").querySelectorAll("option")].map((option) => option.value)).toEqual([
      "acme/web",
      "beta/api",
      "acme/*",
      "beta/*",
    ]);
  });

  it("gives back each change the reader makes", async () => {
    const { notifications, onChange } = await setUp({ enabled: true });
    change($<HTMLSelectElement>("#notify-interval"), "15");
    expect(field("#notify-on-hint").textContent).toContain("15");
    change(field("#quiet-on"), true);
    expect(field("#quiet-fields").hidden).toBe(false);
    change(field("#quiet-from"), "22:00");
    change(field("#quiet-to"), "");
    expect(field("#quiet-to").value).toBe("09:00");
    change(field("#quiet-weekends"), false);
    change(field("#delivery-grouped"), true);
    change(field("#delivery-sticky"), true);

    const mention = field("#event-mention");
    change(mention, true);
    expect(mention.closest("li")!.querySelector<HTMLElement>(".event-details")!.hidden).toBe(false);
    change(field("#event-approved"), false);
    expect(field("#event-approved").closest("li")!.querySelector<HTMLElement>(".event-details")!.hidden).toBe(true);

    const chips = [...mention.closest("li")!.querySelectorAll<HTMLButtonElement>(".skip-chip")];
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true"]);
    chips[0]!.click();
    expect(chips[0]!.getAttribute("aria-pressed")).toBe("false");
    const reviewChips = field("#event-review-requested")
      .closest("li")!
      .querySelectorAll<HTMLButtonElement>(".skip-chip");
    reviewChips[1]!.click();

    change(field("#event-mention-when-review"));

    const toggle = $<HTMLButtonElement>(".event-repos-toggle", field("#events-other"));
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(field("#event-mention-repos-input"));
    const input = field("#event-mention-repos-input");
    input.value = "acme/web";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(toggle.textContent).toContain("1");
    toggle.click();
    expect(field("#event-mention-repos").hidden).toBe(true);

    const only = field("#notify-repos");
    only.value = "acme/api";
    only.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const never = field("#notify-repos-never");
    never.value = "acme/old";
    never.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(onChange).toHaveBeenCalled();
    const value: NotifySettings = notifications.value();
    expect(value).toMatchObject({
      interval: 15,
      repos: ["acme/api"],
      excludeRepos: ["acme/old"],
      quiet: { on: true, from: "22:00", to: "09:00", weekends: false },
      delivery: { grouped: true, sticky: true },
    });
    expect(value.events.mention).toEqual({ on: true, except: [], repos: ["acme/web"], when: "review" });
    expect(value.events.approved.on).toBe(false);
    expect(value.events["review-requested"].except).toEqual(["drafts", "approved"]);
  });

  it("offers waiting for review time only while the reader has review times", async () => {
    const { notifications } = await setUp({ enabled: true });
    const groups = () => [...document.querySelectorAll<HTMLElement>(".event-when")].map((group) => group.hidden);
    expect(groups().every(Boolean)).toBe(true);
    notifications.setReviewTime(true);
    expect(groups().some(Boolean)).toBe(false);
    expect(field("#notify-when-hint").hidden).toBe(false);
    notifications.render(normalizeNotify({ enabled: true }));
    expect(groups().some(Boolean)).toBe(false);
    notifications.setReviewTime(false);
    expect(groups().every(Boolean)).toBe(true);
    expect(field("#notify-when-hint").hidden).toBe(true);
  });

  it("checks the repositories typed, unfolding an event's to show what's wrong", async () => {
    const { notifications } = await setUp({ enabled: true });
    expect(notifications.check()).toBe(true);
    field("#event-mention-repos-input").value = "nope/";
    expect(notifications.check()).toBe(false);
    expect(field("#event-mention-repos").hidden).toBe(false);
    expect(field(".event-repos-toggle", field("#events-other")).getAttribute("aria-expanded")).toBe("true");
    expect(notifications.check()).toBe(false);
    field("#event-mention-repos-input").value = "";
    field("#notify-repos").value = "nope/";
    expect(notifications.check()).toBe(false);
  });

  it("asks the browser before turning notifications on, and stays off if it says no", async () => {
    const request = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    Object.assign(fakeBrowser.permissions, { request });
    const { notifications, say } = await setUp();
    expect(field("#notify-body").hidden).toBe(true);
    change(field("#notify-on"), true);
    await settle();
    expect(field("#notify-on").checked).toBe(false);
    expect(say).toHaveBeenCalledWith(expect.any(String), "error");

    request.mockResolvedValue(true);
    change(field("#notify-on"), true);
    await settle();
    expect(field("#notify-body").hidden).toBe(false);
    expect(notifications.value().enabled).toBe(true);
  });

  it("shows no skip choices for an event with nothing to skip", async () => {
    const saved = EXCEPTIONS.mention;
    EXCEPTIONS.mention = [];
    try {
      await setUp();
      expect(field("#event-mention").closest("li")!.querySelector(".event-skip")).toBeNull();
    } finally {
      EXCEPTIONS.mention = saved;
    }
  });
});
