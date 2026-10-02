import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vite-plus/test';
import { axe, settle, setup } from './helpers.mjs';

let env;

beforeAll(async () => (env = await setup()));
afterAll(async () => env.close());

const type = (page, selector, value) =>
  page.evaluate(
    (target, text) => {
      const input = document.querySelector(target);
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selector,
    value,
  );

const stored = (page) => page.evaluate(async () => (await chrome.storage.sync.get('config')).config);

describe('settings page', () => {
  it('renders the saved filters with every string translated', async () => {
    const page = await env.open('/ext/options.html');
    const names = await page.$$eval('#global .f-name', (inputs) => inputs.map((input) => input.value));
    assert.deepEqual(names, ['Frontend', 'Backend', 'Docs']);
    const untranslated = await page.evaluate(
      () => [...document.querySelectorAll('[data-i18n], [data-i18n-html]')].filter((element) => !element.textContent.trim()).length,
    );
    assert.equal(untranslated, 0);
    await page.close();
  });

  it('blocks saving an invalid regex and focuses it', async () => {
    const page = await env.open('/ext/options.html');
    await type(page, '#global .filter:first-child .f-exclude', '(');
    await page.click('#save');
    await settle(50);
    assert.match(await page.$eval('#status', (element) => element.textContent), /need fixing/);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('f-exclude')), true);
    assert.match(await page.$eval('#global .filter:first-child .error', (element) => element.textContent), /isn't a valid regex/);
    await page.close();
  });

  it('saves repository filters', async () => {
    const page = await env.open('/ext/options.html#repo=octo/web');
    assert.match(await page.$eval('#add-repo', (element) => element.textContent), /octo\/web/);
    await page.click('#add-repo');
    await page.click('.repo .add-filter');
    await type(page, '.repo .f-name', 'API');
    await type(page, '.repo .f-include', '^api/');
    await page.click('#save');
    await settle(50);
    assert.deepEqual(
      (await stored(page)).repos.map((entry) => [entry.repo, entry.filters.map((filter) => filter.name)]),
      [['octo/web', ['API']]],
    );
    await page.close();
  });

  it('checks a path against the filters', async () => {
    const page = await env.open('/ext/options.html');
    await type(page, '#try-path', 'web/src/book-card.tsx');
    assert.equal(await page.$eval('#try-result', (element) => element.textContent), 'Shown by All and Frontend.');
    await type(page, '#try-path', 'web/src/book-card.test.tsx');
    assert.match(await page.$eval('#try-result', (element) => element.textContent), /Only All shows this file/);
    await page.close();
  });

  it('imports a teammate setup and rejects garbage', async () => {
    const page = await env.open('/ext/options.html');
    await type(page, '#json', 'not json');
    await page.click('#import');
    assert.match(await page.$eval('#json-error', (element) => element.textContent), /isn't a copied set of filters/);
    await type(page, '#json', JSON.stringify({ global: [{ name: 'Only', include: 'x' }] }));
    await page.click('#import');
    await settle(50);
    assert.deepEqual(await page.$$eval('#global .f-name', (inputs) => inputs.map((input) => input.value)), ['Only']);
    assert.equal(await page.$eval('#toast', (element) => element.textContent), 'Imported 1 filter. Review it, then save.');
    await page.close();
  });

  it('has no accessibility violations and no horizontal scroll', async () => {
    for (const [scheme, width] of [
      ['light', 1280],
      ['dark', 390],
    ]) {
      const page = await env.open('/ext/options.html#repo=octo/web', { scheme, width });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${scheme} ${width}`);
      assert.deepEqual(await axe(page), [], `${scheme} ${width}`);
      await page.close();
    }
  });

  it('speaks Brazilian Portuguese', async () => {
    const page = await env.open('/ext/options.html?locale=pt_BR');
    assert.equal(await page.$eval('#save', (element) => element.textContent), 'Salvar');
    assert.equal(await page.$eval('#global-h', (element) => element.textContent), 'Todos os repositórios');
    await page.close();
  });

  it('throws no page errors', () => assert.deepEqual(env.errors, []));
});
