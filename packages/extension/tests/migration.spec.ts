// Updating from an extension that had its own popup and settings: what the person had set comes over to the app's
// setup (src/utils/migration), and setup opens to connect GitHub, which the old extension never needed.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, type BrowserContext } from "@playwright/test";

import { expect, test } from "./fixtures";

/** The old extension's settings, as it kept them. */
const OLD = {
  sync: {
    config: {
      global: [{ id: "frontend", name: "Frontend", include: "\\.tsx?$", exclude: "\\.test\\." }],
      repos: [{ repo: "acme/api", filters: [{ id: "backend", name: "Backend", include: "\\.go$", exclude: "" }] }],
    },
    notifications: {
      enabled: true,
      repos: [],
      excludeRepos: [],
      interval: 5,
      events: { "review-requested": { on: true, except: ["drafts"], repos: [], when: "now" } },
      delivery: { grouped: false, sticky: false, sound: { id: "chime", volume: 60 } },
    },
    reviewTime: {
      enabled: true,
      sessions: [
        {
          id: "s1",
          name: "Afternoon",
          on: true,
          days: [1, 2, 3, 4, 5],
          repeat: "times",
          times: ["15:00"],
          minutes: 30,
        },
      ],
    },
  },
  local: { learnedPace: { all: { files: 4, expected: 10, actual: 15 }, kinds: {} } },
};

/** The extension, from a folder of its own, in a browser profile kept between launches. */
const launch = (extension: string, profile: string) =>
  chromium.launchPersistentContext(profile, {
    channel: "chromium",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });

const workerOf = async (context: BrowserContext) =>
  context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

test("moves the old settings over on update, and opens setup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "focus-diff-"));
  const extension = path.join(root, "extension");
  const profile = path.join(root, "profile");
  await cp(path.resolve(".output/chrome-mv3"), extension, { recursive: true });

  // The old version's settings, in the profile it ran in. (This build stands in for it: what its first run wrote, as
  // setup does, goes.)
  let context = await launch(extension, profile);
  const first = await workerOf(context);
  await expect.poll(() => context.pages().length).toBeGreaterThan(1);
  for (const page of context.pages()) await page.close();
  await first.evaluate(async (old) => {
    await chrome.storage.local.clear();
    await chrome.storage.sync.set(old.sync);
    await chrome.storage.local.set(old.local);
  }, OLD);
  await context.close();

  // The new version, in the same place: an update (Chrome may say "install" for a folder loaded from the command line;
  // the background moves the settings over whenever it starts, either way).
  const manifest = path.join(extension, "manifest.json");
  const parsed = JSON.parse(await readFile(manifest, "utf8")) as { version: string };
  await writeFile(manifest, JSON.stringify({ ...parsed, version: `${parsed.version}.1` }));
  context = await launch(extension, profile);
  const worker = await workerOf(context);
  const id = new URL(worker.url()).host;
  try {
    await expect
      .poll(async () => Object.keys(await worker.evaluate(() => chrome.storage.local.get("file.config"))))
      .toEqual(["file.config"]);
    const stored = await worker.evaluate(() => chrome.storage.local.get(["file.config", "file.pace", "learnedPace"]));
    const config = JSON.parse(String(stored["file.config"])) as {
      filters: Array<{ id: string; repos: string[] }>;
      pollSeconds: number;
      reviewTime: { enabled: boolean; sessions: Array<{ name: string; times: string[] }> };
    };
    expect(config.filters.map(({ id: filter, repos }) => ({ id: filter, repos }))).toEqual([
      { id: "frontend", repos: [] },
      { id: "backend", repos: ["acme/api"] },
    ]);
    expect(config.pollSeconds).toBe(300);
    expect(config.reviewTime).toMatchObject({ enabled: true, sessions: [{ name: "Afternoon", times: ["15:00"] }] });
    expect(JSON.parse(String(stored["file.pace"]))).toMatchObject({ all: { files: 4 } });
    // The old keys are gone.
    expect(stored.learnedPace).toBeUndefined();
    expect(await worker.evaluate(() => chrome.storage.sync.get(null))).toEqual({});
    await expect
      .poll(() => context.pages().some((page) => page.url() === `chrome-extension://${id}/setup.html`))
      .toBe(true);
  } finally {
    await context.close();
    await rm(root, { recursive: true, force: true });
  }
});
