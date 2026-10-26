import { describe, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { CommandServer, Sender } from "@/utils/command-server/command-server";

import { BAD_PULL, openUrl, reviewUrl, targetOf, windowCommands } from "./windows";

const pull = { id: "PR_1", repo: "acme/web", number: 12, teams: ["acme/web-team"], queue: "q1", title: "#12 · Fix login · Ana" };

const setup = () => {
  let pages: Sender[] = [];
  const server = {
    pages: () => pages,
    emitTo: vi.fn(() => true),
    broadcast: vi.fn(),
    onConnect: vi.fn(),
  } satisfies CommandServer;
  let next = 10;
  const created = vi.spyOn(fakeBrowser.tabs, "create").mockImplementation((info) => {
    const id = next++;
    pages = [...pages, { window: `review-${id}`, tabId: id, windowId: 1 }];
    return Promise.resolve({ id, url: info.url } as Browser.tabs.Tab);
  });
  const updated = vi.spyOn(fakeBrowser.tabs, "update").mockResolvedValue({} as never);
  const focused = vi.spyOn(fakeBrowser.windows, "update").mockResolvedValue({} as never);
  return {
    commands: windowCommands(server),
    server,
    created,
    updated,
    focused,
    setPages: (list: Sender[]) => {
      pages = list;
    },
  };
};

describe("the app's windows, as tabs", () => {
  it("opens a pull request's review in a tab of its own, and brings it back when asked again", async () => {
    const { commands, created, updated, focused } = setup();
    await commands.open_review!(pull, { window: "panel" });
    expect(created).toHaveBeenCalledWith({ url: reviewUrl({ ...pull, queue: "q1" }) });
    expect(reviewUrl({ ...pull, queue: null })).toContain("/review.html?id=PR_1&repo=acme%2Fweb&number=12");
    await commands.open_review!(pull, { window: "panel" });
    expect(created).toHaveBeenCalledOnce();
    expect(updated).toHaveBeenCalledWith(10, { active: true });
    expect(focused).toHaveBeenCalledWith(1, { focused: true });
  });

  it("opens it afresh once its tab is gone, or when the tab has no id", async () => {
    const { commands, created, setPages } = setup();
    await commands.open_review!(pull, { window: "panel" });
    setPages([]);
    await commands.open_review!(pull, { window: "panel" });
    expect(created).toHaveBeenCalledTimes(2);
    created.mockResolvedValueOnce({} as never);
    await commands.open_review!({ ...pull, id: "PR_2" }, { window: "panel" });
    expect(created).toHaveBeenCalledTimes(3);
  });

  it("moves a review tab on to the next pull request, unless another tab shows it", async () => {
    const { commands, server, created, updated } = setup();
    await commands.open_review!(pull, { window: "panel" });
    const tab = { window: "review-10", tabId: 10, windowId: 1 };
    await commands.switch_review!({ ...pull, id: "PR_2" }, tab);
    expect(server.emitTo).toHaveBeenCalledWith("review-10", "review-open", { ...pull, id: "PR_2" });
    // PR_1's tab now shows PR_2: opening PR_1 makes a new one.
    await commands.open_review!(pull, { window: "panel" });
    expect(created).toHaveBeenCalledTimes(2);
    // From the first tab, PR_1 is in the second one now: brought forward.
    await commands.switch_review!(pull, tab);
    expect(updated).toHaveBeenLastCalledWith(11, { active: true });
    // Its own: shown again in place. And from a page outside a tab, just told.
    await commands.switch_review!({ ...pull, id: "PR_2" }, tab);
    await commands.switch_review!({ ...pull, id: "PR_3", queue: null }, { window: "review-x" });
    expect(server.emitTo).toHaveBeenLastCalledWith("review-x", "review-open", { ...pull, id: "PR_3", queue: null });
  });

  it("takes only what GitHub and the app make", () => {
    expect(targetOf({ id: "PR_1", repo: "acme/web", number: 1 })).toEqual({
      id: "PR_1",
      repo: "acme/web",
      number: 1,
      teams: [],
      queue: null,
      title: "",
    });
    for (const bad of [
      { ...pull, id: "" },
      { ...pull, id: "a b" },
      { ...pull, repo: "acme/<web>" },
      { ...pull, number: "x" },
      { ...pull, teams: ["acme/web team"] },
      { ...pull, queue: "q&1" },
      { ...pull, id: 3 },
    ]) {
      expect(() => targetOf(bad)).toThrow(BAD_PULL);
    }
  });

  it("opens Settings, setup (or the one open), the panel where the browser lets it, and web links", async () => {
    const { commands, created, updated, setPages } = setup();
    const options = vi.spyOn(fakeBrowser.runtime, "openOptionsPage").mockResolvedValue();
    await commands.open_settings!({}, { window: "panel" });
    expect(options).toHaveBeenCalled();
    await commands.open_setup!({}, { window: "panel" });
    expect(created).toHaveBeenCalledWith({ url: "chrome-extension://test-extension-id/setup.html" });
    setPages([{ window: "setup", tabId: 3 }, { window: "panel" }]);
    await commands.open_setup!({}, { window: "panel" });
    expect(updated).toHaveBeenCalledWith(3, { active: true });
    const popup = vi.spyOn(fakeBrowser.action, "openPopup").mockResolvedValueOnce().mockRejectedValueOnce(new Error("no"));
    await commands.open_panel!({}, { window: "setup" });
    await commands.open_panel!({}, { window: "setup" });
    expect(popup).toHaveBeenCalledTimes(2);
    await commands.open_url!({ url: "https://github.com/acme/web/pull/12" }, { window: "panel" });
    expect(created).toHaveBeenLastCalledWith({ url: "https://github.com/acme/web/pull/12" });
    await expect(openUrl("javascript:alert(1)")).rejects.toThrow("Only https links open");
    await expect(openUrl(3)).rejects.toThrow("Only https links open");
  });
});
