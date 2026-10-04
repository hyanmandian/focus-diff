import { describe, expect, it } from 'vitest';
import { PROVIDERS, providerNames } from '@/providers/providers';
import {
  appearanceCss,
  createStyler,
  customThemeCss,
  importThemes,
  normalizeAppearance,
  shareTheme,
  SITE_THEME,
  themeOf,
} from '@/utils/appearance/appearance';

const pink = { id: 'pink', name: 'Pink', colors: { accent: '#bf3989', 'selected-bg': '#bf3989' } };

describe('normalizeAppearance', () => {
  it('keeps the chosen theme when it exists, and only valid colours of named themes', () => {
    const appearance = normalizeAppearance({
      theme: 'pink',
      themes: [{ id: 'pink', name: ' Pink ', colors: { accent: '#BF3989', fg: 'red', bg: '#fff;}', nope: '#000' } }, { name: '' }, 'junk'],
    });
    expect(appearance).toEqual({ theme: 'pink', themes: [{ id: 'pink', name: 'Pink', colors: { accent: '#bf3989' } }] });
  });

  it("falls back to the site's theme, and gives clashing ids new ones", () => {
    const appearance = normalizeAppearance({ theme: 'gone', themes: [{ id: 'github', name: 'Mine', colors: {} }] });
    expect(appearance.theme).toBe(SITE_THEME);
    expect(appearance.themes[0]?.id).not.toBe('github');
    expect(normalizeAppearance('junk')).toEqual({ theme: SITE_THEME, themes: [] });
  });
});

describe('sharing themes', () => {
  it('copies the name and colours, and imports one theme or many with new ids', () => {
    const shared = shareTheme(pink);
    expect(JSON.parse(shared)).toEqual({ name: 'Pink', colors: pink.colors });
    const [imported] = importThemes(shared) ?? [];
    expect(imported).toMatchObject({ name: 'Pink', colors: pink.colors });
    expect(imported?.id).not.toBe('pink');
    expect(importThemes(`[${shared}, {"name": "Blue", "colors": {"accent": "#0969da"}}]`)).toHaveLength(2);
    expect(importThemes('not json')).toBeNull();
    expect(importThemes('{"colors": {}}')).toEqual([]);
  });
});

describe('themeOf', () => {
  it('picks the chosen provider, else the site the bar is on, else the first one', () => {
    const [first] = PROVIDERS;
    expect(themeOf({ theme: 'github', themes: [] }, 'elsewhere')).toBe(first);
    expect(themeOf({ theme: SITE_THEME, themes: [] }, 'github')).toBe(first);
    expect(themeOf({ theme: 'pink', themes: [pink] })).toBe(first);
  });
});

describe('customThemeCss', () => {
  it('sets only valid colours', () => {
    expect(customThemeCss({ ...pink, colors: { accent: '#bf3989', fg: 'red; }' } })).toBe(':host {\n  --fd-accent: #bf3989;\n}');
    expect(customThemeCss({ ...pink, colors: {} })).toBe('');
  });
});

describe('appearanceCss', () => {
  it("puts the reader's colours after the site's theme", async () => {
    const css = await appearanceCss({ theme: 'pink', themes: [pink] }, 'github');
    expect(css).toContain('--fd-site-bg:');
    expect(css.indexOf('--fd-accent: #bf3989')).toBeGreaterThan(css.indexOf('--fd-site-bg:'));
    expect(await appearanceCss({ theme: SITE_THEME, themes: [pink] }, 'github')).not.toContain('#bf3989');
  });
});

describe('createStyler', () => {
  it('applies only the latest look when an earlier one is still loading', async () => {
    const applied: string[] = [];
    const restyle = createStyler((css) => applied.push(css));
    const first = restyle({ theme: SITE_THEME, themes: [] });
    const second = restyle({ theme: 'pink', themes: [pink] });
    await Promise.all([first, second]);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain('#bf3989');
  });
});

describe('providerNames', () => {
  it('lists the supported sites', () => {
    expect(providerNames('en')).toBe(PROVIDERS.map((provider) => provider.name).join(', '));
  });
});
