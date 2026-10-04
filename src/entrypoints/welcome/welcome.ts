import '@/assets/global.css';
import '@/components/button.css';
import './welcome.css';
import { i18n } from '#i18n';
import { browser } from 'wxt/browser';
import { normalize, type Config } from '@/utils/filters/filters';
import { message, uiLanguage } from '@/utils/i18n';
import { providerNames } from '@/providers/providers';
import { createDemo } from '@/components/demo/demo';
import { SAMPLE_PULL_REQUEST } from '@/components/demo/sample';
import { toaster } from '@/components/toast/toast';
import { $, reveal, translateDocument } from '@/utils/page';
import { RECIPES, type Recipe } from '@/utils/recipes';
import { appearanceCss, createStyler, normalizeAppearance } from '@/utils/appearance/appearance';
import { appearanceItem, configItem, loadAppearance, loadConfig, saveConfig } from '@/utils/storage/storage';

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
void Promise.all([loadConfig(), loadAppearance().then(appearanceCss), renderShortcuts()]).then(([loaded, theme]) => {
  // The demo wears the reader's look for the bar from the start, and follows it as it changes in settings.
  const demo = createDemo($('#demo'), SAMPLE_PULL_REQUEST, { onSettings: () => location.assign('/options.html'), theme });
  const restyle = createStyler(demo.setTheme);
  appearanceItem.watch((value) => void restyle(normalizeAppearance(value)));
  config = loaded;
  render();
  reveal();
  if (location.hash === '#recipes-h') $('#recipes-h').focus();
});
