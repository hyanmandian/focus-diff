import { PROVIDERS, type ProviderInfo } from '@/providers/providers';
import { newId } from '@/utils/filters/filters';

/** The bar's colours a theme of the reader's own can change, each a `--fd-*` property of the bar. */
export const THEME_COLORS = [
  'bg',
  'fg',
  'muted',
  'border',
  'border-muted',
  'hover',
  'focus',
  'selected-bg',
  'selected-fg',
  'track',
  'accent',
  'add',
  'del',
  'attention',
] as const;

export type ThemeColor = (typeof THEME_COLORS)[number];

/** A theme the reader made: a name and the colours they changed; the others follow the provider's theme. */
export interface CustomTheme {
  id: string;
  name: string;
  colors: Partial<Record<ThemeColor, string>>;
}

/** The bar's look: which theme it wears, and the themes the reader made. */
export interface Appearance {
  /** `PROVIDER_THEME`, a provider's id, or the id of one of `themes`. */
  theme: string;
  themes: CustomTheme[];
}

/** The theme of the provider whose site the bar is on. */
export const PROVIDER_THEME = 'provider';

export const DEFAULT_APPEARANCE: Appearance = { theme: PROVIDER_THEME, themes: [] };

/** A hex colour, with or without alpha: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. */
export const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A theme as it's kept or shared: a trimmed name and only valid colours, in lower case. */
const normalizeTheme = (input: unknown, id: string = newId()): CustomTheme | null => {
  if (!isRecord(input) || typeof input.name !== 'string' || !input.name.trim()) return null;
  const given = isRecord(input.colors) ? input.colors : {};
  const colors: CustomTheme['colors'] = {};
  for (const color of THEME_COLORS) {
    const value = given[color];
    if (typeof value === 'string' && HEX_COLOR.test(value.trim())) colors[color] = value.trim().toLowerCase();
  }
  return { id, name: input.name.trim(), colors };
};

export const normalizeAppearance = (input: unknown): Appearance => {
  const value = isRecord(input) ? input : {};
  const seen = new Set<string>([PROVIDER_THEME, ...PROVIDERS.map((provider) => provider.id)]);
  const themes = (Array.isArray(value.themes) ? value.themes : []).flatMap((entry) => {
    let id = isRecord(entry) && typeof entry.id === 'string' && entry.id ? entry.id : newId();
    while (seen.has(id)) id = newId();
    const theme = normalizeTheme(entry, id);
    if (theme) seen.add(id);
    return theme ? [theme] : [];
  });
  const known = typeof value.theme === 'string' && (seen.has(value.theme) || value.theme === PROVIDER_THEME);
  return { theme: known ? (value.theme as string) : PROVIDER_THEME, themes };
};

/** What sharing a theme copies: its name and colours, without the id it has here. */
export const shareTheme = ({ name, colors }: CustomTheme): string => JSON.stringify({ name, colors }, null, 2);

/** Themes from what a teammate copied: one theme, or a list of them. Each gets a new id. */
export const importThemes = (text: string): CustomTheme[] | null => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  return (Array.isArray(json) ? json : [json]).flatMap((entry) => normalizeTheme(entry) ?? []);
};

/**
 * The provider whose theme the bar wears: the chosen one, or the one the bar is on, which is also what a theme of the
 * reader's own starts from. Pages that aren't a review site, like the welcome page, get the first provider's.
 */
export const themeOf = (appearance: Appearance, current?: string): ProviderInfo =>
  PROVIDERS.find((provider) => provider.id === appearance.theme) ?? PROVIDERS.find((provider) => provider.id === current) ?? PROVIDERS[0]!;

/** A reader's theme as CSS: only valid colours ever make it in. */
export const customThemeCss = (theme: CustomTheme): string => {
  const lines = THEME_COLORS.flatMap((color) => {
    const value = theme.colors[color];
    return value && HEX_COLOR.test(value) ? [`  --fd-${color}: ${value};`] : [];
  });
  return lines.length ? `:host {\n${lines.join('\n')}\n}` : '';
};

/** The CSS that styles the bar: the provider's theme, loaded if it isn't yet, then the reader's colours over it. */
export const appearanceCss = async (appearance: Appearance, current?: string): Promise<string> => {
  const base = await themeOf(appearance, current).theme();
  const custom = appearance.themes.find((theme) => theme.id === appearance.theme);
  const css = custom ? customThemeCss(custom) : '';
  return css ? `${base}\n${css}` : base;
};

/**
 * Restyles with `apply` as the look changes. A theme may still be loading when the next change comes; only the latest
 * change is applied.
 */
export const createStyler = (apply: (css: string) => void, current?: string) => {
  let latest = 0;
  return async (appearance: Appearance): Promise<void> => {
    const mine = ++latest;
    const css = await appearanceCss(appearance, current);
    if (mine === latest) apply(css);
  };
};
