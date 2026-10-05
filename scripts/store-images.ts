/**
 * Makes the Chrome Web Store images from the built extension on two public pull requests, in English and Brazilian
 * Portuguese:
 *
 *   npm run store-images
 *
 * Writes store/images/<locale>/: five 1280×800 screenshots, the 440×280 small tile and the 1400×560 marquee. Each is
 * a real capture at twice the pixels, framed with a headline in the look of focus-diff.com. GitHub stays in English
 * (signed out); the extension's own text follows the locale. The headlines quote the pull requests' counts, so check
 * them if GitHub's file lists change.
 */
import { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';

const BUILD = path.resolve('.output/chrome-mv3');
const LOGO = `data:image/png;base64,${readFileSync('store/logo/focus-diff-1024.png').toString('base64')}`;
const FILES = 'https://github.com/withastro/astro/pull/16488/files';
const CONVERSATIONS = 'https://github.com/withastro/astro/pull/16366/files';
const VIEWPORT = { width: 1200, height: 680 };
const PAGES = { width: 1200, height: 900 };
/** GitHub's own top bar, in CSS pixels, which adds nothing to a shot. */
const GITHUB_HEADER = 72;

/** The UI side and the server side of Astro, with tests, changelogs and manifests in neither. */
const EXCLUDE = '(^|/)(tests?|e2e|fixtures)/|\\.(test|spec)\\.|CHANGELOG\\.md$|(package|tsconfig[^/]*)\\.json$';
const FILTERS = [
  {
    id: 'frontend',
    name: 'Frontend',
    include:
      '\\.(astro|css|jsx|tsx|vue|svelte)$|/(assets|client|components|toolbar|transitions)/|^packages/integrations/(alpinejs|markdoc|mdx|preact|react|solid|svelte|vue)/',
    exclude: EXCLUDE,
  },
  {
    id: 'backend',
    name: 'Backend',
    include:
      '^packages/astro/src/(actions|cli|config|container|content|core|entrypoints|env|i18n|manifest|runtime/server|types|vite-plugin-[^/]+)/|^packages/(db|markdown/[^/]+|integrations/(cloudflare|netlify|node|vercel))/src/',
    exclude: EXCLUDE,
  },
];
/** Files each filter shows once GitHub has loaded the whole pull request. */
const COUNTS: Record<string, Record<string, number>> = {
  [FILES]: { Frontend: 20, Backend: 123 },
  [CONVERSATIONS]: { Frontend: 7, Backend: 48 },
};
const GRAPE = { id: 'grape', name: 'Grape', colors: { 'selected-bg': '#8957e5', bg: '#2a1b4d', border: '#a371f7', accent: '#d2a8ff' } };

const COPY = {
  en: {
    all: 'All',
    tagline: 'Review only the code that matters.',
    lede: 'Filter GitHub pull requests by file pattern and see how much is left to review.',
    shots: {
      filter: ['Review one part of a pull request at a time', 'Pick a filter and the diff shows only its files: 20 of 465.'],
      breakdown: ['See how much is left to review', 'Files, lines and review time for every filter, side by side.'],
      conversations: ['Step through every conversation', 'Go from one thread to the next and see which ones wait on you.'],
      settings: ['Write your own filters', 'Match files by pattern, for every repository or only one.'],
      theme: ['Make the bar yours', 'Pick its colours with a live preview, or follow GitHub’s light and dark themes.'],
    },
  },
  'pt-BR': {
    all: 'Todos',
    tagline: 'Revise só o código que importa.',
    lede: 'Filtre pull requests do GitHub por padrão de arquivo e veja quanto falta revisar.',
    shots: {
      filter: ['Revise uma parte do pull request de cada vez', 'Escolha um filtro e o diff mostra só os arquivos dele: 20 de 465.'],
      breakdown: ['Veja quanto falta revisar', 'Arquivos, linhas e tempo de revisão de cada filtro, lado a lado.'],
      conversations: ['Passe por todas as conversas', 'Vá de uma conversa para a próxima e veja quais esperam por você.'],
      settings: ['Crie seus próprios filtros', 'Separe arquivos por padrão, para todos os repositórios ou só um.'],
      theme: ['Deixe a barra do seu jeito', 'Escolha as cores com prévia ao vivo, ou siga os temas claro e escuro do GitHub.'],
    },
  },
};
type Locale = keyof typeof COPY;
type Shot = keyof (typeof COPY)['en']['shots'];

const image = (buffer: Buffer) => `data:image/png;base64,${buffer.toString('base64')}`;

/**
 * Chromium on macOS ignores --lang for the extension's own text, so another language goes in a copy of the build,
 * as its default.
 */
const extensionFor = (locale: Locale) => {
  if (locale === 'en') return BUILD;
  const copy = path.resolve('.output/store-images', locale);
  rmSync(copy, { recursive: true, force: true });
  cpSync(BUILD, copy, { recursive: true });
  copyFileSync(path.join(BUILD, '_locales', locale.replace('-', '_'), 'messages.json'), path.join(copy, '_locales/en/messages.json'));
  return copy;
};

const capture = async (locale: Locale) => {
  const extension = extensionFor(locale);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    locale,
    colorScheme: 'dark',
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--lang=${locale}`, '--hide-scrollbars'],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const store = (value: Record<string, unknown>) => worker.evaluate((value) => chrome.storage.sync.set(value), value);
  await store({ config: { global: FILTERS, repos: [] } });
  // The welcome page opens on install.
  await new Promise((resolve) => setTimeout(resolve, 800));
  for (const page of context.pages()) await page.close();

  const shots = {} as Record<Shot | 'bar', Buffer>;
  const chip = (bar: Locator, name: string) => bar.getByRole('button', { name: new RegExp(`^${name}`) });
  const settle = async (page: Page, ms = 1000) => {
    await page.mouse.move(VIEWPORT.width - 4, 300);
    await page.waitForTimeout(ms);
  };

  const pullRequest = async (url: string) => {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const bar = page.locator('focus-diff-panel .panel');
    await bar.waitFor({ timeout: 60_000 });
    // GitHub keeps loading files after the first paint: wait until every filter has its whole count.
    for (let tries = 0; tries < 180; tries++) {
      const text = (await bar.innerText()).replace(/\s+/g, '');
      if (Object.entries(COUNTS[url] ?? {}).every(([name, count]) => text.includes(`${name}${count}`))) break;
      if (tries % 10 === 9) await page.evaluate(() => scrollBy(0, 3000));
      await page.waitForTimeout(1000);
    }
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(1500);
    return { page, bar };
  };

  const settings = async () => {
    const page = await context.newPage();
    await page.setViewportSize(PAGES);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('#preview .demo-bar .panel').waitFor();
    await settle(page, 1500);
    return page;
  };

  {
    const { page, bar } = await pullRequest(FILES);
    await chip(bar, 'Frontend').click();
    await settle(page, 2500);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await settle(page, 800);
    shots.filter = await page.screenshot({ animations: 'disabled' });
    shots.bar = await bar.screenshot({ animations: 'disabled' });
    await bar.locator('.breakdown-toggle').click();
    await settle(page, 1200);
    shots.breakdown = await page.screenshot({ animations: 'disabled' });
    await page.close();
  }

  {
    const { page, bar } = await pullRequest(CONVERSATIONS);
    // The filter picked on the last pull request of the same repository carries over.
    await chip(bar, COPY[locale].all).click();
    await page.waitForTimeout(1200);
    await bar.locator('.comments:not([aria-disabled="true"])').click({ timeout: 60_000 });
    await page.waitForTimeout(1200);
    // The second conversation is one still waiting on the reader.
    const next = page.locator('focus-diff-panel .conversations .step').nth(1);
    const position = page.locator('focus-diff-panel .conversation-position');
    for (let step = 0; step < 10 && !(await position.innerText()).startsWith('2/'); step++) {
      await next.click();
      await page.waitForTimeout(1800);
    }
    await settle(page, 1500);
    shots.conversations = await page.screenshot({ animations: 'disabled' });
    await page.close();
  }

  {
    const page = await settings();
    shots.settings = await page.screenshot({ animations: 'disabled' });
    await page.close();
  }

  {
    await store({ appearance: { theme: GRAPE.id, themes: [GRAPE] } });
    const page = await settings();
    // The index's link scrolls the section in below the sticky preview, as a reader sees it.
    await page.locator('nav a[href="#appearance"]').click();
    await settle(page, 1500);
    shots.theme = await page.screenshot({ animations: 'disabled' });
    await page.close();
  }

  await context.close();
  return shots;
};

const BASE = `
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    background: radial-gradient(1100px 620px at 50% -12%, #16263a 0%, #0b0f14 68%) no-repeat, #0b0f14;
    color: #f0f6fc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  h1 { font-weight: 800; letter-spacing: -0.035em; line-height: 1.08; text-wrap: balance; }
  p { color: #9198a1; text-wrap: balance; }
  .window {
    position: absolute;
    overflow: hidden;
    border: 1px solid rgba(240, 246, 252, 0.16);
    border-radius: 14px;
    background: #0d1117;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.4);
  }
  .window img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; letter-spacing: -0.02em; }
  .brand img { border-radius: 22%; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45); }
`;

/** A capture in a window `width` wide; pull request shots start below GitHub's own top bar. */
const frame = (shot: Buffer, width: number, fromTop: boolean) =>
  `<img src="${image(shot)}" style="object-position: center -${fromTop ? 0 : (GITHUB_HEADER * width) / VIEWPORT.width}px">`;

const screenshot = (shot: Buffer, fromTop: boolean, [title, lede]: string[]) => `
  <style>${BASE}
    header { display: grid; justify-items: center; gap: 10px; padding: 34px 80px 0; text-align: center; }
    h1 { font-size: 40px; }
    p { font-size: 19px; line-height: 1.4; }
    .window { left: 80px; top: 186px; width: 1120px; height: 567px; }
  </style>
  <header><h1>${title}</h1><p>${lede}</p></header>
  <div class="window">${frame(shot, 1120, fromTop)}</div>`;

const tile = (bar: Buffer, tagline: string) => `
  <style>${BASE}
    body { display: grid; align-content: center; justify-items: center; gap: 12px; text-align: center; }
    .brand { font-size: 34px; }
    p { font-size: 15px; color: #c9d1d9; }
    .bar { width: 380px; height: 44px; margin-top: 14px; overflow: hidden; border-radius: 12px 0 0 12px; mask-image: linear-gradient(90deg, #000 70%, transparent); }
    .bar img { display: block; height: 44px; }
  </style>
  <div class="brand"><img src="${LOGO}" width="56" height="56">Focus Diff</div>
  <p>${tagline}</p>
  <div class="bar"><img src="${image(bar)}"></div>`;

const marquee = (shot: Buffer, tagline: string, lede: string) => `
  <style>${BASE}
    body { background: radial-gradient(900px 560px at 18% 20%, #16263a 0%, #0b0f14 70%) no-repeat, #0b0f14; }
    .text { position: absolute; left: 72px; top: 0; bottom: 0; width: 440px; display: grid; align-content: center; gap: 18px; }
    .brand { font-size: 26px; }
    h1 { font-size: 46px; }
    p { font-size: 20px; line-height: 1.45; }
    .window { left: 556px; top: 80px; width: 790px; height: 400px; }
  </style>
  <div class="text">
    <div class="brand"><img src="${LOGO}" width="48" height="48">Focus Diff</div>
    <h1>${tagline}</h1>
    <p>${lede}</p>
  </div>
  <div class="window">${frame(shot, 790, false)}</div>`;

/** Chromium's screenshots are 24-bit PNGs with no alpha, which is what the store takes. */
const render = async (browser: Browser, html: string, width: number, height: number, file: string) => {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><meta charset="utf-8">${html}`, { waitUntil: 'load' });
  await page.screenshot({ path: file });
  await page.close();
};

const browser = await chromium.launch();
for (const locale of Object.keys(COPY) as Locale[]) {
  const copy = COPY[locale];
  const shots = await capture(locale);
  const out = path.resolve('store/images', locale);
  mkdirSync(out, { recursive: true });
  for (const [index, name] of (Object.keys(copy.shots) as Shot[]).entries()) {
    const fromTop = name === 'settings' || name === 'theme';
    await render(
      browser,
      screenshot(shots[name], fromTop, copy.shots[name]),
      1280,
      800,
      path.join(out, `screenshot-${index + 1}-${name}.png`),
    );
  }
  await render(browser, tile(shots.bar, copy.tagline), 440, 280, path.join(out, 'small-tile-440x280.png'));
  await render(browser, marquee(shots.filter, copy.tagline, copy.lede), 1400, 560, path.join(out, 'marquee-1400x560.png'));
  console.log(`store/images/${locale}`);
}
await browser.close();
