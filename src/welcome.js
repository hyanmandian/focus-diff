(() => {
  const { t } = FocusDiff;
  const { translateDocument, toaster } = FocusDiffPage;
  const $ = (selector, root = document) => root.querySelector(selector);
  const notify = toaster($('#toast'));

  let config = FocusDiff.normalize({});

  const recipeIds = (recipe) => recipe.filters.map((_, index) => `recipe-${recipe.id}-${index}`);
  const isAdded = (recipe) => recipeIds(recipe).some((id) => config.global.some((filter) => filter.id === id));
  const names = (recipe) => recipe.filters.map((filter) => t(filter.name)).join(', ');

  const toggle = async (recipe) => {
    const ids = recipeIds(recipe);
    const adding = !isAdded(recipe);
    const global = adding
      ? [...config.global, ...recipe.filters.map((filter, index) => ({ ...filter, id: ids[index], name: t(filter.name) }))]
      : config.global.filter((filter) => !ids.includes(filter.id));
    config = FocusDiff.normalize({ ...config, global });
    await FocusDiff.save(config);
    render();
    notify(t(adding ? 'recipeAddedNotice' : 'recipeRemovedNotice', names(recipe)));
  };

  const pattern = (label, value) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    const code = document.createElement(value ? 'code' : 'span');
    code.textContent = value || t('recipeEverything');
    if (!value) code.className = 'everything';
    detail.append(code);
    row.append(term, detail);
    return row;
  };

  const renderRecipe = (recipe) => {
    const item = $('#recipe-template').content.firstElementChild.cloneNode(true);
    $('.recipe-title', item).textContent = t(recipe.title);
    $('.recipe-description', item).textContent = t(recipe.description);
    const list = $('.recipe-filters', item);
    for (const filter of recipe.filters) {
      const group = document.createElement('div');
      group.className = 'recipe-filter';
      const name = document.createElement('span');
      name.className = 'recipe-filter-name';
      name.textContent = t(filter.name);
      const patterns = document.createElement('dl');
      patterns.append(pattern(t('recipeInclude'), filter.include));
      if (filter.exclude) patterns.append(pattern(t('recipeExclude'), filter.exclude));
      group.append(name, patterns);
      list.append(group);
    }
    const button = $('.recipe-toggle', item);
    const added = isAdded(recipe);
    button.textContent = t(added ? 'recipeAdded' : 'recipeAdd');
    button.setAttribute('aria-pressed', String(added));
    button.setAttribute('aria-label', t(added ? 'recipeRemoveLabel' : 'recipeAddLabel', names(recipe)));
    button.addEventListener('click', () => toggle(recipe));
    return item;
  };

  const render = () => {
    const focusedId = document.activeElement?.closest('.recipe')?.dataset.recipe;
    $('#recipes').replaceChildren(
      ...FocusDiffRecipes.map((recipe) => {
        const item = renderRecipe(recipe);
        item.dataset.recipe = recipe.id;
        return item;
      }),
    );
    if (focusedId) $(`[data-recipe="${focusedId}"] .recipe-toggle`)?.focus();
  };

  const renderShortcuts = async () => {
    const defaults = { 'next-filter': 'Alt+Shift+.', 'previous-filter': 'Alt+Shift+,', 'show-all': 'Alt+Shift+0' };
    const commands = (await chrome.commands?.getAll?.()) ?? [];
    const keys = Object.keys(defaults).map((name) => commands.find((command) => command.name === name)?.shortcut || defaults[name]);
    const marker = '@@@';
    const parts = t('welcomeShortcuts', marker, marker, marker).split(marker);
    const paragraph = $('#shortcuts');
    paragraph.replaceChildren();
    parts.forEach((part, index) => {
      paragraph.append(part);
      if (index < keys.length) {
        const kbd = document.createElement('kbd');
        kbd.textContent = keys[index];
        paragraph.append(kbd);
      }
    });
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.config) return;
    config = FocusDiff.normalize(changes.config.newValue);
    render();
  });

  translateDocument('welcomeTitle');
  renderShortcuts();
  FocusDiff.load().then((loaded) => {
    config = loaded;
    render();
    if (location.hash === '#recipes-h') $('#recipes-h').focus();
  });
})();
