import { i18n } from '#i18n';
import { createDemo, type Demo } from '@/components/demo/demo';
import { SAMPLE_PULL_REQUEST } from '@/components/demo/sample';
import { PROVIDERS } from '@/providers/providers';
import {
  appearanceCss,
  createStyler,
  HEX_COLOR,
  importThemes,
  normalizeAppearance,
  shareTheme,
  SITE_THEME,
  THEME_COLORS,
  type Appearance,
  type CustomTheme,
  type ThemeColor,
} from '@/utils/appearance/appearance';
import { newId } from '@/utils/filters/filters';
import { $, translate } from '@/utils/page';

const COLOR_NAMES: Record<ThemeColor, string> = {
  bg: i18n.t('colorBg'),
  fg: i18n.t('colorFg'),
  muted: i18n.t('colorMuted'),
  border: i18n.t('colorBorder'),
  'border-muted': i18n.t('colorBorderMuted'),
  hover: i18n.t('colorHover'),
  focus: i18n.t('colorFocus'),
  'selected-bg': i18n.t('colorSelectedBg'),
  'selected-fg': i18n.t('colorSelectedFg'),
  track: i18n.t('colorTrack'),
  accent: i18n.t('colorAccent'),
  add: i18n.t('colorAdd'),
  del: i18n.t('colorDel'),
  attention: i18n.t('colorAttention'),
};

/** `#rgb`, `#rgba` and `#rrggbbaa` as the `#rrggbb` a colour picker takes; its alpha, if any, is left out. */
const pickerValue = (hex: string): string => {
  const digits = hex.slice(1);
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return `#${full.slice(0, 6).toLowerCase()}`;
};

interface LookOptions {
  /** The reader changed something that isn't saved yet. */
  onChange: () => void;
  /** Says something briefly, like that a theme was copied. */
  notify: (text: string) => void;
}

/**
 * The bar's look in settings: pick a theme, or make one by picking colours, and share it the way filters are shared.
 * The preview, the welcome page's demo on a few of its files, follows every change; pull requests get it once saved.
 */
