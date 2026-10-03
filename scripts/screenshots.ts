/**
 * Takes the store and README screenshots of the built extension on a real pull request:
 *
 *   npm run screenshots -- https://github.com/<owner>/<repo>/pull/<number>/files
 *
 * It loads .output/chrome-mv3, sets up the Frontend, Backend and Docs examples, picks Frontend, and writes
 * store/screenshots/: store-1280x800-{light,dark}.png (the store's exact size), pull-request.png, and readme.png, which
 * frames pull-request.png with the bar zoomed in. Signed out, so no account shows. Optimise the PNGs afterwards.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { RECIPES } from '../src/utils/recipes.ts';
import en from '../src/locales/en.json' with { type: 'json' };

const url = process.argv[2];
if (!url) throw new Error('Pass the pull request files URL, like https://github.com/owner/repo/pull/1/files');
const extension = path.resolve('.output/chrome-mv3');
const out = path.resolve('store/screenshots');
const messages: Record<string, unknown> = en;

/** The examples the welcome page offers, named as in English. */
const EXAMPLES = [
  ['stack', 'recipeStackFrontend'],
  ['stack', 'recipeStackBackend'],
  ['docs', 'recipeDocsName'],
].map(([recipe, name], index) => {
  const filter = RECIPES.find((each) => each.id === recipe)?.filters.find((each) => each.name === name);
  return { id: `example-${index}`, name: String(messages[name ?? '']), include: filter?.include ?? '', exclude: filter?.exclude ?? '' };
});

const open = async (colorScheme: 'light' | 'dark', width: number, height: number, deviceScaleFactor = 1) => {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    locale: 'en-US',
    colorScheme,
    viewport: { width, height },
    deviceScaleFactor,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--lang=en-US'],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate((global) => chrome.storage.sync.set({ config: { global, repos: [] } }), EXAMPLES);
  // The welcome page opens on install; only the pull request is wanted.
  for (const page of context.pages()) await page.close();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const bar = page.locator('focus-diff-panel .panel');
  await bar.waitFor();
  await bar.getByRole('button', { name: /^Frontend/ }).click();
  // GitHub keeps loading files after the first paint: wait until the bar has read the same totals
  // for two seconds, so every shot counts the whole pull request, then let the cells finish flipping.
  let last = '';
  for (let stable = 0, tries = 0; stable < 4 && tries < 60; tries += 1) {
    await page.waitForTimeout(500);
    const text = await bar.innerText();
    stable = text === last ? stable + 1 : 0;
    last = text;
  }
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(500);
  return { context, page, bar };
};

/** From the pull request's title down, without GitHub's site header. */
const titleTop = (page: Page) =>
  page.evaluate(() => {
    const title = document.querySelector('.gh-header-title, [data-component="PH_Title"], h1');
    return Math.max(0, Math.round((title?.getBoundingClientRect().top ?? 0) - 24));
  });

const close = (context: BrowserContext) => context.close();

for (const scheme of ['light', 'dark'] as const) {
  const { context, page } = await open(scheme, 1280, 800);
  await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), await titleTop(page));
  await page.screenshot({ path: `${out}/store-1280x800-${scheme}.png` });
  await close(context);
}

// At twice the pixels, so the zoomed-in bar stays sharp; the page itself is kept at its CSS size.
// The viewport is the shot's own size, scrolled to the title, so the bar, fixed to the bottom of the
// viewport, sits inside the frame.
const { context, page, bar } = await open('dark', 1871, 807, 2);
await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), await titleTop(page));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/pull-request.png`, scale: 'css' });
const box = await bar.boundingBox();
const zoomed = await bar.screenshot({ scale: 'device' });
await close(context);

// The README frame: the page on a gradient, its bar ringed and shown again larger above it.
const framer = await chromium.launch();
const frame = await framer.newPage({ viewport: { width: 1991, height: 951 } });
const image = (buffer: Buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
const shot = readFileSync(`${out}/pull-request.png`);
const ring = box ? { left: 60 + box.x - 6, top: 60 + box.y - 6, width: box.width + 12, height: box.height + 12 } : null;
await frame.setContent(`<!doctype html><style>
  body { margin: 0; width: 1991px; height: 951px; background: linear-gradient(135deg, #2f4fa8, #6a4fc8 55%, #b05aa8); }
  .window { position: absolute; left: 60px; top: 60px; width: 1871px; height: 807px; border-radius: 14px; overflow: hidden;
    box-shadow: 0 0 0 1px #3d444d, 0 30px 60px rgba(1, 4, 9, 0.5); }
  .ring { position: absolute; border: 4px solid #4493f8; border-radius: 18px; }
  .zoom { position: absolute; right: 76px; bottom: 150px; height: 90px; border-radius: 22px; box-shadow: 0 24px 48px rgba(1, 4, 9, 0.6); }
</style><div class="window"><img src="${image(shot)}"></div>${
  ring ? `<div class="ring" style="left:${ring.left}px;top:${ring.top}px;width:${ring.width}px;height:${ring.height}px"></div>` : ''
}<img class="zoom" src="${image(zoomed)}">`);
await frame.screenshot({ path: `${out}/readme.png` });
await framer.close();
