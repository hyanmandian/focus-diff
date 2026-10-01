import { audit } from './accessibility.mjs';
import { launch } from './browser.mjs';
import { startServer } from './server.mjs';

export const setup = async () => {
  const { server, origin } = await startServer();
  const browser = await launch();
  const errors = [];
  const open = async (path, { scheme = 'light', width = 1280 } = {}) => {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: scheme },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
    await page.setViewport({ width, height: 900 });
    await page.goto(`${origin}${path}`);
    return page;
  };
  const close = async () => {
    await browser.close();
    server.close();
  };
  return { open, close, errors, origin, browser };
};

export const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

export const axe = (page, include) => audit(page, include ?? 'html');

export const panelState = (page) =>
  page.evaluate(() => {
    const host = [...document.documentElement.children].find((element) => element.shadowRoot);
    const root = host?.shadowRoot;
    const visiblePaths = [...document.querySelectorAll('[role="region"][id^="diff-"]:not([id$="-hunk"])')]
      .filter((region) => region.offsetParent !== null)
      .map((region) => document.getElementById(region.getAttribute('aria-labelledby')).textContent.replace(/‎/g, ''));
    const treeFiles = [...document.querySelectorAll('[role="treeitem"]:not([aria-expanded])')]
      .filter((item) => item.offsetParent !== null)
      .map((item) => item.textContent.trim());
    return {
      present: Boolean(host?.isConnected),
      options: [...(root?.querySelectorAll('.option') ?? [])].map((option) => option.textContent),
      checked: [...(root?.querySelectorAll('.option[aria-pressed="true"]') ?? [])].map((option) => option.textContent).join(' + ') || undefined,
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

export const clickFilter = (page, name, { shift = false } = {}) =>
  page.evaluate(
    (label, shiftKey) => {
      const root = [...document.documentElement.children].find((element) => element.shadowRoot).shadowRoot;
      const option = [...root.querySelectorAll('.option')].find((candidate) => candidate.textContent === label);
      option.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey }));
    },
    name,
    shift,
  );
