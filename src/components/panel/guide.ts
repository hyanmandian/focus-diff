import { i18n } from '#i18n';
import { pointAt } from '@/components/panel/popover';
import { h, icon } from '@/utils/dom';
import { formatNumber as format } from '@/utils/format';
import type { FileStats } from '@/utils/github';
import type { ChapterKind, Guide, GuideNote } from '@/utils/guide';
import type { GuidePhase, GuideResponse } from '@/utils/messages';

export type GuideView =
  | { state: 'setup' }
  | { state: 'confirm'; repo: string; files: number; tokens: number; host: string; model: string }
  | { state: 'working'; phase?: GuidePhase; characters?: number }
  | { state: 'error'; code: Extract<GuideResponse, { type: 'error' }>['code']; detail: string }
  | {
      state: 'ready';
      repo: string;
      guide: Guide;
      /** 0 is the overview, 1…n the chapters. */
      chapter: number;
      reviewed: number[];
      viewedFiles: Record<string, boolean>;
      fileStats: Record<string, FileStats>;
      stale: boolean;
      model: string;
      omitted: number;
    };

export interface GuideActions {
  start: () => void;
  confirm: (options: { remember: boolean }) => void;
  retry: () => void;
  regenerate: () => void;
  exit: () => void;
  settings: () => void;
  chapter: (index: number) => void;
  reviewed: (index: number, reviewed: boolean) => void;
  reveal: (path: string, anchor: string) => void;
}

type ReadyView = Extract<GuideView, { state: 'ready' }>;

const ICONS = {
  guide: 'M2 3.5h4.5A1.5 1.5 0 0 1 8 5v8a1.5 1.5 0 0 0-1.5-1.5H2zM14 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5H14z',
  previous: 'M10 3.5 5.5 8l4.5 4.5',
  next: 'M6 3.5 10.5 8 6 12.5',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
};

const kindLabel = (kind: ChapterKind) =>
  kind === 'core' ? i18n.t('guideKindCore') : kind === 'consequence' ? i18n.t('guideKindConsequence') : i18n.t('guideKindSupporting');

const errorLabel = (code: string) => {
  const labels: Record<string, () => string> = {
    auth: () => i18n.t('guideErrorAuth'),
    model: () => i18n.t('guideErrorModel'),
    rate: () => i18n.t('guideErrorRate'),
    server: () => i18n.t('guideErrorServer'),
    network: () => i18n.t('guideErrorNetwork'),
    refusal: () => i18n.t('guideErrorRefusal'),
    length: () => i18n.t('guideErrorLength'),
    format: () => i18n.t('guideErrorFormat'),
    diff: () => i18n.t('guideErrorDiff'),
    'diff-auth': () => i18n.t('guideErrorDiffAuth'),
    empty: () => i18n.t('guideErrorEmpty'),
    permission: () => i18n.t('guideErrorPermission'),
    request: () => i18n.t('guideErrorRequest'),
  };
  return (labels[code] ?? (() => i18n.t('guideErrorUnknown')))();
};

const split = (path: string): [string, string] => {
  const index = path.lastIndexOf('/');
  return index === -1 ? ['', path] : [path.slice(0, index + 1), path.slice(index + 1)];
};

export interface GuidePanel {
  bar: HTMLElement;
  card: HTMLElement;
  start: HTMLButtonElement;
  title: HTMLButtonElement;
  render: (view: GuideView | null) => void;
  /** Collapses the card, returning whether it was open. */
  closeCard: () => boolean;
}

