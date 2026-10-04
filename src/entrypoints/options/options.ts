import '@/assets/global.css';
import '@/components/button.css';
import './options.css';
import { i18n } from '#i18n';
import { browser } from 'wxt/browser';
import {
  compile,
  filtersFor,
  isEmpty,
  newId,
  normalize,
  REPO_PATTERN,
  repoMatches,
  toMatcher,
  type Config,
  type Filter,
  type RepoFilters,
} from '@/utils/filters/filters';
import { createDemo, type Demo } from '@/components/demo/demo';
import { SAMPLE_PULL_REQUEST } from '@/components/demo/sample';
import { toaster } from '@/components/toast/toast';
import { PROVIDERS, providerNames } from '@/providers/providers';
import {
  appearanceCss,
  createStyler,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  SITE_THEME,
  THEME_PROPERTIES,
  type Appearance,
} from '@/utils/appearance/appearance';
import { uiLanguage } from '@/utils/i18n';
import { $, reveal, translate, translateDocument } from '@/utils/page';
import type { Message } from '@/utils/messages';
import { appearanceItem, configItem, loadAppearance, loadConfig, saveAppearance, saveConfig } from '@/utils/storage/storage';

type Field = 'name' | 'include' | 'exclude';
type Tone = '' | 'ok' | 'warn' | 'error';
type CheckableCard = HTMLElement & { check: (force: boolean) => boolean };

const FIELDS: Field[] = ['name', 'include', 'exclude'];

