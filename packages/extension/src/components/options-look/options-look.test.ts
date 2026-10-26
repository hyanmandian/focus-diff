// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import page from "@/entrypoints/options/index.html?raw";
import { normalizeAppearance, PROVIDER_THEME, type Appearance } from "@/utils/appearance/appearance";
import { $ } from "@/utils/extension-page/extension-page";
import { pageBody } from "@/utils/page-body/page-body";

import type { createLook as CreateLook } from "./options-look";

/** The preview stands in for the demo: a bar wearing a couple of colours, as the page would read them. */
const demo = vi.hoisted(() => ({
  shadow: true,
  setTheme: vi.fn<(css: string) => void>(),
  onSettings: (): void => undefined,
}));
vi.mock("@/components/demo/demo", () => ({
  createDemo: (target: HTMLElement, _sample: unknown, options: { onSettings: () => void }) => {
    demo.onSettings = options.onSettings;
    const bar = document.createElement("div");
    bar.className = "demo-bar";
    bar.style.setProperty("--fd-bg", "rgb(16, 32, 48)");
    bar.style.setProperty("--fd-fg", "rgba(255, 0, 0, 0.5)");
    if (demo.shadow) bar.attachShadow({ mode: "open" });
    target.attachShadow({ mode: "open" }).append(bar);
    return { setTheme: demo.setTheme };
  },
}));

let createLook: typeof CreateLook;

const el = (selector: string, root?: ParentNode) => $<HTMLInputElement>(selector, root);
const row = (color: string) => $<HTMLLIElement>(`.color[data-color="${color}"]`);
const input = (target: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  target.value = value;
  target.dispatchEvent(new Event("input"));
};
const themes = () => [...$<HTMLSelectElement>("#theme").options].map((option) => option.textContent);

const mine: Appearance = {
  theme: "t1",
  themes: [{ id: "t1", name: "Night", colors: { bg: "#000000", fg: "#abc" } }],
};

const setUp = async (appearance: Appearance = mine) => {
  const onChange = vi.fn<() => void>();
  const notify = vi.fn<(text: string) => void>();
  const look = createLook({ onChange, notify });
  look.render(structuredClone(appearance));
  await vi.waitFor(() => {
    expect(el("#preview").shadowRoot).toBeTruthy();
  });
  return { look, onChange, notify };
};