export const createLook = ({ onChange, notify }: LookOptions) => {
  let appearance: Appearance = normalizeAppearance({});
  /** What's typed in each colour field, valid or not, for the theme being edited. */
  let drafts: Partial<Record<ThemeColor, string>> = {};
  let preview: Demo | null = null;
  const restylePreview = createStyler((css) => {
    preview?.setTheme(css);
    showDefaults();
  });

  const select = $<HTMLSelectElement>('#theme');
  const editor = $('#theme-editor');
  const name = $<HTMLInputElement>('#theme-name');
  const nameError = $('#theme-name-error');
  const list = $('#colors');
  const current = () => appearance.themes.find((theme) => theme.id === appearance.theme);

  /** The colours as the preview shows them, so a colour left to the site's theme still shows what it is. */
  const showDefaults = () => {
    const host = $('#preview').shadowRoot?.querySelector<HTMLElement>('.demo-bar');
    if (!host) return;
    const styles = getComputedStyle(host);
    for (const row of list.querySelectorAll<HTMLElement>('.color')) {
      const hex = $<HTMLInputElement>('.color-hex', row);
      const value = styles.getPropertyValue(`--fd-${row.dataset.color}`).trim();
      if (!HEX_COLOR.test(value)) continue;
      hex.placeholder = value;
      if (!hex.value) $<HTMLInputElement>('.color-pick', row).value = pickerValue(value);
    }
  };

  // The site's colours change with the system's light or dark mode, and so do the ones shown for empty fields.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(showDefaults));

  /** The theme being edited, with its valid colours: what the preview shows while the reader types. */
  const sync = () => {
    const theme = current();
    if (theme) {
      theme.name = name.value;
      theme.colors = Object.fromEntries(Object.entries(drafts).filter(([, value]) => value && HEX_COLOR.test(value)));
    }
    onChange();
    void restylePreview(appearance);
  };

  const colorRow = (color: ThemeColor) => {
    const template = $<HTMLTemplateElement>('#color-template').content.firstElementChild!.cloneNode(true) as HTMLElement;
    translate(template);
    template.dataset.color = color;
    const id = `color-${color}`;
    const label = $<HTMLLabelElement>('.color-label', template);
    const pick = $<HTMLInputElement>('.color-pick', template);
    const hex = $<HTMLInputElement>('.color-hex', template);
    const reset = $<HTMLButtonElement>('.color-reset', template);
    const error = $('.color-error', template);
    label.textContent = COLOR_NAMES[color];
    label.htmlFor = id;
    hex.id = id;
    error.id = `${id}-error`;
    hex.setAttribute('aria-describedby', error.id);
    pick.setAttribute('aria-label', i18n.t('colorPick', [COLOR_NAMES[color]]));
    reset.setAttribute('aria-label', i18n.t('colorResetLabel', [COLOR_NAMES[color]]));
    hex.value = drafts[color] ?? '';
    if (hex.value && HEX_COLOR.test(hex.value)) pick.value = pickerValue(hex.value);

    const check = () => {
      const valid = !hex.value || HEX_COLOR.test(hex.value);
      error.textContent = valid ? '' : i18n.t('errorColor');
      if (valid) hex.removeAttribute('aria-invalid');
      else hex.setAttribute('aria-invalid', 'true');
      return valid;
    };
    hex.addEventListener('input', () => {
      drafts[color] = hex.value.trim();
      if (HEX_COLOR.test(drafts[color]!)) pick.value = pickerValue(drafts[color]!);
      if (hex.hasAttribute('aria-invalid')) check();
      sync();
    });
    hex.addEventListener('blur', check);
    pick.addEventListener('input', () => {
      hex.value = pick.value;
      drafts[color] = pick.value;
      check();
      sync();
    });
    reset.addEventListener('click', () => {
      hex.value = '';
      delete drafts[color];
      check();
      sync();
      hex.focus();
    });
    (template as HTMLElement & { check: () => boolean }).check = check;
    return template;
  };

  const renderEditor = () => {
    const theme = current();
    editor.hidden = !theme;
    $('#theme-export-fallback').hidden = true;
    if (!theme) return;
    name.value = theme.name;
    nameError.textContent = '';
    name.removeAttribute('aria-invalid');
    drafts = { ...theme.colors };
    list.replaceChildren(...THEME_COLORS.map(colorRow));
    showDefaults();
  };

  const renderSelect = () => {
    select.replaceChildren(
      new Option(i18n.t('themeSite'), SITE_THEME),
      ...PROVIDERS.map((provider) => new Option(provider.name, provider.id)),
      ...appearance.themes.map((theme) => new Option(theme.name.trim() || i18n.t('untitledTheme'), theme.id)),
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

  select.addEventListener('change', () => choose(select.value));
  name.addEventListener('input', () => {
    if (name.value.trim()) {
      nameError.textContent = '';
      name.removeAttribute('aria-invalid');
    }
    const option = select.selectedOptions[0];
    if (option) option.textContent = name.value.trim() || i18n.t('untitledTheme');
    sync();
  });

  /** A new theme starts as the site's: every colour left to it, until one is picked. */
  $('#theme-new').addEventListener('click', () => {
    const theme: CustomTheme = { id: newId(), name: i18n.t('newThemeName', [String(appearance.themes.length + 1)]), colors: {} };
    appearance = { theme: theme.id, themes: [...appearance.themes, theme] };
    render();
    onChange();
    name.focus();
    name.select();
  });

  $('#theme-delete').addEventListener('click', () => {
    const theme = current();
    if (!theme) return;
    appearance = { theme: SITE_THEME, themes: appearance.themes.filter((each) => each !== theme) };
    render();
    onChange();
    notify(i18n.t('themeDeleted', [theme.name.trim() || i18n.t('untitledTheme')]));
    select.focus();
  });

  $('#theme-copy').addEventListener('click', async () => {
    const theme = current();
    if (!theme) return;
    const json = shareTheme(theme);
    try {
      await navigator.clipboard.writeText(json);
      $('#theme-export-fallback').hidden = true;
      notify(i18n.t('themeCopied', [theme.name.trim() || i18n.t('untitledTheme')]));
    } catch {
      const fallback = $<HTMLTextAreaElement>('#theme-export');
      fallback.value = json;
      $('#theme-export-fallback').hidden = false;
      fallback.focus();
      fallback.select();
    }
  });

  const importBox = $<HTMLTextAreaElement>('#theme-json');
  const importButton = $<HTMLButtonElement>('#theme-import');
  const importError = $('#theme-json-error');
  importBox.addEventListener('input', () => {
    importButton.disabled = !importBox.value.trim();
    importError.textContent = '';
    importBox.removeAttribute('aria-invalid');
  });
  importButton.addEventListener('click', () => {
    const themes = importThemes(importBox.value);
    if (!themes?.length) {
      importError.textContent = i18n.t('themeImportInvalid', [i18n.t('themeCopy')]);
      importBox.setAttribute('aria-invalid', 'true');
      importBox.focus();
      return;
    }
    appearance = { theme: themes[0]!.id, themes: [...appearance.themes, ...themes] };
    importBox.value = '';
    importButton.disabled = true;
    render();
    onChange();
    notify(i18n.t('themesImported', themes.length, [themes.length]));
    select.focus();
  });

  return {
    /** Shows a look, like the saved one or one saved elsewhere, with the preview wearing it. */
    render: async (next: Appearance) => {
      appearance = next;
      if (!preview) {
        preview = createDemo(
          $('#preview'),
          { ...SAMPLE_PULL_REQUEST, files: SAMPLE_PULL_REQUEST.files.slice(0, 4) },
          // Settings are this page; the button goes to the filters.
          { onSettings: () => $('#global-h').focus(), theme: await appearanceCss(appearance) },
        );
      }
      render();
    },
    /** Whether the theme being edited can be saved; if not, says why at the field and focuses it. */
    check: (): boolean => {
      const theme = current();
      if (!theme) return true;
      const rows = [...list.querySelectorAll<HTMLElement & { check: () => boolean }>('.color')];
      const colorsOk = rows.map((row) => row.check()).every(Boolean);
      const named = Boolean(name.value.trim());
      nameError.textContent = named ? '' : i18n.t('errorThemeName');
      if (named) name.removeAttribute('aria-invalid');
      else name.setAttribute('aria-invalid', 'true');
      if (!named) name.focus();
      else if (!colorsOk) document.querySelector<HTMLElement>('.color-hex[aria-invalid="true"]')?.focus();
      return named && colorsOk;
    },
    value: (): Appearance => normalizeAppearance(appearance),
  };
};
