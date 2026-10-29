import { i18n } from "#i18n";
import type { Demo } from "@/components/demo/demo";
import { copyOrShow } from "@/components/options-widgets/options-widgets";
import {
  appearanceCss,
  createStyler,
  HEX_COLOR,
  importThemes,
  normalizeAppearance,
  shareTheme,
  PROVIDER_THEME,
  THEME_COLORS,
  type Appearance,
  type CustomTheme,
  type ThemeColor,
} from "@/utils/appearance/appearance";
import { $, templateElement, translate } from "@/utils/extension-page/extension-page";
import { newId } from "@/utils/filters/filters";
import { PROVIDERS } from "@/utils/providers/providers";

const COLOR_NAMES: Record<ThemeColor, string> = {
  bg: i18n.t("colorBg"),
  fg: i18n.t("colorFg"),
  muted: i18n.t("colorMuted"),
  border: i18n.t("colorBorder"),
  "border-muted": i18n.t("colorBorderMuted"),
  hover: i18n.t("colorHover"),
  focus: i18n.t("colorFocus"),
  "selected-bg": i18n.t("colorSelectedBg"),
  "selected-fg": i18n.t("colorSelectedFg"),
  track: i18n.t("colorTrack"),
  accent: i18n.t("colorAccent"),
  add: i18n.t("colorAdd"),
  del: i18n.t("colorDel"),
  attention: i18n.t("colorAttention"),
};

const themeLabel = (name: string) => name.trim() || i18n.t("untitledTheme");

const hexOf = (color: string): string | null => {
  const [r, g, b, a = 1] = color.match(/[\d.]+/gu)?.map(Number) ?? [];
  if (r === undefined || g === undefined || b === undefined) return null;
  const channels = a < 1 ? [r, g, b, Math.round(a * 255)] : [r, g, b];
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
};

const pickerValue = (hex: string): string => {
  const digits = hex.slice(1);
  const full = digits.length <= 4 ? Array.from(digits, (digit) => digit + digit).join("") : digits;
  return `#${full.slice(0, 6).toLowerCase()}`;
};

interface LookOptions {
  onChange: () => void;
  notify: (text: string) => void;
}

