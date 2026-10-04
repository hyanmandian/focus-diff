import { i18n } from '#i18n';
import { commentIcon } from '@/components/icons';
import { createPanel } from '@/components/panel/panel';
import { createTooltip } from '@/components/tooltip/tooltip';
import { createReviewView, nextFilterWithWork, review, stepFrom, toggled, type Option } from '@/content/review';
import { h } from '@/utils/dom';
import { ALL, toMatcher } from '@/utils/filters/filters';
import { formatNumber as format } from '@/utils/format/format';
import { message } from '@/utils/i18n';
import type { DemoFile, DemoPullRequest } from './sample';
import tooltipStyles from '@/components/tooltip/tooltip.css?inline';
import demoStyles from './demo.css?inline';

/** The bar's own styles, every component's, adopted into its shadow root the way the content script injects them. */
const componentStyles = Object.values(
  import.meta.glob<string>(['../**/*.css', '!./**'], { query: '?inline', import: 'default', eager: true }),
);

const sheet = (css: string) => {
  const style = new CSSStyleSheet();
  style.replaceSync(css);
  return style;
};

export interface DemoOptions {
  /** What the bar's settings button does: on the welcome page, open the settings; on the site, say how to get them. */
  onSettings: () => void;
  /** The bar's look: a theme's `--fd-*` properties, and any of the reader's own CSS after them. */
  theme: string;
}

export interface Demo {
  /** Restyles the demo, as the reader edits the bar's look. */
  setTheme: (css: string) => void;
  /** Takes the demo down. */
  destroy: () => void;
}

/**
 * The real bar on a made-up pull request, for trying it out: the filters pick files, the numbers count what's left,
 * marking a file as viewed counts it off until Done, and the bar's buttons move through files and conversations. It's
 * built from the same components and the same review logic as on a review site. It renders into a shadow root on
 * `target`, so it looks the same on any page; it needs no extension API beyond the messages.
 */
