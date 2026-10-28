import { newId } from "@/utils/filters/filters";
import { PROVIDERS, type ProviderInfo } from "@/utils/providers/providers";
import { isRecord } from "@/utils/record/record";

export const THEME_COLORS = [
  "bg",
  "fg",
  "muted",
  "border",
  "border-muted",
  "hover",
  "focus",
  "selected-bg",
  "selected-fg",
  "track",
  "accent",
  "add",
  "del",
  "attention",
] as const;

export type ThemeColor = (typeof THEME_COLORS)[number];

export interface CustomTheme {
  id: string;
  name: string;
  colors: Partial<Record<ThemeColor, string>>;
}

export interface Appearance {
  theme: string;
  themes: CustomTheme[];
}

export const PROVIDER_THEME = "provider";

export const DEFAULT_APPEARANCE: Appearance = { theme: PROVIDER_THEME, themes: [] };

export const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu;

const normalizeTheme = (input: unknown, id: string = newId()): CustomTheme | null => {
  if (!isRecord(input) || typeof input.name !== "string" || !input.name.trim()) return null;
  const given = isRecord(input.colors) ? input.colors : {};
  const colors: CustomTheme["colors"] = {};
  for (const color of THEME_COLORS) {
    const value = given[color];
    if (typeof value === "string" && HEX_COLOR.test(value.trim())) colors[color] = value.trim().toLowerCase();
  }
  return { id, name: input.name.trim(), colors };
};

export const normalizeAppearance = (input: unknown): Appearance => {
  const value = isRecord(input) ? input : {};
  const seen = new Set<string>([PROVIDER_THEME, ...PROVIDERS.map((provider) => provider.id)]);
  const themes = (Array.isArray(value.themes) ? value.themes : []).flatMap((entry) => {
    let id = isRecord(entry) && typeof entry.id === "string" && entry.id ? entry.id : newId();
    while (seen.has(id)) id = newId();
    const theme = normalizeTheme(entry, id);
    if (theme) seen.add(id);
    return theme ? [theme] : [];
  });
  return { theme: typeof value.theme === "string" && seen.has(value.theme) ? value.theme : PROVIDER_THEME, themes };
};

export const shareTheme = ({ name, colors }: CustomTheme): string => JSON.stringify({ name, colors }, null, 2);

export const importThemes = (text: string): CustomTheme[] | null => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  return (Array.isArray(json) ? json : [json]).flatMap((entry) => normalizeTheme(entry) ?? []);
};

export const themeOf = (appearance: Appearance, current?: string): ProviderInfo =>
  PROVIDERS.find((provider) => provider.id === appearance.theme) ??
  PROVIDERS.find((provider) => provider.id === current) ??
  PROVIDERS[0]!;

export const customThemeCss = (theme: CustomTheme): string => {
  const lines = THEME_COLORS.flatMap((color) => {
    const value = theme.colors[color];
    return value && HEX_COLOR.test(value) ? [`  --fd-${color}: ${value};`] : [];
  });
  return lines.length > 0 ? `:host {\n${lines.join("\n")}\n}` : "";
};

export const appearanceCss = async (appearance: Appearance, current?: string): Promise<string> => {
  const base = await themeOf(appearance, current).theme();
  const custom = appearance.themes.find((theme) => theme.id === appearance.theme);
  const css = custom ? customThemeCss(custom) : "";
  return css ? `${base}\n${css}` : base;
};

export const createStyler = (apply: (css: string) => void, current?: string) => {
  let latest = 0;
  return async (appearance: Appearance): Promise<void> => {
    const mine = ++latest;
    const css = await appearanceCss(appearance, current);
    if (mine === latest) apply(css);
  };
};
