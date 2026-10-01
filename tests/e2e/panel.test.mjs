import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { axe, clickFilter, panelState, settle, setup } from './helpers.mjs';

const PR = '/octo/web/pull/1/changes';
let env;

before(async () => (env = await setup()));
after(async () => env.close());

describe('panel on a pull request', () => {
  it('shows every file with All selected', async () => {
    const page = await env.open(PR);
    await settle();
    const state = await panelState(page);
    assert.equal(state.present, true);
    assert.deepEqual(state.options, ['All', 'Frontend', 'Backend', 'Docs']);
    assert.equal(state.checked, 'All');
    assert.equal(state.visiblePaths.length, 8, 'nested hunk regions are not counted as files');
    assert.match(state.stats, /8\/8 files/);
    assert.equal(state.filesCounter, '8');
    await page.close();
  });

  it('filters diffs, the file tree and the page counters', async () => {
    const page = await env.open(PR);
    await settle();
    await clickFilter(page, 'Frontend');
    await settle();
    let state = await panelState(page);
    assert.deepEqual(state.visiblePaths, ['web/src/book-card.tsx']);
    assert.deepEqual(state.treeFiles, ['book-card.tsx']);
    assert.equal(state.filesCounter, '1/8');
    assert.equal(state.additions, '+40');
    assert.equal(state.deletions, '−10');
    assert.match(state.status, /Frontend: 1 of 8 files, 40 lines added, 10 removed\.$/);

    await clickFilter(page, 'Backend');
    await settle();
    state = await panelState(page);
    assert.deepEqual(state.visiblePaths, ['api/books/service.py', 'api/books/__init__.py', 'api/legacy/routes.py']);
    assert.deepEqual(state.treeFiles, ['__init__.py', 'service.py', 'routes.py']);
    assert.equal(state.filesCounter, '3/8');
    assert.equal(state.additions, '+120', 'keeps GitHub totals while a file has not loaded');
    assert.match(state.status, /haven't loaded yet/);

    await clickFilter(page, 'All');
    await settle();
    state = await panelState(page);
    assert.equal(state.filesCounter, '8');
    assert.equal(state.additions, '+120');
    assert.equal(state.deletions, '−30');
    await page.close();
  });

  it('moves between filters with the keyboard', async () => {
    const page = await env.open(PR);
    await settle();
    await page.evaluate(() => [...document.documentElement.children].find((e) => e.shadowRoot).shadowRoot.querySelector('[role="radio"]').focus());
    await page.keyboard.press('ArrowRight');
    await settle();
    assert.equal((await panelState(page)).checked, 'Frontend');
    assert.equal((await panelState(page)).focused, 'Frontend');
    await page.keyboard.press('End');
    await settle();
    assert.equal((await panelState(page)).checked, 'Docs');
    await page.keyboard.press('ArrowRight');
    await settle();
    assert.equal((await panelState(page)).checked, 'All');
    await page.close();
  });

  it('follows the keyboard shortcuts sent by the background worker', async () => {
    const page = await env.open(PR);
    await settle();
    await page.evaluate(() => window.__dispatch({ type: 'command', command: 'next-filter' }));
    await settle();
    assert.equal((await panelState(page)).checked, 'Frontend');
    await page.evaluate(() => window.__dispatch({ type: 'command', command: 'previous-filter' }));
    await page.evaluate(() => window.__dispatch({ type: 'command', command: 'previous-filter' }));
    await settle();
    assert.equal((await panelState(page)).checked, 'Docs');
    await page.evaluate(() => window.__dispatch({ type: 'command', command: 'show-all' }));
    await settle();
    assert.equal((await panelState(page)).checked, 'All');
    await page.close();
  });

  it('keeps the panel the same width when switching filters', async () => {
    const page = await env.open(PR);
    await settle();
    const widths = [(await panelState(page)).panelWidth];
    for (const name of ['Frontend', 'Docs', 'Backend', 'All']) {
      await clickFilter(page, name);
      await settle();
      widths.push((await panelState(page)).panelWidth);
    }
    assert.equal(new Set(widths).size, 1, `widths changed: ${widths.join(', ')}`);
    await page.close();
  });

  it('comes back after GitHub replaces the page body', async () => {
    const page = await env.open(PR);
    await settle();
    await clickFilter(page, 'Docs');
    await settle();
    await page.evaluate(() => {
      const fresh = document.body.cloneNode(true);
      fresh.querySelectorAll('[style]').forEach((element) => element.removeAttribute('style'));
      [...document.documentElement.children].find((element) => element.shadowRoot).remove();
      document.body.replaceWith(fresh);
    });
    await settle(400);
    const state = await panelState(page);
    assert.equal(state.present, true);
    assert.deepEqual(state.visiblePaths, ['docs/books.md']);
    await page.close();
  });

  it('opens the settings for the current repository', async () => {
    const page = await env.open(PR);
    await settle();
    await page.evaluate(() => [...document.documentElement.children].find((e) => e.shadowRoot).shadowRoot.querySelector('.settings').click());
    assert.deepEqual(await page.evaluate(() => window.__sent), [{ type: 'open-options', repo: 'octo/web' }]);
    await page.close();
  });

  it('has no accessibility violations in light and dark themes', async () => {
    for (const scheme of ['light', 'dark']) {
      const page = await env.open(PR, { scheme });
      await settle();
      await clickFilter(page, 'Frontend');
      await settle();
      assert.deepEqual(await axe(page, 'html > div:last-child'), [], scheme);
      await page.close();
    }
  });

  it('speaks Brazilian Portuguese', async () => {
    const page = await env.open(`${PR}?locale=pt_BR`);
    await settle();
    const state = await panelState(page);
    assert.equal(state.options[0], 'Todos');
    assert.match(state.stats, /8\/8 arquivos/);
    await page.close();
  });

  it('stays hidden outside pull request diffs', async () => {
    const page = await env.open('/octo/web/pull/1');
    await settle();
    assert.equal(await page.evaluate(() => [...document.documentElement.children].find((element) => element.shadowRoot)?.style.display ?? 'none'), 'none');
    assert.equal(await page.evaluate(() => document.body.querySelectorAll('[style*="display: none"]').length), 0);
    await page.close();
  });

  it('removes itself when the extension is reloaded and the tab is not', async () => {
    const page = await env.open(PR);
    await settle();
    await page.evaluate(() => {
      delete window.chrome.runtime.id;
      document.body.append(document.createElement('div'));
    });
    await settle();
    assert.equal((await panelState(page)).present, false);
    await page.close();
  });

  it('throws no page errors', () => assert.deepEqual(env.errors, []));
});
