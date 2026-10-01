const NAMED_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'slider', 'spinbutton', 'image', 'img', 'dialog', 'treeitem',
]);

const pageChecks = (scope) => {
  const ARIA = new Set([
    'activedescendant', 'atomic', 'autocomplete', 'busy', 'checked', 'colcount', 'colindex', 'colspan', 'controls', 'current',
    'describedby', 'description', 'details', 'disabled', 'errormessage', 'expanded', 'flowto', 'haspopup', 'hidden', 'invalid',
    'keyshortcuts', 'label', 'labelledby', 'level', 'live', 'modal', 'multiline', 'multiselectable', 'orientation', 'owns',
    'placeholder', 'posinset', 'pressed', 'readonly', 'relevant', 'required', 'roledescription', 'rowcount', 'rowindex',
    'rowspan', 'selected', 'setsize', 'sort', 'valuemax', 'valuemin', 'valuenow', 'valuetext',
  ]);
  const ROLES = new Set([
    'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell', 'checkbox', 'columnheader', 'combobox',
    'complementary', 'contentinfo', 'definition', 'dialog', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 'group',
    'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option', 'presentation', 'progressbar', 'radio',
    'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider',
    'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip',
    'tree', 'treegrid', 'treeitem',
  ]);
  const INTERACTIVE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const violations = [];
  const report = (rule, element, detail = '') => {
    const name = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.classList.length ? `.${[...element.classList].join('.')}` : ''}`;
    violations.push(`${rule}: ${name}${detail ? ` (${detail})` : ''}`);
  };

  const composedParent = (element) => element.parentElement ?? (element.parentNode instanceof ShadowRoot ? element.parentNode.host : null);

  const all = (root) => {
    const found = [];
    const visit = (node) => {
      for (const element of node.querySelectorAll('*')) {
        found.push(element);
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    if (root instanceof Element) found.push(root);
    if (root.shadowRoot) visit(root.shadowRoot);
    visit(root);
    return found;
  };

  const rendered = (element) => {
    if (!element.getClientRects().length) return false;
    for (let current = element; current; current = composedParent(current)) {
      const style = getComputedStyle(current);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
    }
    return true;
  };

  const visuallyHidden = (element) => {
    const { width, height } = element.getBoundingClientRect();
    return width <= 1 && height <= 1;
  };

  const parse = (value) => {
    const rgb = value.match(/^rgba?\(([^)]+)\)$/);
    if (rgb) {
      const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [r, g, b, a];
    }
    const srgb = value.match(/^color\(srgb ([^)]+)\)$/);
    if (srgb) {
      const [r, g, b, a = 1] = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return [r * 255, g * 255, b * 255, a];
    }
    return null;
  };

  const blend = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];

  const luminance = ([r, g, b]) => {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const elements = all(scope);

  const painted = elements
    .concat(scope === document.documentElement ? [] : [...document.querySelectorAll('html, body')])
    .map((element) => ({ element, color: parse(getComputedStyle(element).backgroundColor) }))
    .filter(({ element, color }) => color && color[3] > 0 && Number(getComputedStyle(element).opacity) > 0 && rendered(element));

  const contains = (ancestor, node) => {
    for (let current = node; current; current = composedParent(current)) if (current === ancestor) return true;
    return false;
  };

  const backgroundOf = (element) => {
    const chain = [];
    let opacity = 1;
    for (let current = element; current; current = composedParent(current)) {
      const style = getComputedStyle(current);
      if (style.backgroundImage !== 'none') return null;
      opacity *= Number(style.opacity);
      chain.push(current);
    }
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const own = chain.map(() => null);
    const below = chain.map(() => []);
    for (const { element: candidate, color } of painted) {
      const index = chain.indexOf(candidate);
      if (index !== -1) {
        own[index] = color;
        continue;
      }
      if (contains(element, candidate)) continue;
      const box = candidate.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      const common = chain.findIndex((ancestor) => contains(ancestor, candidate));
      if (common > 0) below[common - 1].push(color);
    }
    const layers = chain.flatMap((_, index) => [...below[index], ...(own[index] ? [own[index]] : [])].reverse()).reverse();
    return { color: layers.reduce((base, layer) => blend(layer, base), [255, 255, 255, 1]), opacity };
  };


  for (const element of elements) {
    const directText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (!directText || !rendered(element) || visuallyHidden(element) || element.closest('[disabled], svg')) continue;
    const style = getComputedStyle(element);
    const background = backgroundOf(element);
    const foreground = parse(style.color);
    if (!background || !foreground || background.opacity < 0.1) continue;
    const text = blend(foreground, background.color);
    const [light, dark] = [luminance(text), luminance(background.color)].sort((a, b) => b - a);
    const ratio = (light + 0.05) / (dark + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) report('color-contrast', element, `${ratio.toFixed(2)}:1`);
  }

  const roots = new Set(elements.map((element) => element.getRootNode()));
  for (const root of roots) {
    const seen = new Map();
    for (const element of root.querySelectorAll('[id]')) {
      if (seen.has(element.id)) report('duplicate-id', element);
      seen.set(element.id, element);
    }
  }

  for (const element of elements) {
    const root = element.getRootNode();
    const tag = element.tagName.toLowerCase();

    for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns']) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      for (const id of value.split(/\s+/)) if (!root.getElementById?.(id) && !root.querySelector?.(`#${CSS.escape(id)}`)) report('aria-reference', element, `${attribute}=${id}`);
    }
    if (tag === 'label' && element.htmlFor && !root.querySelector(`#${CSS.escape(element.htmlFor)}`)) report('label-reference', element, element.htmlFor);

    for (const { name } of element.attributes) {
      if (name.startsWith('aria-') && !ARIA.has(name.slice(5))) report('aria-valid-attr', element, name);
    }
    const role = element.getAttribute('role');
    if (role && !role.split(/\s+/).some((value) => ROLES.has(value))) report('aria-roles', element, role);

    if ((tag === 'ul' || tag === 'ol') && !role) {
      for (const child of element.children) if (!['li', 'script', 'template'].includes(child.tagName.toLowerCase())) report('list', element, child.tagName.toLowerCase());
    }
    if (tag === 'li') {
      const parent = element.parentElement;
      if (!parent || !(['ul', 'ol', 'menu'].includes(parent.tagName.toLowerCase()) || parent.getAttribute('role') === 'list')) report('listitem', element);
    }
    if (tag === 'dl') {
      for (const child of element.children) {
        const childTag = child.tagName.toLowerCase();
        const ok = ['dt', 'dd', 'script', 'template'].includes(childTag) || (childTag === 'div' && [...child.children].every((item) => ['dt', 'dd'].includes(item.tagName.toLowerCase())));
        if (!ok) report('definition-list', element, childTag);
      }
    }

    if (element.matches('a[href], button') && element.querySelector(INTERACTIVE)) report('nested-interactive', element);
    if (Number(element.getAttribute('tabindex')) > 0) report('tabindex', element);
    if (/^h[1-6]$/.test(tag) && rendered(element) && !element.textContent.trim()) report('empty-heading', element);
    if (element.getAttribute('aria-hidden') === 'true') {
      for (const focusable of element.querySelectorAll(INTERACTIVE)) if (rendered(focusable)) report('aria-hidden-focus', focusable);
    }
    if (tag === 'img' && !element.hasAttribute('alt')) report('image-alt', element);
  }

  if (scope === document.documentElement) {
    if (!document.documentElement.lang) report('html-has-lang', document.documentElement);
    if (!document.title.trim()) report('document-title', document.documentElement);
  }

  return violations;
};

export const audit = async (page, selector = 'html') => {
  const violations = await page.evaluate(
    `(${pageChecks})(document.querySelector(${JSON.stringify(selector)}))`,
  );
  const nodes = await page.accessibilityTree(selector);
  for (const node of nodes) {
    const role = node.role?.value;
    if (!NAMED_ROLES.has(role) || node.ignored) continue;
    if (!node.name?.value?.trim()) violations.push(`accessible-name: ${role} without a name`);
  }
  return violations;
};
