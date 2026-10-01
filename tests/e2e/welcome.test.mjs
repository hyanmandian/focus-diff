import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { axe, settle, setup } from './helpers.mjs';

let env;

before(async () => (env = await setup()));
after(async () => env.close());

const openEmpty = async (path = '/ext/welcome.html', options) => {
  const page = await env.open(path, options);
  await page.evaluate(() => chrome.storage.sync.set({ config: { global: [], repos: [] } }));
  await settle(100);
  return page;
};

const stored = (page) => page.evaluate(async () => (await chrome.storage.sync.get('config')).config.global.map((filter) => filter.name));

describe('welcome page', () => {
  it('explains the extension and lists the examples', async () => {
    const page = await openEmpty();
    assert.equal(await page.$eval('h1', (element) => element.textContent), 'Welcome to Focus Diff');
    assert.equal(await page.$$eval('.steps li', (items) => items.length), 3);
    assert.equal(await page.$$eval('.recipe', (items) => items.length), 7);
    assert.match(await page.$eval('#shortcuts', (element) => element.textContent), /Alt\+Shift\+\./);
    await page.close();
  });

  it('adds and removes an example', async () => {
    const page = await openEmpty();
    await page.click('[data-recipe="stack"] .recipe-toggle');
    await settle(100);
    assert.deepEqual(await stored(page), ['Frontend', 'Backend']);
    assert.equal(await page.$eval('[data-recipe="stack"] .recipe-toggle', (button) => button.getAttribute('aria-pressed')), 'true');
    assert.match(await page.$eval('#toast', (element) => element.textContent), /Added Frontend, Backend/);
    assert.equal(await page.evaluate(() => document.activeElement.closest('.recipe')?.dataset.recipe), 'stack');

    await page.click('[data-recipe="docs"] .recipe-toggle');
    await settle(100);
    assert.deepEqual(await stored(page), ['Frontend', 'Backend', 'Docs']);

    await page.click('[data-recipe="stack"] .recipe-toggle');
    await settle(100);
    assert.deepEqual(await stored(page), ['Docs']);
    await page.close();
  });

  it('has no accessibility violations and no horizontal scroll', async () => {
    for (const [scheme, width] of [['light', 1280], ['dark', 390]]) {
      const page = await openEmpty('/ext/welcome.html', { scheme, width });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${scheme} ${width}`);
      assert.deepEqual(await axe(page), [], `${scheme} ${width}`);
      await page.close();
    }
  });

  it('speaks Brazilian Portuguese, including the filter names it adds', async () => {
    const page = await openEmpty('/ext/welcome.html?locale=pt_BR');
    assert.equal(await page.$eval('h1', (element) => element.textContent), 'Boas-vindas ao Focus Diff');
    await page.click('[data-recipe="tests"] .recipe-toggle');
    await settle(100);
    assert.deepEqual(await stored(page), ['Código', 'Testes']);
    await page.close();
  });

  it('throws no page errors', () => assert.deepEqual(env.errors, []));
});