export const createDemo = (target: HTMLElement, pullRequest: DemoPullRequest, { onSettings, theme }: DemoOptions): Demo => {
  const controller = new AbortController();
  const root = target.shadowRoot ?? target.attachShadow({ mode: 'open' });
  // The sample files take the theme's colours too; the bar gets its own copy, in its shadow root.
  const themeSheet = sheet(theme);
  root.adoptedStyleSheets = [sheet(tooltipStyles), sheet(demoStyles), themeSheet];

  const filters: Option[] = pullRequest.filters.flatMap((filter) => {
    const matches = toMatcher(filter);
    return matches ? [{ id: filter.id, name: message(filter.name), matches }] : [];
  });
  const options: Option[] = [{ id: ALL, name: i18n.t('filterAll') }, ...filters];
  const files = pullRequest.files.map((file: DemoFile) => ({
    ...file,
    stats: { additions: file.additions, deletions: file.deletions },
    viewed: Boolean(file.viewed),
  }));
  type File = (typeof files)[number];

  let ids: string[] = [];
  let shown: File[] = files;
  let current: File | null = null;
  /** 1-based, 0 before the first step, like the bar's own count. */
  let conversation = 0;

  const conversationsIn = (list: File[]) =>
    list.flatMap((file) => (file.conversations ?? []).map(({ line, state }) => ({ path: file.path, line, state })));

  const rows = new Map(
    files.map((file, index) => {
      const pathId = `demo-path-${index}`;
      const toggleId = `demo-viewed-${index}`;
      const outsideId = `demo-outside-${index}`;
      const viewed = h(
        'button',
        {
          type: 'button',
          id: toggleId,
          className: 'demo-viewed',
          'aria-pressed': String(file.viewed),
          'aria-labelledby': `${toggleId} ${pathId}`,
          'aria-describedby': outsideId,
          onClick: () => {
            if (viewed.getAttribute('aria-disabled') === 'true') return;
            file.viewed = !file.viewed;
            viewed.setAttribute('aria-pressed', String(file.viewed));
            apply();
          },
        },
        i18n.t('demoViewed'),
      );
      // A marker for each conversation, by its line; the bar's status says which one the reader is on.
      const talks = (file.conversations ?? []).map(({ line }) =>
        h('span', { className: 'demo-talk', 'data-line': String(line) }, commentIcon(), `L${format(line)}`),
      );
      const row = h(
        'li',
        { className: 'demo-file' },
        h('span', { className: 'demo-path', id: pathId, textContent: file.path }),
        // Said after the path for files outside the filter; empty otherwise.
        h('span', { className: 'visually-hidden', id: outsideId }),
        talks.length ? h('span', { className: 'demo-talks', 'aria-hidden': 'true' }, ...talks) : null,
        h(
          'span',
          { className: 'demo-lines' },
          h('span', { className: 'demo-add', textContent: `+${format(file.additions)}` }),
          h('span', { className: 'demo-del', textContent: `−${format(file.deletions)}` }),
        ),
        viewed,
      );
      return [file, row] as const;
    }),
  );

  const host = h('div', { className: 'demo-bar' });
  const panelRoot = host.attachShadow({ mode: 'open' });
  const container = h('div');
  // A style element, as the content script's, so the theme the bar adds after it wins the same way.
  panelRoot.append(h('style', { textContent: componentStyles.join('\n') }), container);
  const list = h('ul', { className: 'demo-files' }, ...rows.values());
  root.replaceChildren(h('div', { className: 'demo', role: 'group', 'aria-label': i18n.t('demoLabel') }, list, host));

  /** Puts the reader at a file, the way the bar scrolls a review page to it. */
  const goTo = (file: File | null) => {
    current = file;
    for (const [each, row] of rows) {
      if (each === file) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (file) rows.get(file)?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'instant' : 'smooth' });
  };

  const panel = createPanel(
    { root: panelRoot, container, host, signal: controller.signal, floating: false },
    {
      onToggle: (id) => choose(toggled(ids, id)),
      onSettings,
      onNextFile: () => nextFile(),
      onComment: (direction) => {
        const list = conversationsIn(shown);
        if (!list.length) return;
        const index = stepFrom(conversation, direction, list.length);
        conversation = index + 1;
        goTo(shown.find((file) => file.path === list[index]?.path) ?? null);
        apply();
        panel.announceText(i18n.t('panelJumpedToComment', [String(conversation), String(list.length), list[index]?.path ?? '']));
      },
      onUpdateSeen: () => {},
    },
  );
  const showReview = createReviewView(panel);
  // The bar's tooltip, for the files' buttons too: a disabled Viewed button says why.
  const tooltip = createTooltip({ host: target, signal: controller.signal, focused: () => root.activeElement as HTMLElement | null }, list);
  root.addEventListener('keydown', (event) => (event as KeyboardEvent).key === 'Escape' && tooltip.hide(), { signal: controller.signal });

  function apply(announce = false) {
    const now = review({ list: files, complete: true }, options, ids);
    shown = now.shown;
    const conversations = conversationsIn(shown);
    const at = conversations[conversation - 1];
    // Files outside the filter stay where they are, set back, so nothing on the page moves; on a review site they're hidden.
    const outside = now.filtering ? i18n.t('demoOutside', [now.name]) : '';
    for (const [file, row] of rows) {
      const out = !now.matches(file.path);
      row.toggleAttribute('data-out', out);
      const toggle = row.querySelector<HTMLElement>('.demo-viewed');
      toggle?.setAttribute('aria-disabled', String(out));
      if (toggle && out) toggle.dataset.tip = outside;
      else if (toggle) delete toggle.dataset.tip;
      const note = row.querySelector('.visually-hidden');
      if (note) note.textContent = out ? outside : '';
      for (const talk of row.querySelectorAll<HTMLElement>('.demo-talk'))
        talk.toggleAttribute('data-current', file.path === at?.path && talk.dataset.line === String(at.line));
    }
    panel.renderConversations({ list: conversations, current: conversation }, now.filtering ? conversationsIn(files).length : undefined);
    showReview(now, now.selection.join(), { announce });
  }

  /** A new selection: the reader starts at the first file left to review in it. */
  function choose(next: string[]) {
    ids = next;
    conversation = 0;
    apply(true);
    goTo(shown.find((file) => !file.viewed) ?? null);
  }

  /** The next shown file left to review, after the current one; with none left, the next filter that has some. */
  function nextFile() {
    const left = shown.filter((file) => !file.viewed);
    if (!left.length) {
      const then = ids.length ? nextFilterWithWork(files, filters, ids) : undefined;
      if (then) choose([then.id]);
      return;
    }
    const from = current ? shown.indexOf(current) : -1;
    const target = left.find((file) => shown.indexOf(file) > from) ?? left[0];
    if (!target) return;
    goTo(target);
    panel.announceText(i18n.t('panelJumpedToFile', left.length, [target.path, format(left.length)]));
  }

  /**
   * The bar keeps to one row: where the demo is too narrow for all of it, it goes compact, as on a phone. Its full width
   * is measured as it would lay out with all the room it wants.
   */
  const fit = () => {
    const bar = container.querySelector('.panel');
    if (!bar) return;
    panel.setCompact(false);
    const room = { '--fd-max-width': 'none', width: 'max-content', 'max-width': 'none' };
    for (const [name, value] of Object.entries(room)) host.style.setProperty(name, value);
    const needed = bar.getBoundingClientRect().width;
    for (const name of Object.keys(room)) host.style.removeProperty(name);
    panel.setCompact(needed > list.clientWidth);
  };
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(list);
  controller.signal.addEventListener('abort', () => resizeObserver.disconnect());

  apply();
  panel.setTheme(theme);
  panel.setVisible(true);
  // Fitted now, not on the observer's first call, so a demo made on a narrow page never shows wider than it.
  fit();
  return {
    setTheme: (css) => {
      themeSheet.replaceSync(css);
      panel.setTheme(css);
    },
    destroy: () => {
      controller.abort();
      root.replaceChildren();
    },
  };
};