export const createGuidePanel = (root: ShadowRoot, on: GuideActions): GuidePanel => {
  const svg = (name: keyof typeof ICONS, size = 16) => icon(ICONS[name], size);
  const cardId = 'focus-diff-guide';
  const headingId = 'focus-diff-guide-heading';
  let current: GuideView | null = null;
  let drawnKey = '';
  let userClosed = false;

  const chapterOf = () => (current?.state === 'ready' ? current.chapter : 0);
  const iconButton = (label: string, name: keyof typeof ICONS, onClick: () => void, className = 'icon-button') =>
    h('button', { type: 'button', className, 'aria-label': label, title: label, onClick }, svg(name));

  const body = h('div', { className: 'guide-body' });
  const card = h('section', { className: 'guide-card popover', id: cardId, hidden: true }, body);
  const previous = iconButton(i18n.t('guidePrevious'), 'previous', () => on.chapter(chapterOf() - 1));
  const next = iconButton(i18n.t('guideNext'), 'next', () => on.chapter(chapterOf() + 1));
  const titleStep = h('span', { className: 'guide-step' });
  const titleText = h('span');
  const title = h(
    'button',
    { type: 'button', className: 'guide-title', 'aria-expanded': 'false', 'aria-controls': cardId, onClick: () => setOpen(card.hidden) },
    titleStep,
    titleText,
  );
  const dots = h('span', { className: 'dots', 'aria-hidden': 'true' });
  const exit = iconButton(i18n.t('guideExit'), 'close', () => on.exit());
  const bar = h('div', { className: 'guide-bar', role: 'group', 'aria-label': i18n.t('guideLabel') }, previous, title, next, dots, exit);
  const start = iconButton(i18n.t('guideStart'), 'guide', () => on.start(), 'icon-button guide-start');

  const setOpen = (open: boolean) => {
    card.hidden = !open;
    title.setAttribute('aria-expanded', String(open));
    userClosed = !open;
    pointAt(card, title);
  };

  const heading = (text: string) => h('h2', { id: headingId, tabIndex: -1, textContent: text });
  const button = (label: string, onClick: () => void, className = 'secondary', extra: Record<string, unknown> = {}) =>
    h('button', { type: 'button', className, textContent: label, onClick, ...extra });
  const actions = (...children: Node[]) => h('div', { className: 'actions' }, ...children);
  const separator = () => h('span', { className: 'visually-hidden', textContent: ', ' });

  const fileItem = (path: string, view: ReadyView) => {
    const [dir, name] = split(path);
    const stats = view.fileStats[path];
    const meta = h('span', { className: 'meta' });
    if (stats || view.viewedFiles[path]) meta.append(separator());
    if (stats) {
      meta.append(
        h('span', { className: 'additions', textContent: `+${format(stats.additions)}` }),
        h('span', { className: 'deletions', textContent: `−${format(stats.deletions)}` }),
      );
    }
    if (view.viewedFiles[path])
      meta.append(svg('check', 14), h('span', { className: 'visually-hidden', textContent: i18n.t('guideViewed') }));
    return h(
      'li',
      {},
      h(
        'button',
        { type: 'button', className: 'item', 'data-focus': `file:${path}`, onClick: () => on.reveal(path, '') },
        h('span', { className: 'path' }, h('span', { className: 'dir', textContent: dir }), name),
        meta,
      ),
    );
  };

  const noteItem = (note: GuideNote) => {
    const where = note.line ? `${note.file}:${note.line.slice(1)}` : note.file;
    return h(
      'li',
      {},
      h(
        'button',
        {
          type: 'button',
          className: 'note',
          'data-focus': `note:${note.file}:${note.line}:${note.text.slice(0, 20)}`,
          onClick: () => on.reveal(note.file, note.line),
        },
        h('span', { className: 'where', textContent: where }),
        note.text,
      ),
    );
  };

  const staleBanner = (view: ReadyView) =>
    view.stale
      ? h(
          'p',
          { className: 'banner' },
          `${i18n.t('guideStale')} `,
          button(i18n.t('guideRegenerate'), () => on.regenerate(), ''),
        )
      : null;

  const overview = (view: ReadyView) => {
    const { guide } = view;
    const items = guide.chapters.map((chapter, index) =>
      h(
        'li',
        {},
        h(
          'button',
          { type: 'button', className: 'item chapter-item', 'data-focus': `chapter:${index + 1}`, onClick: () => on.chapter(index + 1) },
          h(
            'span',
            {},
            h('span', { className: 'number', textContent: `${index + 1}.` }),
            ' ',
            h('span', { className: 'title', textContent: chapter.title }),
            h('span', { className: `kind ${chapter.kind} small`, textContent: ` · ${kindLabel(chapter.kind)}` }),
          ),
          separator(),
          h(
            'span',
            { className: 'meta' },
            i18n.t('fileCount', chapter.files.length, [format(chapter.files.length)]),
            ...(view.reviewed.includes(index + 1)
              ? [svg('check', 14), h('span', { className: 'visually-hidden', textContent: i18n.t('guideReviewed') })]
              : []),
          ),
        ),
      ),
    );
    const meta = [i18n.t('guideWrittenBy', [view.model])];
    if (view.omitted) meta.push(i18n.t('guideOmitted', [format(view.omitted)]));
    return [
      staleBanner(view),
      heading(i18n.t('guideHeading')),
      guide.summary ? h('p', { textContent: guide.summary }) : null,
      h('h3', { textContent: i18n.t('guideChapters') }),
      h('ol', {}, ...items),
      actions(button(i18n.t('guideBegin'), () => on.chapter(1), 'primary', { 'data-focus': 'begin' })),
      h('p', { className: 'muted small meta-line', textContent: meta.join(' · ') }),
    ];
  };

  const chapterView = (view: ReadyView) => {
    const index = view.chapter;
    const chapter = view.guide.chapters[index - 1];
    if (!chapter) return overview(view);
    const total = view.guide.chapters.length;
    const checkbox = h('input', {
      type: 'checkbox',
      checked: view.reviewed.includes(index),
      'data-focus': 'reviewed',
      onChange: (event: Event) => on.reviewed(index, (event.target as HTMLInputElement).checked),
    });
    return [
      staleBanner(view),
      heading(chapter.title),
      h(
        'p',
        { className: 'chapter-meta' },
        h('span', { className: `kind ${chapter.kind}`, textContent: kindLabel(chapter.kind) }),
        ` · ${i18n.t('guideChapterOf', [index, total])}`,
      ),
      chapter.why ? h('p', { textContent: chapter.why }) : null,
      chapter.notes.length ? h('h3', { textContent: i18n.t('guideNotes') }) : null,
      chapter.notes.length ? h('ul', {}, ...chapter.notes.map(noteItem)) : null,
      h('h3', { textContent: i18n.t('guideFiles') }),
      h('ul', {}, ...chapter.files.map((path) => fileItem(path, view))),
      actions(
        h('label', { className: 'check' }, checkbox, i18n.t('guideMarkReviewed')),
        h('span', { className: 'spacer' }),
        index < total
          ? button(i18n.t('guideNextChapter'), () => on.chapter(index + 1), 'primary', { 'data-focus': 'next-chapter' })
          : button(i18n.t('guideFinish'), () => on.chapter(0), 'primary', { 'data-focus': 'finish' }),
      ),
    ];
  };

  const content = (view: GuideView) => {
    switch (view.state) {
      case 'setup':
        return [
          heading(i18n.t('guideSetupHeading')),
          h('p', { textContent: i18n.t('guideSetupBody') }),
          actions(
            button(i18n.t('guideSetupAction'), () => on.settings(), 'primary', { 'data-focus': 'primary' }),
            button(i18n.t('guideClose'), () => on.exit()),
          ),
        ];
      case 'confirm': {
        const remember = h('input', { type: 'checkbox', 'data-focus': 'remember' });
        return [
          heading(i18n.t('guideConfirmHeading')),
          h('p', { textContent: i18n.t('guideConfirmBody', [format(view.files), format(view.tokens), view.host]) }),
          h('p', { className: 'muted small', textContent: i18n.t('guideConfirmModel', [view.model]) }),
          h('label', { className: 'check' }, remember, i18n.t('guideRemember', [view.repo])),
          actions(
            button(i18n.t('guideCreate'), () => on.confirm({ remember: remember.checked }), 'primary', { 'data-focus': 'primary' }),
            button(i18n.t('guideCancel'), () => on.exit()),
          ),
        ];
      }
      case 'working': {
        const phase =
          view.phase === 'writing'
            ? i18n.t('guidePhaseWriting', [format(view.characters ?? 0)])
            : view.phase === 'thinking'
              ? i18n.t('guidePhaseThinking')
              : i18n.t('guidePhaseReading');
        return [
          heading(i18n.t('guideWorkingHeading')),
          h('p', { className: 'check' }, h('span', { className: 'spinner', 'aria-hidden': 'true' }), phase),
          actions(button(i18n.t('guideCancel'), () => on.exit(), 'secondary', { 'data-focus': 'primary' })),
        ];
      }
      case 'error':
        return [
          heading(i18n.t('guideErrorHeading')),
          h('p', { textContent: errorLabel(view.code) }),
          view.detail ? h('p', { className: 'muted small', textContent: view.detail }) : null,
          actions(
            button(i18n.t('guideRetry'), () => on.retry(), 'primary', { 'data-focus': 'primary' }),
            button(i18n.t('guideSettings'), () => on.settings()),
            button(i18n.t('guideClose'), () => on.exit()),
          ),
        ];
      case 'ready':
        return view.chapter === 0 ? overview(view) : chapterView(view);
    }
  };

  const renderBar = (view: GuideView) => {
    const ready = view.state === 'ready';
    previous.hidden = next.hidden = dots.hidden = !ready;
    if (view.state === 'ready') {
      const total = view.guide.chapters.length;
      previous.disabled = view.chapter === 0;
      next.disabled = view.chapter === total;
      titleStep.textContent = view.chapter === 0 ? i18n.t('guideOverview') : `${view.chapter}/${total}`;
      titleText.textContent = view.chapter === 0 ? i18n.t('guideHeading') : (view.guide.chapters[view.chapter - 1]?.title ?? '');
      dots.replaceChildren(
        ...view.guide.chapters.map((_, index) =>
          h('span', { className: `dot${view.reviewed.includes(index + 1) ? ' done' : ''}${view.chapter === index + 1 ? ' current' : ''}` }),
        ),
      );
    } else {
      titleStep.replaceChildren(view.state === 'working' ? h('span', { className: 'spinner', 'aria-hidden': 'true' }) : '');
      titleText.textContent = i18n.t('guideLabel');
    }
  };

  const focused = () => root.activeElement as HTMLElement | null;

  const render = (view: GuideView | null) => {
    const previousView = current;
    current = view;
    if (!view) {
      card.hidden = true;
      body.replaceChildren();
      card.removeAttribute('aria-labelledby');
      drawnKey = '';
      userClosed = false;
      return;
    }
    renderBar(view);
    const key = JSON.stringify(view);
    if (key === drawnKey) return;
    drawnKey = key;

    const chapterChanged = previousView?.state === 'ready' && view.state === 'ready' && previousView.chapter !== view.chapter;
    const moved = previousView?.state !== view.state || chapterChanged;
    if (moved) userClosed = false;
    const focusKey = card.contains(focused()) ? focused()?.dataset.focus : undefined;
    body.replaceChildren(...content(view).filter((node) => node !== null));
    card.setAttribute('aria-labelledby', headingId);
    if (!userClosed) {
      card.hidden = false;
      title.setAttribute('aria-expanded', 'true');
    }
    if (moved) body.scrollTop = 0;
    pointAt(card, title);

    const restore = focusKey ? card.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusKey)}"]`) : null;
    if (restore) restore.focus();
    else if (moved && view.state !== 'ready' && !card.hidden) card.querySelector<HTMLElement>('[data-focus="primary"]')?.focus();
    else if (moved && previousView?.state === 'ready' && !card.hidden && focused()?.closest('.guide-card, .guide-bar'))
      card.querySelector<HTMLElement>(`#${headingId}`)?.focus();
  };

  const closeCard = () => {
    if (card.hidden) return false;
    setOpen(false);
    return true;
  };

  return { bar, card, start, title, render, closeCard };
};