describe("createLook", () => {
  beforeEach(async () => {
    ({ createLook } = await import("./options-look"));
    document.body.innerHTML = pageBody(page);
    // happy-dom has no Option constructor.
    vi.stubGlobal("Option", function Option(text: string, value: string) {
      return Object.assign(document.createElement("option"), { textContent: text, value });
    });
    demo.shadow = true;
    demo.setTheme.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists the themes and edits the one picked, its colours and those left to the provider's theme", async () => {
    await setUp();
    expect(themes()).toEqual(["Match the provider", "GitHub", "Night"]);
    expect($<HTMLSelectElement>("#theme").value).toBe("t1");
    expect(el("#theme-editor").hidden).toBe(false);
    expect(el("#theme-name").value).toBe("Night");
    expect(el(".color-hex", row("bg")).value).toBe("#000000");
    expect(el(".color-pick", row("fg")).value).toBe("#aabbcc");
    // A colour left to the provider shows what it is.
    expect(el(".color-hex", row("fg")).placeholder).toBe("#ff000080");
    expect(el(".color-hex", row("bg")).placeholder).toBe("#102030");
    expect(el(".color-pick", row("muted")).value).not.toBe("#102030");
  });

  it("reads the preview's colours from a bar without a shadow of its own too", async () => {
    demo.shadow = false;
    const { look } = await setUp(normalizeAppearance({}));
    expect(el("#theme-editor").hidden).toBe(true);
    look.render(structuredClone(mine));
    expect(el(".color-pick", row("bg")).value).toBe("#000000");
    $<HTMLSelectElement>("#theme").value = "t1";
    expect(el(".color-hex", row("fg")).placeholder).toBe("#ff000080");
  });

  it("takes a colour typed or picked, says when one isn't a colour, and resets one", async () => {
    const { look, onChange } = await setUp();
    const hex = el(".color-hex", row("bg"));
    input(hex, "#123456 ");
    expect(el(".color-pick", row("bg")).value).toBe("#123456");
    // The preview wears it.
    await vi.waitFor(() => {
      expect(demo.setTheme).toHaveBeenCalledWith(expect.stringContaining("#123456"));
    });
    input(hex, "nope");
    expect(hex.hasAttribute("aria-invalid")).toBe(false);
    hex.dispatchEvent(new Event("blur"));
    expect(hex.getAttribute("aria-invalid")).toBe("true");
    expect(el(".color-error", row("bg")).textContent).not.toBe("");
    // Fixed while marked wrong, it's right again at once.
    input(hex, "#fff");
    expect(hex.hasAttribute("aria-invalid")).toBe(false);
    input(hex, " ");

    const pick = el(".color-pick", row("muted"));
    input(pick, "#00ff00");
    expect(el(".color-hex", row("muted")).value).toBe("#00ff00");

    $<HTMLButtonElement>(".color-reset", row("fg")).click();
    expect(el(".color-hex", row("fg")).value).toBe("");
    expect(document.activeElement).toBe(el(".color-hex", row("fg")));

    expect(onChange).toHaveBeenCalled();
    expect(look.value().themes[0]?.colors).toEqual({ muted: "#00ff00" });
  });

  it("renames a theme in the list as it's typed, untitled when empty", async () => {
    const { look } = await setUp();
    input(el("#theme-name"), "Day");
    expect(themes().at(-1)).toBe("Day");
    input(el("#theme-name"), " ");
    expect(themes().at(-1)).toBe("Untitled theme");
    // Drawn again, it's still untitled.
    $<HTMLSelectElement>("#theme").dispatchEvent(new Event("change"));
    expect(themes().at(-1)).toBe("Untitled theme");
    expect(look.check()).toBe(false);
    expect(el("#theme-name").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(el("#theme-name"));
    input(el("#theme-name"), "Dusk");
    expect(el("#theme-name").hasAttribute("aria-invalid")).toBe(false);
    expect(look.check()).toBe(true);
    expect(look.value().themes[0]?.name).toBe("Dusk");
  });

  it("won't pass a colour that isn't one, and goes to it", async () => {
    const { look } = await setUp();
    input(el(".color-hex", row("accent")), "#12");
    expect(look.check()).toBe(false);
    expect(document.activeElement).toBe(el(".color-hex", row("accent")));
    // Something in the list that isn't a colour row doesn't count.
    el("#colors").append(Object.assign(document.createElement("li"), { className: "color" }));
    input(el(".color-hex", row("accent")), "");
    expect(look.check()).toBe(true);
  });

  it("picks a theme, makes a new one and deletes one", async () => {
    const { look, onChange, notify } = await setUp();
    const select = $<HTMLSelectElement>("#theme");
    select.value = PROVIDER_THEME;
    select.dispatchEvent(new Event("change"));
    expect(el("#theme-editor").hidden).toBe(true);
    expect(look.check()).toBe(true);
    // Nothing to delete or copy then.
    $<HTMLButtonElement>("#theme-delete").click();
    $<HTMLButtonElement>("#theme-copy").click();
    expect(notify).not.toHaveBeenCalled();

    $<HTMLButtonElement>("#theme-new").click();
    expect(themes().at(-1)).toBe("My theme 2");
    expect(document.activeElement).toBe(el("#theme-name"));
    input(el("#theme-name"), "");
    $<HTMLButtonElement>("#theme-delete").click();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Untitled theme"));
    expect(select.value).toBe(PROVIDER_THEME);
    expect(themes()).toHaveLength(3);
    expect(onChange).toHaveBeenCalled();
    expect(look.value().theme).toBe(PROVIDER_THEME);
  });

  it("copies a theme to share, or shows it to copy by hand", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { notify } = await setUp();
    $<HTMLButtonElement>("#theme-copy").click();
    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("Night"));
    });
    expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual({ name: "Night", colors: mine.themes[0]!.colors });
    input(el("#theme-name"), "");
    $<HTMLButtonElement>("#theme-copy").click();
    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("Untitled theme"));
    });

    writeText.mockRejectedValue(new Error("denied"));
    $<HTMLButtonElement>("#theme-copy").click();
    await vi.waitFor(() => {
      expect(el("#theme-export-fallback").hidden).toBe(false);
    });
    expect($<HTMLTextAreaElement>("#theme-export").value).toContain('"colors"');
    expect(document.activeElement).toBe(el("#theme-export"));
  });

  it("imports themes a teammate shared, and says when there are none", async () => {
    const { look, notify } = await setUp(normalizeAppearance({}));
    const box = $<HTMLTextAreaElement>("#theme-json");
    const button = $<HTMLButtonElement>("#theme-import");
    input(box, "  ");
    expect(button.disabled).toBe(true);
    input(box, "[]");
    expect(button.disabled).toBe(false);
    button.click();
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(el("#theme-json-error").textContent).not.toBe("");
    input(box, "{");
    expect(box.hasAttribute("aria-invalid")).toBe(false);
    button.click();
    expect(el("#theme-json-error").textContent).not.toBe("");

    input(
      box,
      JSON.stringify([
        { name: "Sea", colors: { bg: "#002" } },
        { name: "Sand", colors: {} },
      ]),
    );
    button.click();
    expect(themes().slice(-2)).toEqual(["Sea", "Sand"]);
    expect(el("#theme-name").value).toBe("Sea");
    expect(box.value).toBe("");
    expect(button.disabled).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("2"));
    expect(look.value().themes).toHaveLength(2);
  });

  it("takes the reader to the filters from the preview's settings button", async () => {
    await setUp();
    demo.onSettings();
    expect(document.activeElement).toBe(el("#global-h"));
  });

  it("follows a name typed before anything is drawn without failing", () => {
    const onChange = vi.fn<() => void>();
    createLook({ onChange, notify: vi.fn<(text: string) => void>() });
    input(el("#theme-name"), "Early");
    expect(onChange).toHaveBeenCalled();
  });
});
