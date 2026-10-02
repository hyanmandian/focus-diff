import { browser, type Browser } from 'wxt/browser';
import { AIError, complete, hostOf, isReady, type Progress } from '@/utils/ai';
import {
  estimateTokens,
  fitDiff,
  hash,
  keyOf,
  normalizeGuide,
  parseDiff,
  SCHEMA,
  systemPrompt,
  userPrompt,
  type DiffFile,
} from '@/utils/guide';
import type { GuideRequest, GuideResponse, PullRequestRef } from '@/utils/messages';
import { guideOrigins } from '@/utils/permissions';
import { aiSettingsItem, guidesItem, MAX_GUIDES, type GuideEntry } from '@/utils/storage';

const PROGRESS_INTERVAL_MS = 250;

type Post = (message: GuideResponse) => void;

interface DownloadedDiff {
  files: DiffFile[];
  hash: string;
}

const downloaded = new Map<string, DownloadedDiff>();

/** Downloads `pull/N.diff` with the reviewer's GitHub session, which also covers private repositories. */
const downloadDiff = async ({ repo, number }: PullRequestRef, signal: AbortSignal): Promise<DownloadedDiff> => {
  let response: Response;
  try {
    response = await fetch(`https://github.com/${repo}/pull/${number}.diff`, { credentials: 'include', signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw new AIError('cancelled');
    throw new AIError('diff', (error as Error)?.message);
  }
  if (!response.ok) throw new AIError('diff', `HTTP ${response.status}`);
  if (/html/.test(response.headers.get('content-type') ?? '')) throw new AIError('diff-auth');
  const text = await response.text();
  const files = parseDiff(text);
  if (!files.length) throw new AIError('empty');
  const result = { files, hash: await hash(text) };
  downloaded.set(keyOf(repo, number), result);
  return result;
};

const saveGuide = async (key: string, entry: GuideEntry) => {
  const guides = await guidesItem.getValue();
  const kept = Object.entries({ ...guides, [key]: entry })
    .toSorted(([, a], [, b]) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, MAX_GUIDES);
  await guidesItem.setValue(Object.fromEntries(kept));
};

const prepare = async (request: PullRequestRef, post: Post, signal: AbortSignal) => {
  const settings = await aiSettingsItem.getValue();
  if (!isReady(settings)) return post({ type: 'setup' });
  if (!(await browser.permissions.contains({ origins: guideOrigins(settings) }))) throw new AIError('permission');
  const { files, hash: diffHash } = await downloadDiff(request, signal);
  post({
    type: 'prepared',
    hash: diffHash,
    files: files.length,
    tokens: estimateTokens(fitDiff(files).text.length),
    host: hostOf(settings),
    model: settings.model,
  });
};

const generate = async (request: Extract<GuideRequest, { type: 'generate' }>, post: Post, signal: AbortSignal) => {
  const settings = await aiSettingsItem.getValue();
  if (!isReady(settings)) return post({ type: 'setup' });
  const key = keyOf(request.repo, request.number);
  post({ type: 'progress', phase: 'reading' });
  const { files, hash: diffHash } = downloaded.get(key) ?? (await downloadDiff(request, signal));
  const diff = fitDiff(files);

  let lastProgress = 0;
  const onProgress = ({ phase, characters }: Progress) => {
    const now = Date.now();
    if (now - lastProgress < PROGRESS_INTERVAL_MS) return;
    lastProgress = now;
    post({ type: 'progress', phase, characters });
  };

  post({ type: 'progress', phase: 'thinking' });
  const text = await complete(settings, {
    system: systemPrompt(request.locale),
    prompt: userPrompt({ ...request, diff, files }),
    schema: SCHEMA,
    onProgress,
    signal,
  });
  const guide = normalizeGuide(
    text,
    files.map((file) => file.path),
    { otherTitle: request.otherTitle },
  );
  if (!guide) throw new AIError('format');

  await saveGuide(key, {
    hash: diffHash,
    guide,
    model: settings.model,
    host: hostOf(settings),
    omitted: diff.omitted.length,
    createdAt: Date.now(),
    open: true,
    chapter: 0,
    reviewed: [],
  });
  post({ type: 'done' });
};

/** Serves one guide port: each message either prepares (download and estimate) or writes a guide. */
export const serveGuidePort = (port: Browser.runtime.Port) => {
  const controller = new AbortController();
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
    controller.abort();
  });
  const post: Post = (message) => {
    if (connected) port.postMessage(message);
  };

  port.onMessage.addListener(async (message: GuideRequest) => {
    try {
      if (message?.type === 'prepare') await prepare(message, post, controller.signal);
      if (message?.type === 'generate') await generate(message, post, controller.signal);
    } catch (error) {
      const failure = error instanceof AIError ? error : new AIError('request', (error as Error)?.message);
      if (failure.code === 'cancelled') return;
      post({ type: 'error', code: error instanceof AIError ? failure.code : 'unknown', detail: failure.detail });
    }
  });
};
