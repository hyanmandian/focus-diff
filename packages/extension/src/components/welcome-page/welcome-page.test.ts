// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { createDemo } from "@/components/demo/demo";
import page from "@/entrypoints/welcome/index.html?raw";
import { normalizeAppearance } from "@/utils/appearance/appearance";
import { normalize } from "@/utils/filters/filters";
import { normalizeReviewTime } from "@/utils/review-sessions/review-sessions";
import { appearanceItem, configItem, loadConfig, loadReviewTime, reviewTimeItem } from "@/utils/storage/storage";

const demo = vi.hoisted(() => ({
  setTheme: vi.fn<(css: string) => void>(),
  createDemo: vi.fn<typeof createDemo>(),
}));

vi.mock(import("@/components/demo/demo"), () => ({
  createDemo: demo.createDemo,
}));

/** Lets the page's promises and the storage's events settle. */
const flush = async (turns = 10): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  if (turns > 1) await flush(turns - 1);
};

const manifest = (permissions?: Browser.runtime.ManifestOptionalPermission[]) => {
  vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({
    manifest_version: 3,
    name: "Focus Diff",
    version: "1.0.0",
    ...(permissions ? { optional_permissions: permissions } : {}),
  });
};

// The browser's types end on the callback overloads, which hide the promises these give back.
const request = () =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the promise overload, as the page calls it.
  vi.spyOn(fakeBrowser.permissions, "request") as unknown as MockInstance<
    (permissions: Browser.permissions.Permissions) => Promise<boolean>
  >;

const getAll = () =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the promise overload, as the page calls it.
  vi.spyOn(fakeBrowser.commands, "getAll") as unknown as MockInstance<
    () => Promise<Browser.commands.Command[]> | undefined
  >;

const commands = (list: Browser.commands.Command[] = []) => getAll().mockResolvedValue(list);

const start = async () => {
  // Imported once the browser's language can be read: the page reads it as it loads.
  const { startWelcome } = await import("./welcome-page");
  startWelcome();
  await vi.waitFor(
    () => {
      expect(document.documentElement.classList.contains("pending")).toBe(false);
    },
    { interval: 1 },
  );
  await flush();
};

const recipe = (id: string) => document.querySelector<HTMLElement>(`[data-recipe="${id}"]`)!;
const toggle = (id: string) => recipe(id).querySelector<HTMLButtonElement>(".recipe-toggle")!;
const preset = (id: string) => document.querySelector<HTMLElement>(`[data-preset="${id}"]`)!;
const presetButton = (id: string) => preset(id).querySelector("button")!;
const toast = () => document.querySelector("#toast")?.textContent;

