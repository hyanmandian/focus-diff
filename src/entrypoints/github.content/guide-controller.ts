import { i18n } from '#i18n';
import type { ContentScriptContext } from '#imports';
import { browser, type Browser } from 'wxt/browser';
import type { Panel, Totals } from '@/components/panel';
import type { GuideActions, GuideView } from '@/components/panel/guide';
import type { Matcher } from '@/utils/filters';
import { uiLanguage } from '@/utils/i18n';
import * as page from '@/utils/github';
import { keyOf } from '@/utils/guide';
import { GUIDE_PORT, type GuideRequest, type GuideResponse, type Message, type PullRequestRef } from '@/utils/messages';
import { consentItem, guidesItem, type GuideEntry } from '@/utils/storage';
import type { LoadedDiff } from './controller';

/** A guide being prepared or written for one pull request; ready guides live in storage instead. */
type Session = { key: string } & Exclude<GuideView, { state: 'ready' }>;

interface Host {
  ctx: ContentScriptContext;
  panel: Panel;
  schedule: () => void;
  showFiles: (diffs: LoadedDiff[], matches: Matcher, filtering: boolean) => Totals;
}

export interface GuideController {
  actions: GuideActions;
  /** Renders the guided review when it's active on this pull request. Returns false to leave the filters in charge. */
  apply: (diffs: LoadedDiff[]) => boolean;
  /** Moves between chapters for the keyboard shortcuts. Returns false when no guide is open. */
  step: (offset: number) => boolean;
  showOverview: () => boolean;
}

const everything: Matcher = () => true;
const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

