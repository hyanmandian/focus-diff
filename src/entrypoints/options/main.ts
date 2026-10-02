import '@/assets/page.css';
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
} from '@/utils/filters';
import { $, reveal, toaster, translate, translateDocument } from '@/utils/page';
import { configItem, loadConfig, saveConfig } from '@/utils/storage';

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
        updateTry();
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
    updateTry();
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
  try {
    saving = true;
    await saveConfig(config);
    dirty = false;
    say(i18n.t('statusSaved'), 'ok');
  } catch (error) {
    const reason = (error as Error).message;
    say(/QUOTA/i.test(reason) ? i18n.t('statusQuota') : i18n.t('statusSaveError', [reason]), 'error');
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

['#try-path', '#try-repo'].forEach((selector) => $(selector).addEventListener('input', updateTry));

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

window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});

translateDocument(i18n.t('optionsTitle'));
$('#version').textContent = i18n.t('optionsVersion', [browser.runtime.getManifest().version]);

void loadConfig().then((loaded) => {
  config = loaded;
  render();
  reveal();
  const repo = new URLSearchParams(location.hash.slice(1)).get('repo');
  if (repo) {
    $<HTMLInputElement>('#try-repo').value = repo;
    if (!config.repos.some((entry) => repoMatches(entry.repo, repo))) suggestedRepo = repo;
  }
  syncAddRepo();
  updateTry();
});
