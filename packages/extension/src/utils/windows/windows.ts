// The app's windows, as tabs: a pull request's review (one tab per pull request, as the desktop has one window each),
// Settings (the options page), setup, the panel (the popup) and links, as lib.rs opens them.

import { storage } from "#imports";
import { browser } from "wxt/browser";

import type { CommandServer, Commands, Sender } from "@/utils/command-server/command-server";
import { tr } from "@/utils/words/words";

/** Which tab shows each pull request, by its id. Kept for the browser's session, as the background comes and goes. */
const reviewsItem = storage.defineItem<Record<string, number>>("session:reviews", { fallback: {} });

export const BAD_PULL = "Bad pull request";

/** A review's target, as the page's address and events carry it. */
export interface Target {
  id: string;
  repo: string;
  number: number;
  teams: string[];
  queue: string | null;
  title: string;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The pull request a command names, if its id, repository, teams and queue are what GitHub and the app make (lib.rs
 *  `plausible`): they go into an address and events. */
export const targetOf = (args: Record<string, unknown>): Target => {
  const token = (s: string) => /^[\w-]*$/u.test(s);
  const name = (s: string) => /^[\w./-]*$/u.test(s);
  const teams = Array.isArray(args.teams) ? args.teams.map((team) => text(team)) : [];
  const queue = typeof args.queue === "string" ? args.queue : null;
  const target = { id: text(args.id), repo: text(args.repo), number: Number(args.number), teams, queue, title: text(args.title) };
  const plausible =
    token(target.id) &&
    target.id !== "" &&
    name(target.repo) &&
    Number.isSafeInteger(target.number) &&
    teams.every((team) => name(team)) &&
    (queue === null || token(queue));
  if (!plausible) throw new Error(BAD_PULL);
  return target;
};

/** The review page's address for a pull request. */
export const reviewUrl = (target: Target) =>
  browser.runtime.getURL(
    `/review.html?${new URLSearchParams({
      id: target.id,
      repo: target.repo,
      number: String(target.number),
      teams: target.teams.join(","),
      queue: target.queue ?? "",
      title: target.title,
    })}`,
  );

/** Brings a tab forward, and its window. */
const focus = async (page: Sender) => {
  await browser.tabs.update(page.tabId!, { active: true });
  if (page.windowId !== undefined) await browser.windows.update(page.windowId, { focused: true });
};

/** An open page in a tab that's this window, or shows this tab. */
const pageIn = (server: CommandServer, matches: (page: Sender) => boolean) =>
  server.pages().find((page) => page.tabId !== undefined && matches(page));

/** Web links only, in a new tab. */
export const openUrl = async (url: unknown) => {
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error(tr("Only https links open", "Só links https abrem"));
  await browser.tabs.create({ url });
};

export const windowCommands = (server: CommandServer): Commands => {
  /** The open tab showing a pull request, other than `except`. */
  const reviewing = async (id: string, except?: number) => {
    const tab = (await reviewsItem.getValue())[id];
    return tab === undefined || tab === except ? undefined : pageIn(server, (page) => page.tabId === tab);
  };
  const remember = async (id: string, tab: number) => {
    const reviews = await reviewsItem.getValue();
    const open = new Set(server.pages().map((page) => page.tabId));
    // Only tabs still open, and one pull request per tab.
    const kept = Object.entries(reviews).filter(([other, at]) => other !== id && at !== tab && open.has(at));
    await reviewsItem.setValue({ ...Object.fromEntries(kept), [id]: tab });
  };

  return {
    open_url: ({ url }) => openUrl(url),
    open_settings: () => browser.runtime.openOptionsPage(),
    open_setup: async () => {
      const open = pageIn(server, (page) => page.window === "setup");
      if (open) await focus(open);
      else await browser.tabs.create({ url: browser.runtime.getURL("/setup.html") });
    },
    // Setup's last step shows the panel: the popup, where the browser lets an extension open it.
    open_panel: async () => {
      try {
        await browser.action.openPopup();
      } catch {
        // Not without a click, in this browser: the toolbar button is where it is.
      }
    },
    open_review: async (args) => {
      const target = targetOf(args);
      const open = await reviewing(target.id);
      if (open) {
        await focus(open);
        return;
      }
      const tab = await browser.tabs.create({ url: reviewUrl(target) });
      if (tab.id !== undefined) await remember(target.id, tab.id);
    },
    switch_review: async (args, from) => {
      const target = targetOf(args);
      const elsewhere = await reviewing(target.id, from.tabId);
      if (elsewhere) {
        await focus(elsewhere);
        return;
      }
      if (from.tabId !== undefined) await remember(target.id, from.tabId);
      server.emitTo(from.window, "review-open", target);
    },
  };
};