export const createGuideController = async ({ ctx, panel, schedule, showFiles }: Host): Promise<GuideController> => {
  let guides = await guidesItem.getValue();
  let consent = await consentItem.getValue();
  let session: Session | null = null;
  let port: Browser.runtime.Port | null = null;
  let revealNext: string | null = null;
  let announceNext = false;
  const staleChecked = new Set<string>();
  const staleKeys = new Set<string>();

  const current = () => {
    const pr = page.pullRequest();
    return pr ? { pr, key: keyOf(pr.repo, pr.number) } : null;
  };

  const openGuide = () => {
    const here = current();
    const entry = here && guides[here.key];
    return here && entry?.open && !session ? { ...here, entry } : null;
  };

  const updateGuide = (key: string, patch: Partial<GuideEntry>) => {
    const entry = guides[key];
    if (!entry) return;
    guides = { ...guides, [key]: { ...entry, ...patch } };
    void guidesItem.setValue(guides);
    schedule();
  };

  const setSession = (next: Session | null) => {
    session = next;
    schedule();
  };

  const disconnect = () => {
    port?.disconnect();
    port = null;
  };

  const connect = (onMessage: (message: GuideResponse) => void) => {
    disconnect();
    const opened = browser.runtime.connect({ name: GUIDE_PORT });
    port = opened;
    opened.onMessage.addListener((message: GuideResponse) => {
      if (port === opened) onMessage(message);
    });
    opened.onDisconnect.addListener(() => {
      if (port !== opened) return;
      port = null;
      if (session?.state === 'working') setSession({ key: session.key, state: 'error', code: 'network', detail: '' });
    });
    return (request: GuideRequest) => opened.postMessage(request);
  };

  const failed = (key: string, message: GuideResponse) => {
    disconnect();
    if (message.type === 'setup') return setSession({ key, state: 'setup' });
    if (message.type === 'error') return setSession({ key, state: 'error', code: message.code, detail: message.detail });
  };

  const generate = async (pr: PullRequestRef, key: string) => {
    setSession({ key, state: 'working', phase: 'reading' });
    const description = await page.description(pr);
    if (session?.key !== key) return;
    const send = connect((message) => {
      if (message.type === 'progress') return setSession({ key, state: 'working', phase: message.phase, characters: message.characters });
      if (message.type === 'done') {
        disconnect();
        staleKeys.delete(key);
        staleChecked.add(key);
        announceNext = true;
        return setSession(null);
      }
      failed(key, message);
    });
    send({ type: 'generate', ...pr, title: page.title(), description, locale: uiLanguage(), otherTitle: i18n.t('guideOtherChanges') });
  };

  const prepare = (pr: PullRequestRef, key: string) => {
    setSession({ key, state: 'working', phase: 'reading' });
    const send = connect((message) => {
      if (message.type !== 'prepared') return failed(key, message);
      if (consent[pr.repo]) return void generate(pr, key);
      setSession({
        key,
        state: 'confirm',
        repo: pr.repo,
        files: message.files,
        tokens: message.tokens,
        host: message.host,
        model: message.model,
      });
    });
    send({ type: 'prepare', ...pr });
  };

  /** Checks in the background whether the pull request changed since its guide was written. */
  const checkFreshness = (pr: PullRequestRef, key: string) => {
    if (staleChecked.has(key)) return;
    staleChecked.add(key);
    const quiet = browser.runtime.connect({ name: GUIDE_PORT });
    quiet.onMessage.addListener((message: GuideResponse) => {
      quiet.disconnect();
      if (message.type !== 'prepared' || !guides[key] || message.hash === guides[key].hash) return;
      staleKeys.add(key);
      schedule();
    });
    quiet.postMessage({ type: 'prepare', ...pr } satisfies GuideRequest);
  };

  const goToChapter = (index: number) => {
    const open = openGuide();
    if (!open) return;
    const chapter = clamp(index, open.entry.guide.chapters.length);
    if (chapter === open.entry.chapter) return;
    revealNext = chapter ? (open.entry.guide.chapters[chapter - 1]?.files[0] ?? null) : null;
    announceNext = true;
    updateGuide(open.key, { chapter });
  };

  const actions: GuideActions = {
    start: () => {
      const here = current();
      if (!here) return;
      announceNext = true;
      if (guides[here.key]) return updateGuide(here.key, { open: true });
      prepare(here.pr, here.key);
    },
    confirm: ({ remember }) => {
      const here = current();
      if (!here) return;
      if (remember) {
        consent = { ...consent, [here.pr.repo]: true };
        void consentItem.setValue(consent);
      }
      void generate(here.pr, here.key);
    },
    retry: () => {
      const here = current();
      if (here) prepare(here.pr, here.key);
    },
    regenerate: () => actions.retry(),
    exit: () => {
      disconnect();
      const here = current();
      session = null;
      announceNext = true;
      if (here && guides[here.key]?.open) updateGuide(here.key, { open: false });
      else schedule();
    },
    settings: () => {
      const message: Message = { type: 'open-options', repo: page.repository(), section: 'ai' };
      void browser.runtime.sendMessage(message);
    },
    chapter: goToChapter,
    reviewed: (index, checked) => {
      const open = openGuide();
      if (!open) return;
      const reviewed = new Set(open.entry.reviewed);
      if (checked) reviewed.add(index);
      else reviewed.delete(index);
      updateGuide(open.key, { reviewed: [...reviewed] });
    },
    reveal: (path, anchor) => void page.reveal(path, anchor),
  };

  const applySession = (active: Session, diffs: LoadedDiff[]) => {
    const { key: _key, ...view } = active;
    panel.renderGuide(view);
    showFiles(diffs, everything, false);
  };

  const applyGuide = ({ pr, key, entry }: NonNullable<ReturnType<typeof openGuide>>, diffs: LoadedDiff[]) => {
    const { guide } = entry;
    const chapter = clamp(entry.chapter, guide.chapters.length);
    const files = chapter ? new Set(guide.chapters[chapter - 1]?.files) : null;
    const matches: Matcher = files ? (path) => files.has(path) : everything;
    const totals = showFiles(diffs, matches, Boolean(files));

    const viewedFiles = Object.fromEntries(diffs.filter((diff) => page.viewed(diff) === true).map((diff) => [diff.path, true]));
    const fileStats = Object.fromEntries(diffs.flatMap((diff) => (diff.stats ? [[diff.path, diff.stats]] : [])));
    const autoReviewed = guide.chapters.flatMap((item, index) => (item.files.every((path) => viewedFiles[path]) ? [index + 1] : []));
    const reviewed = [...new Set([...entry.reviewed, ...autoReviewed])].toSorted((a, b) => a - b);
    panel.renderGuide({
      state: 'ready',
      repo: pr.repo,
      guide,
      chapter,
      reviewed,
      viewedFiles,
      fileStats,
      stale: staleKeys.has(key),
      model: entry.model,
      omitted: entry.omitted,
    });
    checkFreshness(pr, key);

    if (revealNext) {
      const path = revealNext;
      revealNext = null;
      void page.reveal(path);
    }
    if (announceNext) {
      announceNext = false;
      panel.announce({ name: chapter ? (guide.chapters[chapter - 1]?.title ?? '') : i18n.t('guideHeading'), ...totals });
    }
  };

  const apply = (diffs: LoadedDiff[]) => {
    const here = current();
    if (session && session.key !== here?.key) {
      disconnect();
      session = null;
    }
    if (session) {
      applySession(session, diffs);
      return true;
    }
    const open = openGuide();
    if (open) {
      applyGuide(open, diffs);
      return true;
    }
    panel.renderGuide(null);
    return false;
  };

  const unwatchGuides = guidesItem.watch((value) => {
    guides = value;
    schedule();
  });
  const unwatchConsent = consentItem.watch((value) => {
    consent = value;
  });
  ctx.onInvalidated(() => {
    if (!browser.runtime?.id) return;
    disconnect();
    unwatchGuides();
    unwatchConsent();
  });

  return {
    actions,
    apply,
    step: (offset) => {
      const open = openGuide();
      if (!open) return false;
      goToChapter(open.entry.chapter + offset);
      return true;
    },
    showOverview: () => {
      if (!openGuide()) return false;
      goToChapter(0);
      return true;
    },
  };
};
