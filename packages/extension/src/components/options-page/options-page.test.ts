// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { i18n } from "#i18n";
import page from "@/entrypoints/options/index.html?raw";
import { $ as find } from "@/utils/extension-page/extension-page";
import { normalizeNotify } from "@/utils/inbox/inbox";
import type { Message } from "@/utils/messages/messages";
import { pageBody } from "@/utils/page-body/page-body";
import { normalizeReviewTime } from "@/utils/review-sessions/review-sessions";
import { appearanceItem, configItem, notifyItem, popupItem, reviewTimeItem } from "@/utils/storage/storage";

import type { startOptions as StartOptions } from "./options-page";

vi.mock("@/components/demo/demo", () => ({ createDemo: () => ({ setTheme: vi.fn<(css: string) => void>() }) }));

let startOptions: typeof StartOptions;

const $ = (selector: string, root?: ParentNode) => find<HTMLInputElement>(selector, root);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input"));
};
const click = (selector: string) => {
  find<HTMLButtonElement>(selector).click();
};
const status = () => $("#status").textContent;
const filterRows = (root: ParentNode = $("#global")) => [...root.querySelectorAll<HTMLElement>(".filter")];

const CONFIG = {
  global: [
    { id: "a", name: "Code", include: "\\.ts$", exclude: "" },
    { id: "b", name: "Tests", include: "\\.test\\.", exclude: "" },
  ],
  repos: [{ repo: "acme/web", filters: [{ id: "c", name: "Styles", include: "\\.css$", exclude: "" }] }],
};

let listening: [EventTarget, string, EventListenerOrEventListenerObject | null][] = [];
const track = (target: EventTarget) => {
  const add = target.addEventListener.bind(target);
  vi.spyOn(target, "addEventListener").mockImplementation((name, listener, options) => {
    listening.push([target, name, listener]);
    add(name, listener, options);
  });
};

const open = async (hash = "") => {
  history.replaceState(null, "", `/options.html${hash}`);
  startOptions();
  await vi.waitFor(() => {
    expect($("#try-result").textContent).not.toBe("");
  });
};

