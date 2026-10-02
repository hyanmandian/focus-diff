import { i18n } from '#i18n';
import { browser } from 'wxt/browser';
import { AIError, baseUrlOf, hostOf, listModels, originOf, PROVIDERS, providerOf, type AISettings, type ProviderId } from '@/utils/ai';
import { $ } from '@/utils/page';
import { guideOrigins } from '@/utils/permissions';
import { aiSettingsItem, consentItem } from '@/utils/storage';

type Tone = '' | 'ok' | 'error';

const isProvider = (value: string): value is ProviderId => value in PROVIDERS;

/** The "Guided review with AI" section: provider, key and model, stored only on this device. */
export const setupAISettings = async (): Promise<void> => {
  const provider = $<HTMLSelectElement>('#ai-provider');
  const url = $<HTMLInputElement>('#ai-url');
  const key = $<HTMLInputElement>('#ai-key');
  const model = $<HTMLInputElement>('#ai-model');
  const models = $<HTMLDataListElement>('#ai-models');
  const status = $('#ai-status');
  const removeButton = $<HTMLButtonElement>('#ai-remove');
  const forgetButton = $<HTMLButtonElement>('#ai-forget');

  let saved: AISettings | null = await aiSettingsItem.getValue();
  let consent = await consentItem.getValue();
  let previousProvider: ProviderId = saved?.provider ?? 'anthropic';

  const say = (text: string, tone: Tone = '') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const selected = (): ProviderId => (isProvider(provider.value) ? provider.value : 'custom');

  provider.append(
    ...(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = PROVIDERS[id].name || i18n.t('aiCustom');
      return option;
    }),
  );

  const savedKeyApplies = () => saved?.provider === selected() && Boolean(saved.apiKey);

  const syncProvider = (switchedFrom?: ProviderId) => {
    const current = PROVIDERS[selected()];
    $('#ai-url-field').hidden = !(selected() === 'custom' || selected() === 'ollama');
    if (switchedFrom) {
      url.value = current.baseUrl;
      const previousDefault = PROVIDERS[switchedFrom].model ?? '';
      if (!model.value.trim() || model.value.trim() === previousDefault) model.value = current.model ?? '';
      models.replaceChildren();
    }
    url.placeholder = current.baseUrl || 'https://api.example.com/v1';
    $('#ai-key-optional').hidden = !current.keyless;
    key.placeholder = savedKeyApplies() ? i18n.t('aiKeySaved', [saved?.apiKey?.slice(-4) ?? '']) : '';
  };

  const formSettings = (): AISettings => ({
    provider: selected(),
    baseUrl: url.value.trim() || PROVIDERS[selected()].baseUrl,
    apiKey: key.value.trim() || (savedKeyApplies() ? (saved?.apiKey ?? '') : ''),
    model: model.value.trim(),
  });

  const problemWith = (settings: AISettings) => {
    try {
      if (!/^https?:$/.test(new URL(baseUrlOf(settings)).protocol)) return i18n.t('aiErrorUrl');
    } catch {
      return i18n.t('aiErrorUrl');
    }
    if (!providerOf(settings).keyless && !settings.apiKey) return i18n.t('aiErrorKey');
    if (!settings.model) return i18n.t('aiErrorModel');
    return '';
  };

  /** Must run synchronously inside the click handler: browsers only show the prompt for a user gesture. */
  const requestAccess = (settings: AISettings) => browser.permissions.request({ origins: guideOrigins(settings) }).catch(() => false);

  const describe = (error: unknown) => {
    const code = error instanceof AIError ? error.code : 'request';
    const detail = error instanceof AIError ? error.detail : String((error as Error)?.message ?? '');
    if (code === 'auth') return i18n.t('aiErrorAuth');
    if (code === 'model') return i18n.t('aiErrorNotFound');
    if (code === 'network') return i18n.t('aiErrorNetwork');
    if (code === 'rate') return i18n.t('aiErrorRate');
    if (code === 'server') return i18n.t('aiErrorServer');
    return i18n.t('aiErrorRequest', [detail]);
  };

  const syncForget = () => {
    const count = Object.values(consent).filter(Boolean).length;
    forgetButton.hidden = count === 0;
    forgetButton.textContent = i18n.t('aiForget', [count]);
  };

  provider.addEventListener('change', () => {
    syncProvider(previousProvider);
    previousProvider = selected();
    say('');
  });

  $('#ai-load-models').addEventListener('click', async () => {
    const settings = { ...formSettings(), model: 'list' };
    const problem = problemWith(settings);
    if (problem) return say(problem, 'error');
    if (!(await requestAccess(settings))) return say(i18n.t('aiErrorPermission', [hostOf(settings)]), 'error');
    say(i18n.t('aiLoading'));
    try {
      const found = await listModels(settings);
      models.replaceChildren(
        ...found.map((id) => {
          const option = document.createElement('option');
          option.value = id;
          return option;
        }),
      );
      say(i18n.t('aiModelsFound', [found.length]), 'ok');
      model.focus();
    } catch (error) {
      say(describe(error), 'error');
    }
  });

  $('#ai-save').addEventListener('click', async () => {
    const settings = formSettings();
    const problem = problemWith(settings);
    if (problem) return say(problem, 'error');
    if (!(await requestAccess(settings))) return say(i18n.t('aiErrorPermission', [hostOf(settings)]), 'error');
    await aiSettingsItem.setValue(settings);
    saved = settings;
    key.value = '';
    syncProvider();
    removeButton.hidden = false;
    say(i18n.t('aiSaved'), 'ok');
  });

  removeButton.addEventListener('click', async () => {
    await aiSettingsItem.removeValue();
    if (saved) await browser.permissions.remove({ origins: [originOf(saved)] }).catch(() => false);
    saved = null;
    key.value = '';
    syncProvider();
    removeButton.hidden = true;
    say(i18n.t('aiRemoved'), 'ok');
    provider.focus();
  });

  forgetButton.addEventListener('click', async () => {
    consent = {};
    await consentItem.setValue(consent);
    syncForget();
    say(i18n.t('aiForgotten'), 'ok');
    provider.focus();
  });

  provider.value = previousProvider;
  url.value = saved?.baseUrl ?? PROVIDERS[previousProvider].baseUrl;
  model.value = saved?.model ?? PROVIDERS[previousProvider].model ?? '';
  removeButton.hidden = !saved;
  syncProvider();
  syncForget();
};