const clone = <T extends HTMLElement>(id: string): T => {
  const element = $<HTMLTemplateElement>(`#${id}`).content.firstElementChild?.cloneNode(true) as T;
  const holder = document.createElement('div');
  holder.append(element);
  translate(holder);
  return element;
};

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${++uid}`;

let config: Config = normalize({});
let appearance: Appearance = { ...DEFAULT_APPEARANCE };
let dirty = false;
let saving = false;
let suggestedRepo = '';

const status = $('#status');
const say = (text: string, tone: Tone = '') => {
  status.textContent = text;
  status.dataset.tone = tone;
};
const setDirty = () => {
  dirty = true;
  say(i18n.t('statusUnsaved'), 'warn');
};

const filterProblems = (filter: Filter) => {
  const problems: string[] = [];
  if (!filter.name.trim()) problems.push(i18n.t('errorName'));
  const include = compile(filter.include);
  const exclude = compile(filter.exclude);
  if (!include.ok) problems.push(i18n.t('errorRegex', [i18n.t('columnInclude'), include.error]));
  if (!exclude.ok) problems.push(i18n.t('errorRegex', [i18n.t('columnExclude'), exclude.error]));
  return { problems, name: !filter.name.trim(), include: !include.ok, exclude: !exclude.ok };
};

const showFilterProblems = (row: HTMLElement, filter: Filter, { force = false } = {}) => {
  const result = filterProblems(filter);
  const touched = force || Boolean(filter.name || filter.include || filter.exclude);
  for (const key of FIELDS) {
    const input = $<HTMLInputElement>(`.f-${key}`, row);
    if (touched && result[key]) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  $('.error', row).textContent = touched ? result.problems.join(' ') : '';
  return result.problems.length === 0;
};

const renderFilters = (filters: Filter[]) => {
  const block = clone('filters-template');
  const list = $('.filter-list', block);
  const addButton = $<HTMLButtonElement>('.add-filter', block);
  const syncEmpty = () => {
    $('.empty', block).hidden = filters.length > 0;
  };

  const label = (row: HTMLElement, filter: Filter) => {
    const name = filter.name.trim() || i18n.t('untitledFilter');
    $('.filter-fields', row).setAttribute('aria-label', name);
    $('.remove-filter', row).setAttribute('aria-label', i18n.t('removeNamed', [name]));
  };

  const addRow = (filter: Filter, focus: boolean) => {
    const row = clone('filter-template');
    const errorId = nextId('filter-error');
    $('.error', row).id = errorId;
    const labels: Record<Field, string> = { name: i18n.t('columnName'), include: i18n.t('labelInclude'), exclude: i18n.t('labelExclude') };
    for (const key of FIELDS) {
      const input = $<HTMLInputElement>(`.f-${key}`, row);
      input.value = filter[key];
      input.setAttribute('aria-label', labels[key]);
      input.setAttribute('aria-describedby', errorId);
      input.addEventListener('input', () => {
        filter[key] = input.value;
        showFilterProblems(row, filter);
        if (key === 'name') label(row, filter);
        setDirty();
        updateTryWhileTyping();
      });
    }
    $('.remove-filter', row).addEventListener('click', () => {
      const index = filters.indexOf(filter);
      filters.splice(index, 1);
      const rows = [...list.children] as HTMLElement[];
      const neighbour = rows[index + 1] || rows[index - 1];
      row.remove();
      (neighbour ? $('.f-name', neighbour) : addButton).focus();
      syncEmpty();
      setDirty();
      updateTry();
    });
    label(row, filter);
    showFilterProblems(row, filter);
    list.append(row);
    syncEmpty();
    if (focus) $('.f-name', row).focus();
  };

  filters.forEach((filter) => addRow(filter, false));
  syncEmpty();
  addButton.addEventListener('click', () => {
    const filter: Filter = { id: newId(), name: '', include: '', exclude: '' };
    filters.push(filter);
    addRow(filter, true);
    setDirty();
  });
  return block;
};

const repoProblem = (repo: string) => (REPO_PATTERN.test(repo.trim()) ? '' : i18n.t('errorRepo'));

const renderRepo = (entry: RepoFilters, focus: boolean) => {
  const card = clone<CheckableCard>('repo-template');
  const input = $<HTMLInputElement>('.repo-name', card);
  const error = $('.repo-error', card);
  const inputId = nextId('repo');
  input.id = inputId;
  error.id = `${inputId}-error`;
  $<HTMLLabelElement>('.repo-label', card).htmlFor = inputId;
  input.setAttribute('aria-describedby', error.id);
  input.value = entry.repo;

  const remove = $('.remove-repo', card);
  const syncLabel = () => remove.setAttribute('aria-label', i18n.t('removeNamed', [entry.repo.trim() || i18n.t('thisRepository')]));
  const check = (force: boolean) => {
    const problem = entry.repo || force ? repoProblem(entry.repo) : '';
    error.textContent = problem;
    if (problem) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    return !problem;
  };
  card.check = check;

  input.addEventListener('input', () => {
    entry.repo = input.value;
    syncLabel();
    if (input.hasAttribute('aria-invalid')) check(false);
    setDirty();
    updateTryWhileTyping();
  });
  input.addEventListener('blur', () => check(false));
  remove.addEventListener('click', () => {
    config.repos.splice(config.repos.indexOf(entry), 1);
    card.remove();
    $('#add-repo').focus();
    setDirty();
    updateTry();
  });

  syncLabel();
  $('.box-body', card).append(renderFilters(entry.filters));
  $('#repos').append(card);
  if (focus) input.focus();
};

const syncAddRepo = () => {
  $('#add-repo').textContent = suggestedRepo ? i18n.t('addRepoFor', [suggestedRepo]) : i18n.t('addRepo');
};

const updateTry = () => {
  const path = $<HTMLInputElement>('#try-path').value.trim();
  const repo = $<HTMLInputElement>('#try-repo').value.trim();
  const result = $('#try-result');
  if (!path) {
    result.textContent = i18n.t('tryEmpty');
    result.dataset.tone = '';
    return;
  }
  const filters = repo ? filtersFor(config, repo) : config.global;
  const shown = filters.filter((filter) => filter.name.trim() && toMatcher(filter)?.(path)).map((filter) => filter.name.trim());
  result.dataset.tone = shown.length ? 'ok' : '';
  result.textContent = shown.length
    ? i18n.t('tryShown', [i18n.t('filterAll'), shown.join(', ')])
    : i18n.t('tryOnlyAll', [i18n.t('filterAll')]);
};

/** The result is read out as it changes, so while typing it waits for a pause instead of speaking every keystroke. */
const TYPING_PAUSE_MS = 400;
let typing = 0;
const updateTryWhileTyping = () => {
  clearTimeout(typing);
  typing = window.setTimeout(updateTry, TYPING_PAUSE_MS);
};

const save = async () => {
  const rows = [...document.querySelectorAll<HTMLElement>('.filter')];
  const filters = [...config.global, ...config.repos.flatMap((entry) => entry.filters)];
  const filtersOk = filters.every((filter) => filterProblems(filter).problems.length === 0);
  const cards = [...document.querySelectorAll<CheckableCard>('.repo')];
  const reposOk = cards.map((card) => card.check(true)).every(Boolean);

  if (!filtersOk || !reposOk) {
    filters.forEach((filter, index) => {
      const row = rows[index];
      if (row) showFilterProblems(row, filter, { force: true });
    });
    say(filtersOk ? i18n.t('statusFixRepos') : i18n.t('statusFixFilters'), 'error');
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  // Each is saved on its own, so a quota error says which one is too big.
  let saved: 'filters' | 'look' = 'filters';
  try {
    saving = true;
    await saveConfig(config);
    saved = 'look';
    await saveAppearance(appearance);
    dirty = false;
    say(i18n.t('statusSaved'), 'ok');
  } catch (error) {
    const reason = (error as Error).message;
    const quota = saved === 'filters' ? i18n.t('statusQuota') : i18n.t('statusQuotaCss');
    say(/QUOTA/i.test(reason) ? quota : i18n.t('statusSaveError', [reason]), 'error');
  } finally {
    saving = false;
  }
};

$('#save').addEventListener('click', () => void save());
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void save();
  }
});

$('#add-repo').addEventListener('click', () => {
  const entry: RepoFilters = { repo: suggestedRepo, filters: [] };
  suggestedRepo = '';
  syncAddRepo();
  config.repos.push(entry);
  renderRepo(entry, true);
  setDirty();
});

['#try-path', '#try-repo'].forEach((selector) => $(selector).addEventListener('input', updateTryWhileTyping));

const notify = toaster($('#toast'));
const filterCount = (value: Config) => value.global.length + value.repos.reduce((sum, entry) => sum + entry.filters.length, 0);

$('#export').addEventListener('click', async () => {
  const json = JSON.stringify(normalize(config), null, 2);
  try {
    await navigator.clipboard.writeText(json);
    $('#export-fallback').hidden = true;
    const count = filterCount(config);
    notify(i18n.t('copied', count, [count]));
  } catch {
    const fallback = $<HTMLTextAreaElement>('#export-json');
    fallback.value = json;
    $('#export-fallback').hidden = false;
    fallback.focus();
    fallback.select();
  }
});

const importBox = $<HTMLTextAreaElement>('#json');
const importButton = $<HTMLButtonElement>('#import');
const importError = $('#json-error');
const clearImportError = () => {
  importError.textContent = '';
  importBox.removeAttribute('aria-invalid');
};

importBox.addEventListener('input', () => {
  importButton.disabled = !importBox.value.trim();
  clearImportError();
});

importButton.addEventListener('click', () => {
  let imported: Config | null;
  try {
    imported = normalize(JSON.parse(importBox.value));
  } catch {
    imported = null;
  }
  if (!imported || isEmpty(imported)) {
    importError.textContent = imported ? i18n.t('importEmpty') : i18n.t('importInvalid', [i18n.t('copyButton')]);
    importBox.setAttribute('aria-invalid', 'true');
    importBox.focus();
    return;
  }
  config = imported;
  render();
  setDirty();
  importBox.value = '';
  importButton.disabled = true;
  clearImportError();
  const count = filterCount(imported);
  notify(i18n.t('imported', count, [count]));
  $('#global-h').focus();
});

const render = () => {
  $('#global').replaceChildren(renderFilters(config.global));
  $('#repos').replaceChildren();
  config.repos.forEach((entry) => renderRepo(entry, false));
  updateTry();
};

// Another tab, the welcome page or another device changed the filters: follow along unless there are unsaved edits here.
configItem.watch((value) => {
  if (saving) return;
  if (dirty) return say(i18n.t('statusChangedElsewhere'), 'warn');
  config = normalize(value);
  render();
});

/**
 * The bar's look. The preview is the welcome page's demo on a few of its files, restyled on every change; pull requests
 * get the new look once it's saved.
 */
const themeSelect = $<HTMLSelectElement>('#theme');
const cssBox = $<HTMLTextAreaElement>('#css');
let preview: Demo | null = null;
const restylePreview = createStyler((css) => preview?.setTheme(css));

themeSelect.replaceChildren(
  new Option(i18n.t('themeSite'), SITE_THEME),
  ...PROVIDERS.map((provider) => new Option(provider.name, provider.id)),
);

const renderLook = () => {
  themeSelect.value = appearance.theme;
  cssBox.value = appearance.css;
  void restylePreview(appearance);
};

const changeLook = (next: Partial<Appearance>) => {
  appearance = { ...appearance, ...next };
  setDirty();
  void restylePreview(appearance);
};

themeSelect.addEventListener('change', () => changeLook({ theme: themeSelect.value }));
cssBox.addEventListener('input', () => changeLook({ css: cssBox.value }));

/** The theme's colours as the preview shows them, written out as CSS to change; the reader's CSS stays below. */
$('#css-start').addEventListener('click', () => {
  const host = $('#preview').shadowRoot?.querySelector<HTMLElement>('.demo-bar');
  if (!host) return;
  const styles = getComputedStyle(host);
  const lines = THEME_PROPERTIES.map((name) => `  ${name}: ${styles.getPropertyValue(name).trim()};`);
  const starter = `:host {\n${lines.join('\n')}\n}`;
  cssBox.value = appearance.css.trim() ? `${starter}\n\n${appearance.css}` : starter;
  changeLook({ css: cssBox.value });
  cssBox.focus();
  cssBox.setSelectionRange(0, 0);
});

$('#css-clear').addEventListener('click', () => {
  cssBox.value = '';
  changeLook({ css: '' });
  cssBox.focus();
});

appearanceItem.watch((value) => {
  if (saving) return;
  if (dirty) return say(i18n.t('statusChangedElsewhere'), 'warn');
  appearance = normalizeAppearance(value);
  renderLook();
});

window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});

translateDocument(i18n.t('optionsTitle'));
$('#tagline').textContent = i18n.t('optionsTagline', [providerNames(uiLanguage())]);
$('#version').textContent = i18n.t('optionsVersion', [browser.runtime.getManifest().version]);

/** `#repo=owner/name` comes from the panel on that repository: it's tried, and offered as a new repository. */
const applyRepoHash = () => {
  const repo = new URLSearchParams(location.hash.slice(1)).get('repo');
  if (repo) {
    $<HTMLInputElement>('#try-repo').value = repo;
    suggestedRepo = config.repos.some((entry) => repoMatches(entry.repo, repo)) ? '' : repo;
  }
  syncAddRepo();
  updateTry();
};
window.addEventListener('hashchange', applyRepoHash);

// Opened again from a pull request: this tab comes forward, with that repository, instead of a new one opening.
browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message?.type !== 'show-options') return;
  sendResponse(true);
  if (message.repo) location.hash = `repo=${encodeURIComponent(message.repo)}`;
  void browser.tabs.getCurrent().then((tab) => {
    if (tab?.id === undefined) return;
    void browser.tabs.update(tab.id, { active: true });
    void browser.windows.update(tab.windowId, { focused: true });
  });
});

void Promise.all([loadConfig(), loadAppearance()]).then(async ([loaded, look]) => {
  config = loaded;
  appearance = look;
  render();
  preview = createDemo(
    $('#preview'),
    { ...SAMPLE_PULL_REQUEST, files: SAMPLE_PULL_REQUEST.files.slice(0, 4) },
    // Settings are this page; the button goes to the filters.
    { onSettings: () => $('#global-h').focus(), theme: await appearanceCss(appearance) },
  );
  renderLook();
  reveal();
  applyRepoHash();
});