describe("startOptions", () => {
  beforeEach(async () => {
    ({ startOptions } = await import("./options-page"));
    document.body.innerHTML = pageBody(page);
    document.documentElement.classList.add("pending");
    vi.stubGlobal("Option", function Option(text: string, value: string) {
      return Object.assign(document.createElement("option"), { textContent: text, value });
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({
      manifest_version: 3,
      name: "Focus Diff",
      version: "1.2.0",
    });
    vi.stubEnv("FIREFOX", "");
    listening = [];
    track(window);
    track(document);
    await configItem.setValue(CONFIG);
  });

  afterEach(() => {
    for (const [target, name, listener] of listening) target.removeEventListener(name, listener);
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shows the saved filters and repositories, the version, and reveals the page", async () => {
    await open();
    expect(document.documentElement.classList.contains("pending")).toBe(false);
    expect(document.title).toBe(i18n.t("optionsTitle"));
    expect($("#version").textContent).toContain("1.2.0");
    expect($("#tagline").textContent).not.toBe("");
    expect(filterRows().map((row) => $(".f-name", row).value)).toEqual(["Code", "Tests"]);
    expect($(".repo-name").value).toBe("acme/web");
    expect($("#repos-empty").hidden).toBe(true);
    expect($(".remove-repo").getAttribute("aria-label")).toContain("acme/web");
    expect($(".filter-fields").getAttribute("aria-label")).toBe("Code");
    expect($("#try-result").textContent).toBe(i18n.t("tryEmpty"));
    expect($("#add-repo").textContent).toBe(i18n.t("addRepo"));
    expect($('.sections a[href="#share"]').getAttribute("aria-current")).toBe("true");
    expect($(".sections-mark")).toBeTruthy();
  });

  it("starts with nothing when nothing is saved", async () => {
    await configItem.removeValue();
    await open();
    expect(filterRows()).toHaveLength(0);
    expect($(".empty", $("#global")).hidden).toBe(false);
    expect($("#repos-empty").hidden).toBe(false);
  });

  describe("filters", () => {
    it("adds one, says what's wrong with it as it's typed, and marks the page unsaved", async () => {
      await open();
      click("#global .add-filter");
      const row = filterRows().at(-1)!;
      expect(document.activeElement).toBe($(".f-name", row));
      expect(status()).toBe(i18n.t("statusUnsaved"));
      expect($("#savebar").hasAttribute("data-raised")).toBe(true);
      expect($("#savebar").inert).toBe(false);
      expect($(".error", row).textContent).toBe("");
      expect($(".filter-fields", row).getAttribute("aria-label")).toBe(i18n.t("untitledFilter"));

      type($(".f-include", row), "(");
      expect($(".f-include", row).getAttribute("aria-invalid")).toBe("true");
      expect($(".f-name", row).getAttribute("aria-invalid")).toBe("true");
      expect($(".error", row).textContent).toContain(i18n.t("errorName"));
      type($(".f-exclude", row), "[");
      expect($(".f-exclude", row).getAttribute("aria-invalid")).toBe("true");
      type($(".f-name", row), "Docs");
      expect($(".f-name", row).hasAttribute("aria-invalid")).toBe(false);
      expect($(".filter-fields", row).getAttribute("aria-label")).toBe("Docs");
      expect($(".remove-filter", row).getAttribute("aria-label")).toContain("Docs");
      type($(".f-include", row), "\\.md$");
      type($(".f-exclude", row), "");
      expect($(".error", row).textContent).toBe("");
    });

    it("removes one, moving the focus to the next, the one before, or the add button", async () => {
      await open();
      const [first] = filterRows();
      find<HTMLButtonElement>(".remove-filter", first).click();
      expect(document.activeElement).toBe($(".f-name", filterRows()[0]));
      const [last] = filterRows();
      find<HTMLButtonElement>(".remove-filter", last).click();
      expect(document.activeElement).toBe($("#global .add-filter"));
      expect($(".empty", $("#global")).hidden).toBe(false);

      click("#global .add-filter");
      click("#global .add-filter");
      find<HTMLButtonElement>(".remove-filter", filterRows()[1]).click();
      expect(document.activeElement).toBe($(".f-name", filterRows()[0]));
      expect(status()).toBe(i18n.t("statusUnsaved"));
    });
  });

  describe("repositories", () => {
    it("adds one, checks its name once left, and removes it", async () => {
      await open();
      click("#add-repo");
      const card = all(".repo").at(-1)!;
      const input = $(".repo-name", card);
      expect(document.activeElement).toBe(input);
      expect($(".remove-repo", card).getAttribute("aria-label")).toContain(i18n.t("thisRepository"));
      input.dispatchEvent(new Event("blur"));
      expect(input.hasAttribute("aria-invalid")).toBe(false);
      type(input, "not a repo");
      expect(input.hasAttribute("aria-invalid")).toBe(false);
      input.dispatchEvent(new Event("blur"));
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect($(".repo-error", card).textContent).toBe(i18n.t("errorRepo"));
      type(input, "acme/api");
      expect(input.hasAttribute("aria-invalid")).toBe(false);
      expect($(".remove-repo", card).getAttribute("aria-label")).toContain("acme/api");

      find<HTMLButtonElement>(".add-filter", card).click();
      expect(filterRows(card)).toHaveLength(1);

      find<HTMLButtonElement>(".remove-repo", card).click();
      expect(all(".repo")).toHaveLength(1);
      expect(document.activeElement).toBe($("#add-repo"));
      click(".remove-repo");
      expect($("#repos-empty").hidden).toBe(false);
    });

    it("offers a repository the page was opened for, unless it has filters already", async () => {
      await open("#repo=acme%2Fapi");
      expect($("#try-repo").value).toBe("acme/api");
      expect($("#add-repo").textContent).toBe(i18n.t("addRepoFor", ["acme/api"]));
      click("#add-repo");
      expect($(".repo-name", all(".repo").at(-1)).value).toBe("acme/api");
      expect($("#add-repo").textContent).toBe(i18n.t("addRepo"));

      location.hash = "repo=acme%2Fweb";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      expect($("#add-repo").textContent).toBe(i18n.t("addRepo"));
      location.hash = "";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      expect($("#try-repo").value).toBe("acme/web");
    });
  });

  it("tries a path, saying which filters show it, once typing pauses", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await open();
    type($("#try-path"), "src/app.ts");
    expect($("#try-result").textContent).toBe(i18n.t("tryEmpty"));
    vi.advanceTimersByTime(400);
    expect($("#try-result").textContent).toBe(i18n.t("tryShown", [i18n.t("filterAll"), "Code"]));
    expect($("#try-result").dataset.tone).toBe("ok");
    type($("#try-path"), "src/app.css");
    vi.advanceTimersByTime(400);
    expect($("#try-result").textContent).toBe(i18n.t("tryOnlyAll", [i18n.t("filterAll")]));
    expect($("#try-result").dataset.tone).toBe("");
    type($("#try-repo"), "acme/web");
    vi.advanceTimersByTime(400);
    expect($("#try-result").textContent).toBe(i18n.t("tryShown", [i18n.t("filterAll"), "Styles"]));
    type($(".f-include", filterRows()[0]), "\\.css$");
    vi.advanceTimersByTime(400);
    expect($("#try-result").textContent).toBe(i18n.t("tryShown", [i18n.t("filterAll"), "Code, Styles"]));
    type($(".repo-name"), "acme/other");
    click(".remove-filter");
    expect($("#try-result").textContent).toBe(i18n.t("tryOnlyAll", [i18n.t("filterAll")]));
  });

  it("offers review times the filters as they're named, renamed and removed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await reviewTimeItem.setValue(normalizeReviewTime({ enabled: true, sessions: [{ id: "s" }] }));
    await open();
    const chips = () => all("#sessions .skip-chip").map((chip) => chip.textContent);
    expect(chips()).toContain("Tests");
    type($(".f-name", filterRows()[1]), "Specs");
    vi.advanceTimersByTime(400);
    expect(chips()).toContain("Specs");
    expect(chips()).not.toContain("Tests");
    find<HTMLButtonElement>(".remove-filter", filterRows()[1]).click();
    expect(chips()).not.toContain("Specs");
  });

  describe("saving", () => {
    it("saves everything, says so, and lowers the save bar a moment later", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await open();
      type($(".f-name", filterRows()[0]), "Source");
      click("#save");
      await vi.waitFor(() => {
        expect(status()).toBe(i18n.t("statusSaved"));
      });
      expect((await configItem.getValue()).global[0]?.name).toBe("Source");
      expect(await appearanceItem.getValue()).toMatchObject({ theme: "provider" });
      expect(await popupItem.getValue()).toMatchObject({ teams: true });
      expect(await reviewTimeItem.getValue()).toMatchObject({ enabled: false });
      expect(await notifyItem.getValue()).toMatchObject({ enabled: false });
      vi.advanceTimersByTime(2500);
      expect(status()).toBe("");
      expect($("#savebar").hasAttribute("data-raised")).toBe(false);
      expect($("#savebar").inert).toBe(true);
    });

    it("saves on Ctrl+S or Cmd+S, and not on S alone", async () => {
      await open();
      type($(".f-name", filterRows()[0]), "Source");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
      expect(status()).toBe(i18n.t("statusUnsaved"));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "S", metaKey: true }));
      await vi.waitFor(() => {
        expect(status()).toBe(i18n.t("statusSaved"));
      });
      type($(".f-name", filterRows()[0]), "Code");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
      await vi.waitFor(() => {
        expect(status()).toBe(i18n.t("statusSaved"));
      });
      expect((await configItem.getValue()).global[0]?.name).toBe("Code");
    });

    it("keeps what's typed while saving unsaved", async () => {
      await open();
      const set = vi.spyOn(fakeBrowser.storage.sync, "set");
      click("#save");
      type($(".f-name", filterRows()[0]), "Source");
      await vi.waitFor(() => {
        expect(set).toHaveBeenCalledTimes(5);
      });
      await Promise.resolve();
      expect(status()).toBe(i18n.t("statusUnsaved"));
    });

    it("won't save filters that need fixing, and goes to the first", async () => {
      await open();
      click("#global .add-filter");
      click("#save");
      expect(status()).toBe(i18n.t("statusFixFilters"));
      expect($("#status").dataset.tone).toBe("error");
      const row = filterRows().at(-1)!;
      expect($(".error", row).textContent).toContain(i18n.t("errorName"));
      expect(document.activeElement).toBe($(".f-name", row));
    });

    it("won't save a repository without a name", async () => {
      await open();
      click("#add-repo");
      click("#save");
      expect(status()).toBe(i18n.t("statusFixRepos"));
      expect(document.activeElement).toBe($(".repo-name", all(".repo").at(-1)));
    });

    it("won't save a theme without a name", async () => {
      await appearanceItem.setValue({ theme: "t", themes: [{ id: "t", name: "Night", colors: {} }] });
      await open();
      type($("#theme-name"), "");
      click("#save");
      expect(status()).toBe(i18n.t("statusFixTheme"));
    });

    it("won't save a review queue repository that isn't one", async () => {
      await open();
      $("#popup-repos-only").value = "nope/";
      click("#save");
      expect(status()).toBe(i18n.t("statusFixPopup"));
      expect(document.activeElement).toBe($("#popup-repos-only"));
    });

    it("won't save review times that need fixing", async () => {
      await reviewTimeItem.setValue(
        normalizeReviewTime({ enabled: true, sessions: [{ id: "s", days: [], times: ["09:00"] }] }),
      );
      await open();
      click("#save");
      expect(status()).toBe(i18n.t("statusFixReview"));
    });

    it("won't save a notification repository that isn't one", async () => {
      await open();
      $("#notify-repos").value = "nope/";
      click("#save");
      expect(status()).toBe(i18n.t("statusFixNotify"));
      expect(document.activeElement).toBe($("#notify-repos"));
    });

    it.each([
      [0, "statusQuota"],
      [1, "statusQuotaTheme"],
      [2, "statusQuotaPopup"],
      [3, "statusQuotaReview"],
      [4, "statusQuotaNotify"],
    ] as const)("says which one is too big to sync, the one saved after %i others", async (before, message) => {
      await open();
      const set = vi.spyOn(fakeBrowser.storage.sync, "set");
      for (let index = 0; index < before; index += 1) set.mockResolvedValueOnce();
      set.mockRejectedValueOnce(new Error("QUOTA_BYTES_PER_ITEM quota exceeded"));
      click("#save");
      await vi.waitFor(() => {
        expect(status()).toBe(i18n.t(message));
      });
    });

    it("says why else saving failed", async () => {
      await open();
      vi.spyOn(fakeBrowser.storage.sync, "set").mockRejectedValueOnce(new Error("offline"));
      click("#save");
      await vi.waitFor(() => {
        expect(status()).toBe(i18n.t("statusSaveError", ["offline"]));
      });
      vi.spyOn(fakeBrowser.storage.sync, "set").mockRejectedValueOnce("gone");
      click("#save");
      await vi.waitFor(() => {
        expect(status()).toBe(i18n.t("statusSaveError", ["gone"]));
      });
    });

    it("asks before leaving with unsaved changes", async () => {
      await open();
      const leave = () => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      expect(leave()).toBe(false);
      click("#global .add-filter");
      expect(leave()).toBe(true);
    });
  });

  describe("sharing", () => {
    it("copies the filters, or shows them to copy by hand", async () => {
      const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
      await open();
      click("#export");
      await vi.waitFor(() => {
        expect($("#toast").textContent).toBe(i18n.t("copied", 3, [3]));
      });
      expect(JSON.parse(writeText.mock.calls[0]![0])).toMatchObject({ global: [{ name: "Code" }, { name: "Tests" }] });
      expect($("#export-fallback").hidden).toBe(true);

      writeText.mockRejectedValue(new Error("denied"));
      click("#export");
      await vi.waitFor(() => {
        expect($("#export-fallback").hidden).toBe(false);
      });
      expect(find<HTMLTextAreaElement>("#export-json").value).toContain('"Code"');
      expect(document.activeElement).toBe($("#export-json"));
    });

    it("imports filters a teammate copied, and says when there are none", async () => {
      await open();
      const box = find<HTMLTextAreaElement>("#json");
      type(box, " ");
      expect(find<HTMLButtonElement>("#import").disabled).toBe(true);
      type(box, "{");
      click("#import");
      expect($("#json-error").textContent).toBe(i18n.t("importInvalid", [i18n.t("copyButton")]));
      expect(box.getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(box);
      type(box, "{}");
      expect(box.hasAttribute("aria-invalid")).toBe(false);
      click("#import");
      expect($("#json-error").textContent).toBe(i18n.t("importEmpty"));

      type(box, JSON.stringify({ global: [{ name: "Docs", include: "\\.md$" }] }));
      click("#import");
      expect(filterRows().map((row) => $(".f-name", row).value)).toEqual(["Docs"]);
      expect(all(".repo")).toHaveLength(0);
      expect(box.value).toBe("");
      expect(find<HTMLButtonElement>("#import").disabled).toBe(true);
      expect($("#json-error").textContent).toBe("");
      expect($("#toast").textContent).toBe(i18n.t("imported", 1, [1]));
      expect(document.activeElement).toBe($("#global-h"));
      expect(status()).toBe(i18n.t("statusUnsaved"));
    });
  });

  describe("the section index", () => {
    const link = (id: string) => find<HTMLAnchorElement>(`.sections a[href="#${id}"]`);
    const current = () => all(".sections a[aria-current]").map((each) => each.getAttribute("href"));
    const layout = (y: number, tops: Record<string, number>) => {
      vi.stubGlobal("innerHeight", 1000);
      vi.stubGlobal("scrollY", y);
      Object.defineProperty(document.documentElement, "scrollHeight", { value: 9000, configurable: true });
      for (const section of all("main > section"))
        vi.spyOn(section, "getBoundingClientRect").mockReturnValue(new DOMRect(0, tops[section.id] ?? 5000, 10, 10));
    };
    const scroll = async () => {
      window.dispatchEvent(new Event("scroll"));
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    };

    it("marks the section nearest the top as the page scrolls, the first one before any", async () => {
      await open();
      layout(0, {});
      await scroll();
      expect(current()).toEqual(["#filters"]);
      layout(800, { filters: -900, repositories: -200, try: 350, appearance: 800 });
      await scroll();
      expect(current()).toEqual(["#repositories"]);
      window.dispatchEvent(new Event("resize"));
      expect(current()).toEqual(["#repositories"]);
      expect($(".sections-mark").style.getPropertyValue("--w")).toMatch(/px$/u);
    });

    it("keeps a section picked from a link marked until the reader scrolls on", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await open();
      layout(0, {});
      link("popup").click();
      expect(current()).toEqual(["#popup"]);
      await scroll();
      expect(current()).toEqual(["#popup"]);
      layout(3000, {});
      vi.advanceTimersByTime(1000);
      window.dispatchEvent(new Event("scrollend"));
      layout(3002, {});
      await scroll();
      expect(current()).toEqual(["#popup"]);
      layout(3500, { filters: -3000 });
      await scroll();
      expect(current()).toEqual(["#filters"]);
      find<HTMLAnchorElement>(".skip").click();
      document.body.click();
      document.dispatchEvent(new MouseEvent("click"));
      expect(current()).toEqual(["#filters"]);
    });

    it("scrolls a narrow index sideways to the current section, smoothly unless motion is reduced", async () => {
      await open();
      const list = $(".sections ul");
      Object.defineProperty(list, "scrollWidth", { value: 900, configurable: true });
      const scrollTo = vi.spyOn(list, "scrollTo");
      layout(0, {});
      await scroll();
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      link("try").click();
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
    });

    it("opens on the section in its address, once everything above it is drawn", async () => {
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
      await open("#notifications");
      expect(scrollIntoView.mock.contexts[0]).toBe($("#notifications"));
      expect(current()).toEqual(["#notifications"]);
    });

    it("ignores an address that isn't a section", async () => {
      await open("#nowhere");
      expect(current()).toEqual(["#share"]);
    });

    it("ignores links that aren't to sections, and works without an index", async () => {
      $(".sections ul").insertAdjacentHTML(
        "beforeend",
        '<li><a href="/welcome.html">x</a></li><li><a href="#gone">y</a></li>',
      );
      await open();
      expect(current()).toEqual(["#share"]);
    });

    it("works with an index that isn't a list, or none at all", async () => {
      $(".sections").innerHTML = '<a href="#filters">Filters</a>';
      await open();
      expect(current()).toEqual(["#filters"]);
      expect(document.querySelector(".sections-mark")).toBeNull();
    });

    it("works with no index at all", async () => {
      $(".sections").remove();
      await open();
      expect(document.querySelector(".sections-mark")).toBeNull();
    });
  });

  describe("shown again from a pull request", () => {
    const show = (message: unknown) => {
      const sendResponse = vi.fn<(response: unknown) => void>();
      void fakeBrowser.runtime.onMessage.trigger(message, {}, sendResponse);
      return sendResponse;
    };

    it("comes forward on that repository, or that section", async () => {
      const update = vi.fn<(id: number, properties: object) => Promise<void>>();
      const focus = vi.fn<(id: number, properties: object) => Promise<void>>();
      Object.assign(fakeBrowser.tabs, { update, getCurrent: () => Promise.resolve({ id: 7, windowId: 3 }) });
      Object.assign(fakeBrowser.windows, { update: focus });
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
      await open();
      expect(show({ type: "show-options", repo: "acme/api" } satisfies Message)).toHaveBeenCalledWith(true);
      expect(location.hash).toBe("#repo=acme%2Fapi");
      await vi.waitFor(() => {
        expect(update).toHaveBeenCalledWith(7, { active: true });
      });
      expect(focus).toHaveBeenCalledWith(3, { focused: true });
      show({ type: "show-options", section: "popup" } satisfies Message);
      expect(scrollIntoView.mock.contexts.at(-1)).toBe($("#popup"));
      show({ type: "show-options", section: "gone" } satisfies Message);
      show({ type: "show-options" } satisfies Message);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("stays put when it can't tell its own tab, and ignores other messages", async () => {
      const update = vi.fn<(id: number, properties: object) => Promise<void>>();
      Object.assign(fakeBrowser.tabs, { update, getCurrent: () => Promise.resolve() });
      await open();
      expect(show({ type: "open-welcome" } satisfies Message)).not.toHaveBeenCalled();
      expect(show(null)).not.toHaveBeenCalled();
      show({ type: "show-options" } satisfies Message);
      await new Promise<void>((resolve) => {
        setTimeout(resolve);
      });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("unrolling what's shown", () => {
    let observed: (records: Partial<MutationRecord>[]) => void = vi.fn<(records: Partial<MutationRecord>[]) => void>();
    const shown = async () => {
      vi.stubGlobal(
        "MutationObserver",
        class {
          constructor(callback: (records: Partial<MutationRecord>[]) => void) {
            observed = callback;
          }

          observe = vi.fn<() => void>();
        },
      );
      await open();
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      expect($(".sections-mark").classList.contains("ready")).toBe(true);
    };

    it("unrolls what a switch shows, at the page's pace", async () => {
      const animate = vi.spyOn(HTMLElement.prototype, "animate");
      document.documentElement.style.setProperty("--ease", "linear");
      await shown();
      const fields = $("#quiet-fields");
      fields.hidden = false;
      observed([
        { target: fields, oldValue: "" },
        { target: $("#notify-body"), oldValue: null },
        { target: $("#review-body"), oldValue: "" },
        { target: document.createTextNode(""), oldValue: "" },
      ]);
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.contexts[0]).toBe(fields);
      expect(animate.mock.calls[0]?.[1]).toMatchObject({ easing: "linear" });
      document.documentElement.style.removeProperty("--ease");
      observed([{ target: fields, oldValue: "" }]);
      expect(animate.mock.calls[1]?.[1]).toMatchObject({ easing: "ease-out" });
    });

    it("doesn't move anything when the reader asks for less motion", async () => {
      const animate = vi.spyOn(HTMLElement.prototype, "animate");
      await shown();
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      observed([{ target: $("#quiet-fields"), oldValue: "" }]);
      expect(animate).not.toHaveBeenCalled();
    });
  });

  describe("changes made elsewhere", () => {
    it("follows them while nothing here is unsaved", async () => {
      await open();
      await configItem.setValue({ global: [{ id: "z", name: "Elsewhere", include: "", exclude: "" }], repos: [] });
      await vi.waitFor(() => {
        expect(filterRows().map((row) => $(".f-name", row).value)).toEqual(["Elsewhere"]);
      });
      await appearanceItem.setValue({ theme: "t", themes: [{ id: "t", name: "Night", colors: {} }] });
      await vi.waitFor(() => {
        expect($("#theme-name").value).toBe("Night");
      });
      await popupItem.setValue({ repos: [], excludeRepos: [], teams: false, updates: false, merged: false });
      await vi.waitFor(() => {
        expect($("#popup-teams").checked).toBe(false);
      });
      await reviewTimeItem.setValue(normalizeReviewTime({ enabled: true }));
      await vi.waitFor(() => {
        expect($("#review-on").checked).toBe(true);
      });
      await notifyItem.setValue(normalizeNotify({ enabled: true }));
      await vi.waitFor(() => {
        expect($("#notify-on").checked).toBe(true);
      });
      expect(status()).toBe("");
    });

    it("keeps what's unsaved here, and says the saved settings changed", async () => {
      await open();
      click("#global .add-filter");
      for (const change of [
        () => configItem.setValue({ global: [], repos: [] }),
        () => appearanceItem.setValue({ theme: "provider", themes: [] }),
        () => popupItem.setValue({ repos: [], excludeRepos: [], teams: false, updates: false, merged: false }),
        () => reviewTimeItem.setValue(normalizeReviewTime({ enabled: true })),
        () => notifyItem.setValue(normalizeNotify({ enabled: true })),
      ]) {
        say("");
        // oxlint-disable-next-line eslint/no-await-in-loop -- each change is told apart.
        await change();
        // oxlint-disable-next-line eslint/no-await-in-loop -- each change is told apart.
        await vi.waitFor(() => {
          expect(status()).toBe(i18n.t("statusChangedElsewhere"));
        });
      }
      expect(filterRows()).toHaveLength(3);
      expect($("#popup-teams").checked).toBe(true);
      expect($("#review-on").checked).toBe(false);
      expect($("#notify-on").checked).toBe(false);
    });
  });
});

const say = (text: string) => {
  $("#status").textContent = text;
};