describe("startWelcome", () => {
  beforeEach(() => {
    document.documentElement.className = "pending";
    // The page without its script, which the test runs itself.
    document.body.innerHTML = /<body>(?<body>[\s\S]*)<script/u.exec(page)?.groups?.body ?? "";
    location.hash = "";
    demo.createDemo.mockReturnValue({ setTheme: demo.setTheme });
    manifest(["notifications"]);
    commands();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("translates the page and shows it once it's drawn", async () => {
    await start();
    expect(document.title).toBe("Welcome to Focus Diff");
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.querySelector("h1")?.textContent).toBe("Welcome to Focus Diff");
    expect(document.querySelector("#lead")?.textContent).toMatch(/It works on .+\.$/u);
  });

  it("lists the recipes, with the buttons they add and their patterns", async () => {
    await start();
    const items = [...document.querySelectorAll<HTMLElement>("#recipes .recipe")];
    expect(items.map((item) => item.dataset.recipe)).toContain("stack");
    const stack = recipe("stack");
    expect(stack.querySelector(".recipe-title")?.textContent).toBe("Split frontend and backend");
    expect(stack.querySelector(".recipe-patterns summary")?.textContent).not.toBe("");
    expect([...stack.querySelectorAll(".recipe-names li")].map((li) => li.textContent)).toEqual([
      "Frontend",
      "Backend",
    ]);
    const frontend = stack.querySelector(".recipe-filter")!;
    expect(frontend.querySelector(".recipe-filter-name")?.textContent).toBe("Frontend");
    expect([...frontend.querySelectorAll("dt")].map((term) => term.textContent)).toEqual(["Include", "Exclude"]);
    expect(frontend.querySelector("code")?.textContent).toBe("\\.(tsx?|jsx?|vue|svelte|css|scss)$");
    // A filter that includes every file says so, and one that excludes nothing has no Exclude.
    const [code, only] = recipe("tests").querySelectorAll(".recipe-filter");
    expect(code?.querySelector(".everything")?.textContent).toBe("every file");
    expect(only?.querySelectorAll("dt")).toHaveLength(1);
    expect(toggle("stack").textContent).toBe("Add");
    expect(toggle("stack").getAttribute("aria-label")).toBe("Add Frontend, Backend");
    expect(stack.hasAttribute("data-added")).toBe(false);
  });

  it("adds a recipe's filters, and takes them out again", async () => {
    await start();
    toggle("stack").click();
    await flush();
    const added = await loadConfig();
    expect(added.global.map((filter) => [filter.id, filter.name])).toEqual([
      ["recipe-stack-0", "Frontend"],
      ["recipe-stack-1", "Backend"],
    ]);
    expect(toast()).toBe("Added Frontend, Backend. Open a pull request to try it.");
    expect(toggle("stack").textContent).toBe("Remove");
    expect(toggle("stack").getAttribute("aria-label")).toBe("Remove Frontend, Backend");
    expect(recipe("stack").hasAttribute("data-added")).toBe(true);

    toggle("stack").click();
    await flush();
    expect((await loadConfig()).global).toEqual([]);
    expect(toast()).toBe("Removed Frontend, Backend.");
    expect(toggle("stack").textContent).toBe("Add");
  });

  it("shows a recipe as added when its filters already are, from storage or another page", async () => {
    await configItem.setValue(normalize({ global: [{ id: "recipe-area-0", name: "Payments", include: "x" }] }));
    await start();
    expect(toggle("area").textContent).toBe("Remove");
    await configItem.setValue(normalize({}));
    await flush();
    expect(toggle("area").textContent).toBe("Add");
  });

  it("keeps the focus on the recipe's button when the list is drawn again", async () => {
    await start();
    toggle("docs").focus();
    await configItem.setValue(normalize({ global: [{ id: "elsewhere", name: "Mine", include: "x" }] }));
    await flush();
    expect(document.activeElement).toBe(toggle("docs"));
  });

  it("still says a recipe was added when it's gone from the page", async () => {
    await start();
    const button = toggle("area");
    recipe("area").remove();
    const setValue = vi.spyOn(configItem, "setValue").mockResolvedValue();
    button.click();
    await flush();
    expect(setValue.mock.calls[0]?.[0].global.map((filter) => filter.id)).toEqual(["recipe-area-0"]);
    expect(toast()).toBe("Added Payments. Open a pull request to try it.");
  });

  it("says why a recipe couldn't be saved", async () => {
    await start();
    const setValue = vi.spyOn(configItem, "setValue");
    setValue.mockRejectedValueOnce(new Error("QUOTA_BYTES_PER_ITEM quota exceeded"));
    toggle("stack").click();
    await flush();
    expect(toast()).toBe("Your filters are over the 8 KB the browser syncs per item. Remove a few and try again.");
    expect(toggle("stack").textContent).toBe("Add");

    setValue.mockRejectedValueOnce(new Error("Offline"));
    toggle("stack").click();
    await flush();
    expect(toast()).toBe("Couldn’t save: Offline");

    setValue.mockRejectedValueOnce("Broken");
    toggle("stack").click();
    await flush();
    expect(toast()).toBe("Couldn’t save: Broken");
    expect((await loadConfig()).global).toEqual([]);
  });

  describe("review time presets", () => {
    it("lists them with when they run and in what order", async () => {
      await start();
      const items = [...document.querySelectorAll<HTMLElement>("#review-presets [data-preset]")];
      expect(items.map((item) => item.dataset.preset)).toEqual(["twice", "every", "end"]);
      expect(preset("twice").querySelector(".recipe-title")?.textContent).toBe("Twice a day");
      expect(preset("twice").querySelector(".recipe-description")?.textContent).toMatch(/^Half an hour/u);
      const facts = [...preset("every").querySelectorAll(".recipe-names li")].map((li) => li.textContent);
      expect(facts).toHaveLength(2);
      expect(facts[1]).toBe("Quickest");
      expect(presetButton("end").textContent).toBe("Use this");
      expect(presetButton("end").getAttribute("aria-label")).toBe("Use “End of the day”");
    });

    it("turns review time on with one, asking for notifications first, and off again", async () => {
      const asked = request().mockResolvedValue(true);
      await start();
      presetButton("twice").click();
      await flush();
      expect(asked).toHaveBeenCalledWith({ permissions: ["notifications"] });
      const on = await loadReviewTime();
      expect(on.enabled).toBe(true);
      expect(on.sessions.map((session) => [session.id, session.name])).toEqual([["preset-twice", "Twice a day"]]);
      expect(toast()).toBe("“Twice a day” is set. Review requests now wait for it; change that in Notifications.");
      expect(presetButton("twice").textContent).toBe("Stop using");
      expect(presetButton("twice").getAttribute("aria-label")).toBe("Stop using “Twice a day”");
      expect(preset("twice").hasAttribute("data-added")).toBe(true);

      asked.mockClear();
      presetButton("twice").click();
      await flush();
      expect(asked).not.toHaveBeenCalled();
      const off = await loadReviewTime();
      expect(off.enabled).toBe(false);
      expect(off.sessions).toEqual([]);
      expect(toast()).toBe("“Twice a day” is off.");
      expect(presetButton("twice").textContent).toBe("Use this");
    });

    it("keeps review time on while another of the reader's is on", async () => {
      request().mockResolvedValue(true);
      await reviewTimeItem.setValue(
        normalizeReviewTime({
          enabled: true,
          sessions: [
            { id: "preset-end", name: "End of the day", on: true },
            { id: "mine", name: "Mine", on: true },
          ],
        }),
      );
      await start();
      expect(presetButton("end").textContent).toBe("Stop using");
      presetButton("end").click();
      await flush();
      const left = await loadReviewTime();
      expect(left.enabled).toBe(true);
      expect(left.sessions.map((session) => session.id)).toEqual(["mine"]);
    });

    it("shows a preset that's off as not in use", async () => {
      await reviewTimeItem.setValue(
        normalizeReviewTime({ enabled: true, sessions: [{ id: "preset-end", name: "End", on: false }] }),
      );
      await start();
      expect(presetButton("end").textContent).toBe("Use this");
    });

    it("leaves review time off when notifications aren't allowed", async () => {
      request().mockResolvedValue(false);
      await start();
      presetButton("every").click();
      await flush();
      expect(toast()).toBe("The browser didn’t allow notifications, so they stay off.");
      expect((await loadReviewTime()).enabled).toBe(false);
    });

    it("leaves review time off when asking for notifications fails", async () => {
      request().mockRejectedValue(new Error("Not from a click"));
      await start();
      presetButton("every").click();
      await flush();
      expect(toast()).toBe("The browser didn’t allow notifications, so they stay off.");
    });

    it("doesn't ask when the browser has notifications on its own", async () => {
      const asked = request();
      manifest();
      await start();
      presetButton("end").click();
      await flush();
      expect(asked).not.toHaveBeenCalled();
      expect((await loadReviewTime()).enabled).toBe(true);
    });

    it("doesn't ask when notifications aren't optional", async () => {
      const asked = request();
      manifest(["tabs"]);
      await start();
      presetButton("end").click();
      await flush();
      expect(asked).not.toHaveBeenCalled();
    });

    it("says why a preset couldn't be saved", async () => {
      request().mockResolvedValue(true);
      await start();
      const setValue = vi.spyOn(reviewTimeItem, "setValue");
      setValue.mockRejectedValueOnce(new Error("Offline"));
      presetButton("end").click();
      await flush();
      expect(toast()).toBe("Couldn’t save: Offline");
      expect(presetButton("end").textContent).toBe("Use this");
      setValue.mockRejectedValueOnce("Broken");
      presetButton("end").click();
      await flush();
      expect(toast()).toBe("Couldn’t save: Broken");
    });

    it("follows changes from settings, keeping the focus on the preset", async () => {
      await start();
      presetButton("every").focus();
      await reviewTimeItem.setValue(
        normalizeReviewTime({ enabled: true, sessions: [{ id: "preset-every", name: "Every", on: true }] }),
      );
      await flush();
      expect(presetButton("every").textContent).toBe("Stop using");
      expect(document.activeElement).toBe(presetButton("every"));
    });
  });

  describe("shortcuts", () => {
    const keys = () => [...document.querySelectorAll("#shortcuts kbd")].map((kbd) => kbd.textContent);

    it("names the reader's own keys, or the defaults for those unset", async () => {
      commands([
        { name: "next-filter", shortcut: "Ctrl+." },
        { name: "show-all", shortcut: "" },
      ]);
      await start();
      expect(keys()).toEqual(["Ctrl+.", "Alt+Shift+,", "Alt+Shift+0", "Alt+Shift+J"]);
      expect(document.querySelector("#shortcuts")?.textContent).toBe(
        "Without the mouse: Ctrl+. next filter, Alt+Shift+, previous, Alt+Shift+0 all files, Alt+Shift+J next file to review.",
      );
    });

    it("names the defaults where the browser can't list its shortcuts", async () => {
      // Safari's gives nothing back.
      getAll().mockReturnValue(void 0);
      await start();
      expect(keys()).toEqual(["Alt+Shift+.", "Alt+Shift+,", "Alt+Shift+0", "Alt+Shift+J"]);
    });

    it("names the defaults, and shows the page, when listing the shortcuts fails", async () => {
      getAll().mockRejectedValue(new Error("unsupported"));
      await start();
      expect(keys()).toEqual(["Alt+Shift+.", "Alt+Shift+,", "Alt+Shift+0", "Alt+Shift+J"]);
    });

    it("names the defaults where the browser has no shortcuts", async () => {
      const { commands: original } = fakeBrowser;
      Reflect.deleteProperty(fakeBrowser, "commands");
      try {
        await start();
      } finally {
        Object.assign(fakeBrowser, { commands: original });
      }
      expect(keys()).toHaveLength(4);
    });
  });

  it("focuses the recipes when the link asked for them", async () => {
    location.hash = "#recipes-h";
    await start();
    expect(document.activeElement?.id).toBe("recipes-h");
  });

  it("loads the demo in the reader's look, follows it, and sends its settings button to settings", async () => {
    const assign = vi.spyOn(location, "assign").mockImplementation(() => {
      // Stays on the page.
    });
    await start();
    await vi.waitFor(() => {
      expect(demo.createDemo).toHaveBeenCalledOnce();
    });
    const [target, sample, options] = demo.createDemo.mock.calls[0]!;
    expect(target.id).toBe("demo");
    expect(sample.files.length).toBeGreaterThan(0);
    expect(typeof options.theme).toBe("string");
    options.onSettings();
    expect(assign).toHaveBeenCalledWith("/options.html");

    await appearanceItem.setValue(normalizeAppearance({ theme: "dark" }));
    await vi.waitFor(() => {
      expect(demo.setTheme).toHaveBeenCalled();
    });
  });
});
