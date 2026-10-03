import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { configItem, loadConfig, saveConfig, selectionsItem } from '@/utils/storage/storage';

describe('selections', () => {
  it('moves single selections from earlier versions to lists', async () => {
    await fakeBrowser.storage.local.set({ active: { 'octo/web': 'frontend', 'octo/api': 'all', 'octo/docs': ['docs', 'all'] } });
    await selectionsItem.migrate();
    expect(await selectionsItem.getValue()).toEqual({ 'octo/web': ['frontend'], 'octo/api': [], 'octo/docs': ['docs'] });
  });

  it('starts empty', async () => {
    expect(await selectionsItem.getValue()).toEqual({});
  });
});

describe('config', () => {
  it('normalizes what it reads and writes', async () => {
    await fakeBrowser.storage.sync.set({ config: { global: [{ name: ' Docs ', include: '\\.md$' }, 'junk'] } });
    const config = await loadConfig();
    expect(config.global).toEqual([{ id: expect.any(String), name: 'Docs', include: '\\.md$', exclude: '' }]);

    await saveConfig({ global: [{ id: 'all', name: 'X', include: '', exclude: '' }], repos: [] });
    const saved = await configItem.getValue();
    expect(saved.global[0]?.id).not.toBe('all');
  });

  it('is synced across devices', async () => {
    await saveConfig({ global: [], repos: [{ repo: 'octo/web', filters: [] }] });
    expect(await fakeBrowser.storage.sync.get('config')).toEqual({ config: { global: [], repos: [{ repo: 'octo/web', filters: [] }] } });
  });
});
