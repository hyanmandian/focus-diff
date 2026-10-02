import type { Page, Worker } from '@playwright/test';
import { CAN_SWITCH_LANGUAGE, expect, test } from './fixtures';

const fields = (page: Page) => ({
  provider: page.locator('#ai-provider'),
  url: page.locator('#ai-url'),
  urlField: page.locator('#ai-url-field'),
  key: page.locator('#ai-key'),
  model: page.locator('#ai-model'),
  status: page.locator('#ai-status'),
  save: page.locator('#ai-save'),
  remove: page.locator('#ai-remove'),
  forget: page.locator('#ai-forget'),
});

const local = (background: Worker, key: string) =>
  background.evaluate(async (name) => (await chrome.storage.local.get(name))[name] ?? null, key);

test.describe('AI settings', () => {
  test('starts with Anthropic and its default model', async ({ openExtensionPage }) => {
    const ai = fields(await openExtensionPage('options.html'));
    await expect(ai.provider).toHaveValue('anthropic');
    await expect(ai.model).toHaveValue('claude-opus-5-5');
    await expect(ai.urlField).toBeHidden();
    await expect(ai.remove).toBeHidden();
  });

  test('switches providers and shows the address only where it can change', async ({ openExtensionPage }) => {
    const ai = fields(await openExtensionPage('options.html'));
    await ai.provider.selectOption('openai');
    await expect(ai.model).toHaveValue('');
    await expect(ai.urlField).toBeHidden();
    await ai.provider.selectOption('ollama');
    await expect(ai.urlField).toBeVisible();
    await expect(ai.url).toHaveValue('http://localhost:11434/v1');
    await ai.model.fill('llama3');
    await ai.provider.selectOption('custom');
    await expect(ai.model).toHaveValue('llama3');
    await expect(ai.url).toHaveValue('');
  });

  test('saves the key on this device only and never shows it again', async ({ openExtensionPage, background }) => {
    const page = await openExtensionPage('options.html');
    const ai = fields(page);
    await ai.save.click();
    await expect(ai.status).toHaveText('Enter the API key.');
    await ai.key.fill('sk-ant-secret-1234');
    await ai.save.click();
    await expect(ai.status).toContainText('Saved.');
    expect(await local(background, 'ai')).toEqual({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant-secret-1234',
      model: 'claude-opus-5-5',
    });
    expect(await background.evaluate(async () => Object.keys(await chrome.storage.sync.get(null)))).not.toContain('ai');
    await expect(ai.key).toHaveValue('');
    await expect(ai.key).toHaveAttribute('placeholder', 'Saved key ending in 1234');
    await expect(ai.remove).toBeVisible();

    await page.reload();
    await expect(ai.key).toHaveValue('');
    await expect(ai.key).toHaveAttribute('placeholder', 'Saved key ending in 1234');
    await ai.provider.selectOption('openai');
    await expect(ai.key).toHaveAttribute('placeholder', '');
  });

  test('keeps the saved key when other fields change, and removes it', async ({ openExtensionPage, background }) => {
    const ai = fields(await openExtensionPage('options.html'));
    await ai.key.fill('sk-ant-first-9999');
    await ai.save.click();
    await expect(ai.status).toContainText('Saved.');
    await ai.model.fill('claude-sonnet-5-5');
    await ai.save.click();
    await expect.poll(() => local(background, 'ai')).toMatchObject({ apiKey: 'sk-ant-first-9999', model: 'claude-sonnet-5-5' });

    await ai.remove.click();
    await expect(ai.status).toHaveText('Removed the key from this browser.');
    expect(await local(background, 'ai')).toBeNull();
    await expect(ai.remove).toBeHidden();
  });

  test('loads the models a provider offers', async ({ context, openExtensionPage }) => {
    let key = '';
    await context.route('https://api.anthropic.com/v1/models?limit=1000', (route) => {
      key = route.request().headers()['x-api-key'] ?? '';
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-4-5' }] }),
      });
    });
    const page = await openExtensionPage('options.html');
    const ai = fields(page);
    await ai.key.fill('sk-ant-test');
    await page.locator('#ai-load-models').click();
    await expect(ai.status).toHaveText('Found 2 models.');
    expect(key).toBe('sk-ant-test');
    expect(
      await page.locator('#ai-models option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    ).toEqual(['claude-haiku-4-5', 'claude-opus-5-5']);
  });

  test('forgets repositories approved for guides', async ({ background, openExtensionPage }) => {
    await background.evaluate(() => chrome.storage.local.set({ aiConsent: { 'octo/web': true, 'octo/api': true } }));
    const ai = fields(await openExtensionPage('options.html'));
    await expect(ai.forget).toHaveText('Forget repository approvals (2)');
    await ai.forget.click();
    await expect(ai.forget).toBeHidden();
    expect(await local(background, 'aiConsent')).toEqual({});
  });

  test('opens straight at the AI section from the panel', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options.html#repo=octo/web&ai');
    await expect(page.locator('#ai-h')).toBeFocused();
  });

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});

test.describe('AI settings in Brazilian Portuguese', () => {
  test.use({ locale: 'pt-BR' });
  test.skip(!CAN_SWITCH_LANGUAGE, 'Chrome ignores --lang on macOS');

  test('speaks the browser language', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options.html');
    await expect(page.locator('#ai-h')).toHaveText('Revisão guiada com IA');
    await expect(page.locator('#ai-provider option[value="custom"]')).toHaveText('Outro (compatível com OpenAI)');
  });
});
