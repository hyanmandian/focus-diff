import { PROVIDERS, type ProviderInfo } from '@/providers/providers';

/** The bar's look: a theme, which is a provider's or the site's own, and the reader's CSS on top of it. */
export interface Appearance {
  /** A provider's id, or `SITE_THEME` for the theme of whichever site the bar is on. */
  theme: string;
  css: string;
}

export const SITE_THEME = 'site';

export const DEFAULT_APPEARANCE: Appearance = { theme: SITE_THEME, css: '' };

/** The `--fd-*` properties a theme sets, which the reader's CSS can set too. */
export const THEME_PROPERTIES = [
  '--fd-bg',
  '--fd-fg',
  '--fd-muted',
  '--fd-border',
  '--fd-border-muted',
  '--fd-hover',
  '--fd-selected-bg',
  '--fd-selected-fg',
  '--fd-accent',
  '--fd-focus',
  '--fd-add',
  '--fd-del',
  '--fd-attention',
  '--fd-done',
  '--fd-track',
  '--fd-shadow',
  '--fd-font',
  '--fd-mono',
  '--fd-canvas',
  '--fd-canvas-muted',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export const normalizeAppearance = (input: unknown): Appearance => {
  const value = isRecord(input) ? input : {};
  const theme = typeof value.theme === 'string' && PROVIDERS.some((provider) => provider.id === value.theme) ? value.theme : SITE_THEME;
  return { theme, css: typeof value.css === 'string' ? value.css : '' };
};

/**
 * The theme a look picks: the chosen provider's, or with the site's theme, the provider of the site the bar is on.
 * Pages that aren't a review site, like the welcome page, get the first provider's.
 */
export const themeOf = (appearance: Appearance, site?: string): ProviderInfo =>
  PROVIDERS.find((provider) => provider.id === appearance.theme) ?? PROVIDERS.find((provider) => provider.id === site) ?? PROVIDERS[0]!;

/** The CSS that styles the bar: the theme, loaded if it isn't yet, then the reader's own. */
export const appearanceCss = async (appearance: Appearance, site?: string): Promise<string> => {
  const theme = await themeOf(appearance, site).theme();
  return appearance.css.trim() ? `${theme}\n${appearance.css}` : theme;
};

/**
 * Restyles with `apply` as the look changes. A theme may still be loading when the next change comes; only the latest
 * change is applied.
 */
export const createStyler = (apply: (css: string) => void, site?: string) => {
  let latest = 0;
  return async (appearance: Appearance): Promise<void> => {
    const mine = ++latest;
    const css = await appearanceCss(appearance, site);
    if (mine === latest) apply(css);
  };
};