export const createLook = ({ onChange, notify }: LookOptions) => {
  let appearance: Appearance = normalizeAppearance({});
  let drafts: Partial<Record<ThemeColor, string>> = {};
  let preview: Demo | null = null;
  const restylePreview = createStyler((css) => {
    preview?.setTheme(css);
    showDefaults();
  });

  const select = $<HTMLSelectElement>("#theme");
  const editor = $("#theme-editor");
  const name = $<HTMLInputElement>("#theme-name");
  const nameError = $("#theme-name-error");
  const list = $("#colors");
  const current = () => appearance.themes.find((theme) => theme.id === appearance.theme);

  const showDefaults = () => {
    const host = $("#preview").shadowRoot?.querySelector<HTMLElement>(".demo-bar");
    if (!host) return;
    const probe = document.createElement("span");
    (host.shadowRoot ?? host).append(probe);
    for (const row of list.querySelectorAll<HTMLElement>(".color")) {
      probe.style.color = `var(--fd-${row.dataset.color})`;
      const value = hexOf(getComputedStyle(probe).color);
      if (!value) continue;
      const hex = $<HTMLInputElement>(".color-hex", row);
      hex.placeholder = value;
      if (!hex.value) $<HTMLInputElement>(".color-pick", row).value = pickerValue(value);
    }
    probe.remove();
  };

  const sync = () => {
    const theme = current();
    if (theme) {
      theme.name = name.value;
      theme.colors = Object.fromEntries(Object.entries(drafts).filter(([, value]) => value && HEX_COLOR.test(value)));
    }
    onChange();
    void restylePreview(appearance);
  };

  const rowChecks = new WeakMap<HTMLElement, () => boolean>();
  const colorRow = (color: ThemeColor) => {
    const template = templateElement<HTMLElement>("color-template");
    translate(template);
    template.dataset.color = color;
    const id = `color-${color}`;
    const label = $<HTMLLabelElement>(".color-label", template);
    const pick = $<HTMLInputElement>(".color-pick", template);
    const hex = $<HTMLInputElement>(".color-hex", template);
    const reset = $<HTMLButtonElement>(".color-reset", template);
    const error = $(".color-error", template);
    label.textContent = COLOR_NAMES[color];
    label.htmlFor = id;
    hex.id = id;
    error.id = `${id}-error`;
    hex.setAttribute("aria-describedby", error.id);
    pick.setAttribute("aria-label", i18n.t("colorPick", [COLOR_NAMES[color]]));
    reset.setAttribute("aria-label", i18n.t("colorResetLabel", [COLOR_NAMES[color]]));
    hex.value = drafts[color] ?? "";
    if (hex.value && HEX_COLOR.test(hex.value)) pick.value = pickerValue(hex.value);

    const check = () => {
      const value = hex.value.trim();
      const valid = !value || HEX_COLOR.test(value);
      error.textContent = valid ? "" : i18n.t("errorColor");
      if (valid) hex.removeAttribute("aria-invalid");
      else hex.setAttribute("aria-invalid", "true");
      return valid;
    };
    hex.addEventListener("input", () => {
      drafts[color] = hex.value.trim();
      if (HEX_COLOR.test(drafts[color])) pick.value = pickerValue(drafts[color]);
      if (hex.hasAttribute("aria-invalid")) check();
      sync();
    });
    hex.addEventListener("blur", () => {
      check();
    });
    pick.addEventListener("input", () => {
      hex.value = pick.value;
      drafts[color] = pick.value;
      check();
      sync();
    });
    reset.addEventListener("click", () => {
      hex.value = "";
      delete drafts[color];
      check();
      sync();
      hex.focus();
    });
    rowChecks.set(template, check);
    return template;
  };

  const renderEditor = () => {
    const theme = current();
    editor.hidden = !theme;
    $("#theme-export-fallback").hidden = true;
    if (!theme) return;
    name.value = theme.name;
    nameError.textContent = "";
    name.removeAttribute("aria-invalid");
    drafts = { ...theme.colors };
    list.replaceChildren(...THEME_COLORS.map((each) => colorRow(each)));
    showDefaults();
  };

  const renderSelect = () => {
    select.replaceChildren(
      new Option(i18n.t("themeProvider"), PROVIDER_THEME),
      ...PROVIDERS.map((provider) => new Option(provider.name, provider.id)),
      ...appearance.themes.map((theme) => new Option(themeLabel(theme.name), theme.id)),
    );
    select.value = appearance.theme;
  };

  const render = () => {
    renderSelect();
    renderEditor();
    void restylePreview(appearance);
  };

  const choose = (id: string) => {
    appearance = { ...appearance, theme: id };
    render();
    onChange();
  };

  select.addEventListener("change", () => {
    choose(select.value);
  });
  name.addEventListener("input", () => {
    if (name.value.trim()) {
      nameError.textContent = "";
      name.removeAttribute("aria-invalid");
    }
    const option = select.selectedOptions[0];
    if (option) option.textContent = themeLabel(name.value);
    sync();
  });

  $("#theme-new").addEventListener("click", () => {
    const theme: CustomTheme = {
      id: newId(),
      name: i18n.t("newThemeName", [String(appearance.themes.length + 1)]),
      colors: {},
    };
    appearance = { theme: theme.id, themes: [...appearance.themes, theme] };
    render();
    onChange();
    name.focus();
    name.select();
  });

  $("#theme-delete").addEventListener("click", () => {
    const theme = current();
    if (!theme) return;
    appearance = { theme: PROVIDER_THEME, themes: appearance.themes.filter((each) => each !== theme) };
    render();
    onChange();
    notify(i18n.t("themeDeleted", [themeLabel(theme.name)]));
    select.focus();
  });

  const copyTheme = async () => {
    const theme = current();
    if (!theme) return;
    if (await copyOrShow(shareTheme(theme), $("#theme-export-fallback"), $<HTMLTextAreaElement>("#theme-export")))
      notify(i18n.t("themeCopied", [themeLabel(theme.name)]));
  };
  $("#theme-copy").addEventListener("click", () => void copyTheme());

  const importBox = $<HTMLTextAreaElement>("#theme-json");
  const importButton = $<HTMLButtonElement>("#theme-import");
  const importError = $("#theme-json-error");
  importBox.addEventListener("input", () => {
    importButton.disabled = !importBox.value.trim();
    importError.textContent = "";
    importBox.removeAttribute("aria-invalid");
  });
  importButton.addEventListener("click", () => {
    const themes = importThemes(importBox.value);
    if (!themes?.length) {
      importError.textContent = i18n.t("themeImportInvalid", [i18n.t("themeCopy")]);
      importBox.setAttribute("aria-invalid", "true");
      importBox.focus();
      return;
    }
    appearance = { theme: themes[0]!.id, themes: [...appearance.themes, ...themes] };
    importBox.value = "";
    importButton.disabled = true;
    render();
    onChange();
    notify(i18n.t("themesImported", themes.length, [themes.length]));
    select.focus();
  });

  let previewLoading: Promise<void> | null = null;
  const loadPreview = async () => {
    const [{ createDemo }, { SAMPLE_PULL_REQUEST }] = await Promise.all([
      import("@/components/demo/demo"),
      import("@/utils/demo-sample/demo-sample"),
    ]);
    preview = createDemo(
      $("#preview"),
      { ...SAMPLE_PULL_REQUEST, files: SAMPLE_PULL_REQUEST.files.slice(0, 2) },
      {
        onSettings: () => {
          $("#global-h").focus();
        },
        theme: await appearanceCss(appearance),
      },
    );
    showDefaults();
  };

  return {
    render: (next: Appearance) => {
      appearance = next;
      previewLoading ??= loadPreview();
      render();
    },
    check: (): boolean => {
      const theme = current();
      if (!theme) return true;
      const rows = [...list.querySelectorAll<HTMLElement>(".color")];
      const colorsOk = rows.map((row) => rowChecks.get(row)?.() ?? true).every(Boolean);
      const named = Boolean(name.value.trim());
      nameError.textContent = named ? "" : i18n.t("errorThemeName");
      if (named) name.removeAttribute("aria-invalid");
      else name.setAttribute("aria-invalid", "true");
      if (!named) name.focus();
      else if (!colorsOk) document.querySelector<HTMLElement>('.color-hex[aria-invalid="true"]')?.focus();
      return named && colorsOk;
    },
    value: (): Appearance => normalizeAppearance(appearance),
  };
};
