(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const clone = (id) => $(`#${id}`).content.firstElementChild.cloneNode(true);
  let uid = 0;
  const nextId = (prefix) => `${prefix}-${++uid}`;

  let config = FocusDiff.normalize({});
  let dirty = false;
  let suggestedRepo = '';

  const status = $('#status');
  const say = (text, tone = '') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };
  const setDirty = () => {
    dirty = true;
    say('Unsaved changes', 'warn');
  };

  const filterProblems = (filter) => {
    const problems = [];
    if (!filter.name.trim()) problems.push('Give the button a name.');
    const include = FocusDiff.compile(filter.include);
    const exclude = FocusDiff.compile(filter.exclude);
    if (!include.ok) problems.push(`Include isn't a valid regex: ${include.error}.`);
    if (!exclude.ok) problems.push(`Exclude isn't a valid regex: ${exclude.error}.`);
    return { problems, name: !filter.name.trim(), include: !include.ok, exclude: !exclude.ok };
  };

  const showFilterProblems = (row, filter, { force = false } = {}) => {
    const result = filterProblems(filter);
    const touched = force || filter.name || filter.include || filter.exclude;
    ['name', 'include', 'exclude'].forEach((key) => {
      const input = $(`.f-${key}`, row);
      if (touched && result[key]) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    });
    $('.error', row).textContent = touched ? result.problems.join(' ') : '';
    return result.problems.length === 0;
  };

  const renderFilters = (filters) => {
    const block = clone('filters-template');
    const list = $('.filter-list', block);
    const addButton = $('.add-filter', block);
    const syncEmpty = () => {
      $('.empty', block).hidden = filters.length > 0;
    };

    const label = (row, filter) => {
      const name = filter.name.trim() || 'Untitled filter';
      $('.filter-fields', row).setAttribute('aria-label', name);
      $('.remove-filter', row).setAttribute('aria-label', `Remove ${name}`);
    };

    const addRow = (filter, focus) => {
      const row = clone('filter-template');
      const errorId = nextId('filter-error');
      $('.error', row).id = errorId;
      const fields = { name: $('.f-name', row), include: $('.f-include', row), exclude: $('.f-exclude', row) };
      const labels = { name: 'Button name', include: 'Include regex', exclude: 'Exclude regex' };
      Object.entries(fields).forEach(([key, input]) => {
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
      });
      $('.remove-filter', row).addEventListener('click', () => {
        const index = filters.indexOf(filter);
        filters.splice(index, 1);
        const rows = [...list.children];
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
      if (focus) fields.name.focus();
    };

    filters.forEach((filter) => addRow(filter, false));
    syncEmpty();
    addButton.addEventListener('click', () => {
      const filter = { id: FocusDiff.newId(), name: '', include: '', exclude: '' };
      filters.push(filter);
      addRow(filter, true);
      setDirty();
    });
    return block;
  };

  const repoProblem = (repo) =>
    FocusDiff.REPO_PATTERN.test(repo.trim()) ? '' : 'Use owner/name, or owner/* for every repository of an owner.';

  const renderRepo = (entry, focus) => {
    const card = clone('repo-template');
    const input = $('.repo-name', card);
    const error = $('.repo-error', card);
    const inputId = nextId('repo');
    input.id = inputId;
    error.id = `${inputId}-error`;
    $('.repo-label', card).htmlFor = inputId;
    input.setAttribute('aria-describedby', error.id);
    input.value = entry.repo;

    const remove = $('.remove-repo', card);
    const syncLabel = () => remove.setAttribute('aria-label', `Remove ${entry.repo.trim() || 'this repository'}`);
    const check = (force) => {
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
      if (input.hasAttribute('aria-invalid')) check();
      setDirty();
      updateTry();
    });
    input.addEventListener('blur', () => check());
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
    $('#add-repo').textContent = suggestedRepo ? `Add filters only for ${suggestedRepo}` : 'Add a repository';
  };

  const updateTry = () => {
    const path = $('#try-path').value.trim();
    const repo = $('#try-repo').value.trim();
    const result = $('#try-result');
    if (!path) {
      result.textContent = 'Type a file path to check it.';
      result.dataset.tone = '';
      return;
    }
    const filters = repo ? FocusDiff.filtersFor(config, repo) : config.global;
    const shown = filters
      .filter((filter) => filter.name.trim() && FocusDiff.toMatcher(filter)?.(path))
      .map((filter) => filter.name.trim());
    result.dataset.tone = shown.length ? 'ok' : '';
    result.textContent = shown.length
      ? `Shown by All and ${shown.join(', ')}.`
      : 'Only All shows this file. No filter matches it.';
  };

  const save = async () => {
    const rows = [...document.querySelectorAll('.filter')];
    const filters = [...config.global, ...config.repos.flatMap((entry) => entry.filters)];
    const filtersOk = filters.every((filter) => filterProblems(filter).problems.length === 0);
    const cards = [...document.querySelectorAll('.repo')];
    const reposOk = cards.map((card) => card.check(true)).every(Boolean);

    if (!filtersOk || !reposOk) {
      filters.forEach((filter, index) => rows[index] && showFilterProblems(rows[index], filter, { force: true }));
      say(!filtersOk ? 'Some filters need fixing before you can save.' : 'Check the repository names before saving.', 'error');
      document.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    try {
      await FocusDiff.save(config);
      dirty = false;
      say('Saved. Open pull requests pick it up right away.', 'ok');
    } catch (error) {
      say(
        /QUOTA/i.test(error.message)
          ? 'Too many filters to sync. Remove a few and try again.'
          : `Couldn't save: ${error.message}`,
        'error',
      );
    }
  };

  $('#save').addEventListener('click', save);
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });

  $('#add-repo').addEventListener('click', () => {
    const entry = { repo: suggestedRepo, filters: [] };
    suggestedRepo = '';
    syncAddRepo();
    config.repos.push(entry);
    renderRepo(entry, true);
    setDirty();
  });

  ['#try-path', '#try-repo'].forEach((selector) => $(selector).addEventListener('input', updateTry));

  const toast = $('#toast');
  let toastTimer;
  const notify = (message) => {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
  };

  const filterCount = (value) => value.global.length + value.repos.reduce((sum, entry) => sum + entry.filters.length, 0);
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

  $('#export').addEventListener('click', async () => {
    const json = JSON.stringify(FocusDiff.normalize(config), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      $('#export-fallback').hidden = true;
      notify(`Copied ${plural(filterCount(config), 'filter')} to the clipboard`);
    } catch {
      const fallback = $('#export-json');
      fallback.value = json;
      $('#export-fallback').hidden = false;
      fallback.focus();
      fallback.select();
    }
  });

  const importBox = $('#json');
  const importError = $('#json-error');
  const clearImportError = () => {
    importError.textContent = '';
    importBox.removeAttribute('aria-invalid');
  };

  importBox.addEventListener('input', () => {
    $('#import').disabled = !importBox.value.trim();
    clearImportError();
  });

  $('#import').addEventListener('click', () => {
    let imported;
    try {
      imported = FocusDiff.normalize(JSON.parse(importBox.value));
    } catch {
      imported = null;
    }
    if (!imported || FocusDiff.isEmpty(imported)) {
      importError.textContent = imported
        ? 'That text has no filters in it. Ask your teammate to copy their filters again.'
        : "That text isn't a copied set of filters. Paste exactly what Copy my filters produced.";
      importBox.setAttribute('aria-invalid', 'true');
      importBox.focus();
      return;
    }
    config = imported;
    render();
    setDirty();
    importBox.value = '';
    $('#import').disabled = true;
    clearImportError();
    const count = filterCount(imported);
    notify(`Imported ${plural(count, 'filter')}. Review ${count === 1 ? 'it' : 'them'}, then save.`);
    $('#global-h').focus();
  });

  const render = () => {
    $('#global').replaceChildren(renderFilters(config.global));
    $('#repos').replaceChildren();
    config.repos.forEach((entry) => renderRepo(entry, false));
    updateTry();
  };

  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });

  FocusDiff.load().then((loaded) => {
    config = loaded;
    render();
    const repo = new URLSearchParams(location.hash.slice(1)).get('repo');
    if (repo) {
      $('#try-repo').value = repo;
      if (!config.repos.some((entry) => FocusDiff.repoMatches(entry.repo, repo))) suggestedRepo = repo;
    }
    syncAddRepo();
    updateTry();
  });
})();
