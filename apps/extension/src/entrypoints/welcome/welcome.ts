import '@/assets/global.css';
import '@/components/button.css';
import './welcome.css';
import { i18n } from '#i18n';
import { browser } from 'wxt/browser';
import { normalize, type Config } from '@/utils/filters/filters';
import { message, uiLanguage } from '@/utils/i18n';
import { providerNames } from '@/providers/providers';
import { toaster } from '@/components/toast/toast';
import { $, reveal, translate, translateDocument } from '@/utils/page';
import { RECIPES, type Recipe } from '@/utils/recipes';
import { appearanceCss, createStyler, normalizeAppearance } from '@/utils/appearance/appearance';
import {
  appearanceItem,
  configItem,
  loadAppearance,
  loadConfig,
  loadReviewTime,
  reviewTimeItem,
  saveConfig,
  saveReviewTime,
} from '@/utils/storage/storage';
import {
  normalizeReviewTime,
  presetSession,
  REVIEW_PRESETS,
  type ReviewPreset,
  type ReviewTimeSettings,
} from '@/utils/review-time/sessions';
import { sessionSummary } from '@/utils/review-time/summary';

const notify = toaster($('#toast'));
let config: Config = normalize({});

const recipeIds = (recipe: Recipe) => recipe.filters.map((_, index) => `recipe-${recipe.id}-${index}`);
const isAdded = (recipe: Recipe) => recipeIds(recipe).some((id) => config.global.some((filter) => filter.id === id));
const names = (recipe: Recipe) => recipe.filters.map((filter) => message(filter.name)).join(', ');

const toggle = async (recipe: Recipe) => {
  const ids = recipeIds(recipe);
  const adding = !isAdded(recipe);
  const global = adding
    ? [...config.global, ...recipe.filters.map((filter, index) => ({ ...filter, id: ids[index] ?? '', name: message(filter.name) }))]
    : config.global.filter((filter) => !ids.includes(filter.id));
  const next = normalize({ ...config, global });
  try {
    await saveConfig(next);
  } catch (error) {
    notify(/QUOTA/i.test((error as Error).message) ? i18n.t('statusQuota') : i18n.t('statusSaveError', [(error as Error).message]));
    return;
  }
  config = next;
  const item = document.querySelector<HTMLElement>(`[data-recipe="${recipe.id}"]`);
  if (item) showState(item, recipe);
  notify(adding ? i18n.t('recipeAddedNotice', [names(recipe)]) : i18n.t('recipeRemovedNotice', [names(recipe)]));
};

const pattern = (label: string, value: string) => {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  const code = document.createElement(value ? 'code' : 'span');
  code.textContent = value || i18n.t('recipeEverything');
  if (!value) code.className = 'everything';
  detail.append(code);
  row.append(term, detail);
  return row;
};

const renderRecipe = (recipe: Recipe) => {
  const template = $<HTMLTemplateElement>('#recipe-template');
  const item = template.content.firstElementChild?.cloneNode(true) as HTMLLIElement;
  item.dataset.recipe = recipe.id;
  $('.recipe-title', item).textContent = message(recipe.title);
  $('.recipe-description', item).textContent = message(recipe.description);
  translate(item);
  // The buttons it adds, by name; their patterns are folded below, for whoever wants to read them.
  $('.recipe-names', item).replaceChildren(
    ...recipe.filters.map((filter) => Object.assign(document.createElement('li'), { textContent: message(filter.name) })),
  );
  const list = $('.recipe-filters', item);
  for (const filter of recipe.filters) {
    const group = document.createElement('div');
    group.className = 'recipe-filter';
    const name = document.createElement('span');
    name.className = 'recipe-filter-name';
    name.textContent = message(filter.name);
    const patterns = document.createElement('dl');
    patterns.append(pattern(i18n.t('recipeInclude'), filter.include));
    if (filter.exclude) patterns.append(pattern(i18n.t('recipeExclude'), filter.exclude));
    group.append(name, patterns);
    list.append(group);
  }
  $<HTMLButtonElement>('.recipe-toggle', item).addEventListener('click', () => void toggle(recipe));
  showState(item, recipe);
  return item;
};

/**
 * The button names what it does, Add or Remove, and its full name starts with those words. It's updated in place, so
 * focus stays on it and it isn't read out again.
 */
function showState(item: HTMLElement, recipe: Recipe) {
  const added = isAdded(recipe);
  const button = $<HTMLButtonElement>('.recipe-toggle', item);
  button.textContent = added ? i18n.t('recipeRemove') : i18n.t('recipeAdd');
  button.setAttribute('aria-label', added ? i18n.t('recipeRemoveLabel', [names(recipe)]) : i18n.t('recipeAddLabel', [names(recipe)]));
  item.toggleAttribute('data-added', added);
}

const render = () => {
  const focusedId = (document.activeElement?.closest('.recipe') as HTMLElement | null)?.dataset.recipe;
  $('#recipes').replaceChildren(...RECIPES.map(renderRecipe));
  if (focusedId) document.querySelector<HTMLElement>(`[data-recipe="${focusedId}"] .recipe-toggle`)?.focus();
};

/**
 * Review times to start from. Using one turns review time on, which asks for notifications first, from the click
 * itself; taking it back leaves the reader's own review times as they are.
 */
