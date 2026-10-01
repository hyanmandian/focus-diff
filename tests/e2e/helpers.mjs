import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import { startServer } from './server.mjs';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export const setup = async () => {
  const { server, origin } = await startServer();
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const open = async (path, { scheme = 'light', width = 1280 } = {}) => {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: scheme },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
    await page.setViewport({ width, height: 900 });
    await page.goto(`${origin}${path}`, { waitUntil: 'networkidle0' });
    return page;
  };
  const close = async () => {
    await browser.close();
    server.close();
  };
  return { open, close, errors, origin, browser };
};

export const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

export const axe = async (page, include) => {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(
    async (selector) => {
      const context = selector ? { include: [[selector]] } : document;
      const result = await window.axe.run(context, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] });
      return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
    },
    include ?? null,
  );
};

export const panelState = (page) =>
  page.evaluate(() => {
    const host = [...document.documentElement.children].find((element) => element.shadowRoot);
    const root = host?.shadowRoot;
    const visiblePaths = [...document.querySelectorAll('[role="region"][id^="diff-"]:not([id$="-hunk"])')]
      .filter((region) => region.offsetParent !== null)
      .map((region) => region.querySelector('h3').textContent.replace(/‎/g, ''));
    const treeFiles = [...document.querySelectorAll('[role="treeitem"]:not([aria-expanded])')]
      .filter((item) => item.offsetParent !== null)
      .map((item) => item.textContent.trim());
    return {
      present: Boolean(host?.isConnected),
      options: [...(root?.querySelectorAll('[role="radio"]') ?? [])].map((radio) => radio.textContent),
      checked: root?.querySelector('[aria-checked="true"]')?.textContent,
      focused: root?.activeElement?.textContent ?? null,
      stats: (() => {
        const copy = root?.querySelector('.stats')?.cloneNode(true);
        copy?.querySelectorAll('.ghost').forEach((ghost) => ghost.remove());
        return copy?.textContent.replace(/\s+/g, ' ').trim();
      })(),
      status: root?.querySelector('[role="status"]')?.textContent,
      filesCounter: document.querySelector('[aria-current="page"] .Counter').textContent,
      additions: document.querySelector('.summary span:first-child').textContent,
      deletions: document.querySelector('.summary span:last-child').textContent,
      visiblePaths,
      treeFiles,
      panelWidth: Math.round(root?.querySelector('.panel')?.getBoundingClientRect().width ?? 0),
    };
  });

export const clickFilter = (page, name) =>
  page.evaluate((label) => {
    const root = [...document.documentElement.children].find((element) => element.shadowRoot).shadowRoot;
    [...root.querySelectorAll('[role="radio"]')].find((radio) => radio.textContent === label).click();
  }, name);
