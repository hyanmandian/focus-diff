import { describe, expect, it } from 'vitest';
import { PROVIDERS, providerNames } from '@/providers/providers';
import { appearanceCss, createStyler, normalizeAppearance, SITE_THEME, themeOf } from '@/utils/appearance/appearance';

describe('normalizeAppearance', () => {
  it('keeps a known theme and the CSS, and falls back to the site theme', () => {
    expect(normalizeAppearance({ theme: 'github', css: 'a{}' })).toEqual({ theme: 'github', css: 'a{}' });
    expect(normalizeAppearance({ theme: 'nowhere', css: 3 })).toEqual({ theme: SITE_THEME, css: '' });
    expect(normalizeAppearance('junk')).toEqual({ theme: SITE_THEME, css: '' });
  });
});

describe('themeOf', () => {
  it('picks the chosen theme, else the site the bar is on, else the first one', () => {
    const [first] = PROVIDERS;
    expect(themeOf({ theme: 'github', css: '' }, 'elsewhere')).toBe(first);
    expect(themeOf({ theme: SITE_THEME, css: '' }, 'github')).toBe(first);
    expect(themeOf({ theme: SITE_THEME, css: '' })).toBe(first);
  });
});

describe('appearanceCss', () => {
  it("puts the reader's CSS after the theme, which sets every bar colour", async () => {
    const css = await appearanceCss({ theme: SITE_THEME, css: ':host { --fd-accent: red; }' }, 'github');
    expect(css).toContain('--fd-bg:');
    expect(css.indexOf('--fd-accent: red')).toBeGreaterThan(css.indexOf('--fd-bg:'));
  });
});

describe('createStyler', () => {
  it('applies only the latest look when an earlier one is still loading', async () => {
    const applied: string[] = [];
    const restyle = createStyler((css) => applied.push(css));
    const first = restyle({ theme: SITE_THEME, css: '.first {}' });
    const second = restyle({ theme: SITE_THEME, css: '.second {}' });
    await Promise.all([first, second]);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain('.second {}');
  });
});

describe('providerNames', () => {
  it('lists the supported sites', () => {
    expect(providerNames('en')).toBe(PROVIDERS.map((provider) => provider.name).join(', '));
  });
});