let reviewTime: ReviewTimeSettings = normalizeReviewTime({});
const PRESET_NAMES: Record<string, [string, string]> = {
  twice: [i18n.t('presetTwiceTitle'), i18n.t('presetTwiceDescription')],
  every: [i18n.t('presetEveryTitle'), i18n.t('presetEveryDescription')],
  end: [i18n.t('presetEndTitle'), i18n.t('presetEndDescription')],
};
const ORDER_NAMES = { oldest: i18n.t('reviewOrderOldest'), quickest: i18n.t('reviewOrderQuickest'), fill: i18n.t('reviewOrderFill') };
const presetOn = (preset: ReviewPreset) =>
  reviewTime.enabled && reviewTime.sessions.some((session) => session.id === `preset-${preset.id}` && session.on);

const togglePreset = async (preset: ReviewPreset) => {
  const [title] = PRESET_NAMES[preset.id] ?? [''];
  const id = `preset-${preset.id}`;
  const adding = !presetOn(preset);
  if (adding && browser.runtime.getManifest().optional_permissions?.includes('notifications')) {
    const allowed = await browser.permissions.request({ permissions: ['notifications'] }).catch(() => false);
    if (!allowed) return notify(i18n.t('notifyDenied'));
  }
  const others = reviewTime.sessions.filter((session) => session.id !== id);
  const next = normalizeReviewTime({
    ...reviewTime,
    enabled: adding || others.some((session) => session.on),
    sessions: adding ? [...others, presetSession(preset, title)] : others,
  });
  try {
    await saveReviewTime(next);
  } catch (error) {
    return notify(i18n.t('statusSaveError', [(error as Error).message]));
  }
  reviewTime = next;
  renderPresets();
  notify(adding ? i18n.t('welcomeReviewAdded', [title]) : i18n.t('welcomeReviewRemoved', [title]));
};

function renderPresets() {
  const focused = (document.activeElement?.closest('[data-preset]') as HTMLElement | null)?.dataset.preset;
  $('#review-presets').replaceChildren(
    ...REVIEW_PRESETS.map((preset) => {
      const [title, description] = PRESET_NAMES[preset.id] ?? ['', ''];
      const session = presetSession(preset, title);
      const on = presetOn(preset);
      const item = document.createElement('li');
      item.className = 'recipe';
      item.dataset.preset = preset.id;
      item.toggleAttribute('data-added', on);
      const text = document.createElement('div');
      text.className = 'recipe-text';
      text.append(
        Object.assign(document.createElement('h3'), { className: 'recipe-title', textContent: title }),
        Object.assign(document.createElement('p'), { className: 'recipe-description', textContent: description }),
      );
      const facts = document.createElement('ul');
      facts.className = 'recipe-names';
      facts.setAttribute('role', 'list');
      facts.append(
        ...[sessionSummary(session), ORDER_NAMES[session.order]].map((fact) =>
          Object.assign(document.createElement('li'), { textContent: fact }),
        ),
      );
      const button = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'btn recipe-toggle',
        textContent: on ? i18n.t('presetStop') : i18n.t('presetUse'),
      });
      button.setAttribute('aria-label', on ? i18n.t('presetStopLabel', [title]) : i18n.t('presetUseLabel', [title]));
      button.addEventListener('click', () => void togglePreset(preset));
      item.append(text, facts, button);
      return item;
    }),
  );
  if (focused) document.querySelector<HTMLElement>(`[data-preset="${focused}"] button`)?.focus();
}

reviewTimeItem.watch((value) => {
  reviewTime = normalizeReviewTime(value);
  renderPresets();
});

const DEFAULT_SHORTCUTS: Record<string, string> = {
  'next-filter': 'Alt+Shift+.',
  'previous-filter': 'Alt+Shift+,',
  'show-all': 'Alt+Shift+0',
  'next-unviewed': 'Alt+Shift+J',
};

const renderShortcuts = async () => {
  const commands = (await browser.commands?.getAll?.()) ?? [];
  const keys = Object.entries(DEFAULT_SHORTCUTS).map(
    ([name, fallback]) => commands.find((command) => command.name === name)?.shortcut || fallback,
  );
  const marker = '@@@';
  const parts = i18n.t('welcomeShortcuts', [marker, marker, marker, marker]).split(marker);
  const paragraph = $('#shortcuts');
  paragraph.replaceChildren();
  parts.forEach((part, index) => {
    paragraph.append(part);
    const key = keys[index];
    if (index < keys.length && key) {
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      paragraph.append(kbd);
    }
  });
};

configItem.watch((value) => {
  config = normalize(value);
  render();
});

translateDocument(i18n.t('welcomeTitle'));
$('#lead').textContent = i18n.t('welcomeLead', [providerNames(uiLanguage())]);
void Promise.all([loadConfig(), loadReviewTime(), renderShortcuts()]).then(([loaded, review]) => {
  config = loaded;
  reviewTime = review;
  render();
  renderPresets();
  reveal();
  if (location.hash === '#recipes-h') $('#recipes-h').focus();
});

// The demo is a bundle of its own, loaded once the page shows. It wears the reader's look for the bar from the start,
// and follows it as it changes in settings.
void Promise.all([import('@/components/demo/demo'), import('@/components/demo/sample'), loadAppearance().then(appearanceCss)]).then(
  ([{ createDemo }, { SAMPLE_PULL_REQUEST }, theme]) => {
    const demo = createDemo($('#demo'), SAMPLE_PULL_REQUEST, { onSettings: () => location.assign('/options.html'), theme });
    const restyle = createStyler(demo.setTheme);
    appearanceItem.watch((value) => void restyle(normalizeAppearance(value)));
  },
);
