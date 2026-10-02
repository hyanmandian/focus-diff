export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'custom';
type Format = 'anthropic' | 'openai';

interface Provider {
  name: string;
  format: Format;
  baseUrl: string;
  model?: string;
  keyless?: boolean;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: { name: 'Anthropic', format: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5' },
  openai: { name: 'OpenAI', format: 'openai', baseUrl: 'https://api.openai.com/v1' },
  gemini: { name: 'Google Gemini', format: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  openrouter: { name: 'OpenRouter', format: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  ollama: { name: 'Ollama', format: 'openai', baseUrl: 'http://localhost:11434/v1', keyless: true },
  custom: { name: '', format: 'openai', baseUrl: '', keyless: true },
};

export interface AISettings {
  provider: ProviderId;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}

export type AIErrorCode =
  | 'setup'
  | 'auth'
  | 'model'
  | 'rate'
  | 'server'
  | 'request'
  | 'network'
  | 'cancelled'
  | 'refusal'
  | 'length'
  | 'format'
  | 'diff'
  | 'diff-auth'
  | 'empty'
  | 'permission';

export class AIError extends Error {
  constructor(
    readonly code: AIErrorCode,
    readonly detail = '',
  ) {
    super(detail || code);
  }
}

export interface Progress {
  phase: 'thinking' | 'writing';
  characters: number;
}

export interface CompletionRequest {
  system: string;
  prompt: string;
  schema?: object;
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_OUTPUT_TOKENS = 32000;
const HOMEPAGE = 'https://github.com/hyanmandian/focus-diff';

export const providerOf = (settings: Pick<AISettings, 'provider'> | null | undefined): Provider =>
  PROVIDERS[settings?.provider as ProviderId] ?? PROVIDERS.custom;

export const baseUrlOf = (settings: Pick<AISettings, 'provider' | 'baseUrl'>): string =>
  (settings.baseUrl || providerOf(settings).baseUrl).trim().replace(/\/+$/, '');

const isUrl = (value: string) => {
  try {
    return Boolean(new URL(value));
  } catch {
    return false;
  }
};

export const isReady = (settings: AISettings | null | undefined): settings is AISettings =>
  Boolean(
    settings?.provider && settings.model?.trim() && isUrl(baseUrlOf(settings)) && (providerOf(settings).keyless || settings.apiKey?.trim()),
  );

/** The match pattern for the provider's host. Ports are left out because match patterns cover every port. */
export const originOf = (settings: Pick<AISettings, 'provider' | 'baseUrl'>): string => {
  const { protocol, hostname } = new URL(baseUrlOf(settings));
  return `${protocol}//${hostname}/*`;
};

export const hostOf = (settings: Pick<AISettings, 'provider' | 'baseUrl'>): string => new URL(baseUrlOf(settings)).host;

const usesFallbacks = (model: string) => model.startsWith('claude-opus-5');

const anthropicHeaders = (settings: AISettings): Record<string, string> => ({
  'content-type': 'application/json',
  'x-api-key': settings.apiKey?.trim() ?? '',
  'anthropic-version': ANTHROPIC_VERSION,
  'anthropic-dangerous-direct-browser-access': 'true',
});

const openaiHeaders = (settings: AISettings): Record<string, string> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (settings.apiKey?.trim()) headers.authorization = `Bearer ${settings.apiKey.trim()}`;
  if (settings.provider === 'openrouter') Object.assign(headers, { 'http-referer': HOMEPAGE, 'x-title': 'Focus Diff' });
  return headers;
};

interface HttpRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

const anthropicRequest = (settings: AISettings, { system, prompt, schema }: CompletionRequest): HttpRequest => {
  const model = settings.model.trim();
  const headers = anthropicHeaders(settings);
  const body: Record<string, unknown> = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    stream: true,
    system,
    messages: [{ role: 'user', content: prompt }],
  };
  if (schema) body.output_config = { format: { type: 'json_schema', schema } };
  if (usesFallbacks(model)) {
    headers['anthropic-beta'] = ANTHROPIC_FALLBACK_BETA;
    body.fallbacks = 'default';
  }
  return { url: `${baseUrlOf(settings)}/messages`, init: { method: 'POST', headers, body: JSON.stringify(body) } };
};

const openaiRequest = (settings: AISettings, { system, prompt, schema }: CompletionRequest): HttpRequest => {
  const body: Record<string, unknown> = {
    model: settings.model.trim(),
    stream: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  };
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'review_guide', strict: true, schema } };
  return {
    url: `${baseUrlOf(settings)}/chat/completions`,
    init: { method: 'POST', headers: openaiHeaders(settings), body: JSON.stringify(body) },
  };
};

const errorFor = async (response: Response): Promise<AIError> => {
  let detail = '';
  try {
    const payload = await response.json();
    detail = payload?.error?.message || payload?.message || payload?.[0]?.error?.message || '';
  } catch {
    detail = '';
  }
  const code: AIErrorCode =
    response.status === 401 || response.status === 403
      ? 'auth'
      : response.status === 404
        ? 'model'
        : response.status === 429
          ? 'rate'
          : response.status >= 500
            ? 'server'
            : 'request';
  return new AIError(code, detail || `HTTP ${response.status}`);
};

const send = async (fetchImpl: typeof fetch, { url, init }: HttpRequest, signal?: AbortSignal): Promise<Response> => {
  try {
    return await fetchImpl(url, { ...init, signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw new AIError('cancelled');
    throw new AIError('network', (error as Error)?.message);
  }
};

async function* events(response: Response): AsyncGenerator<Record<string, any>> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {
        continue;
      }
    }
    if (done) return;
  }
}

const readAnthropic = async (response: Response, onProgress: (progress: Progress) => void): Promise<string> => {
  let text = '';
  let stopReason: string | null = null;
  for await (const event of events(response)) {
    if (event.type === 'error') throw new AIError(event.error?.type === 'overloaded_error' ? 'server' : 'request', event.error?.message);
    if (event.type === 'content_block_start' && event.content_block?.type === 'fallback') text = '';
    if (event.type === 'content_block_start' && event.content_block?.type === 'thinking')
      onProgress({ phase: 'thinking', characters: text.length });
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      text += event.delta.text;
      onProgress({ phase: 'writing', characters: text.length });
    }
    if (event.type === 'message_delta' && event.delta?.stop_reason) stopReason = event.delta.stop_reason;
  }
  if (stopReason === 'refusal') throw new AIError('refusal');
  if (stopReason === 'max_tokens') throw new AIError('length');
  return text;
};

const readOpenAI = async (response: Response, onProgress: (progress: Progress) => void): Promise<string> => {
  let text = '';
  let finish: string | null = null;
  for await (const event of events(response)) {
    if (event.error) throw new AIError('request', event.error.message);
    const choice = event.choices?.[0];
    const delta = choice?.delta ?? {};
    if (delta.reasoning || delta.reasoning_content) onProgress({ phase: 'thinking', characters: text.length });
    if (delta.content) {
      text += delta.content;
      onProgress({ phase: 'writing', characters: text.length });
    }
    if (delta.refusal) throw new AIError('refusal', delta.refusal);
    if (choice?.finish_reason) finish = choice.finish_reason;
  }
  if (finish === 'length') throw new AIError('length');
  if (finish === 'content_filter') throw new AIError('refusal');
  return text;
};

const readJson = async (response: Response, format: Format): Promise<string> => {
  const payload = await response.json();
  if (format === 'anthropic') {
    if (payload.stop_reason === 'refusal') throw new AIError('refusal');
    return (payload.content ?? [])
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('');
  }
  return payload.choices?.[0]?.message?.content ?? '';
};

/** Streams a completion from the configured provider and returns its text. */
export const complete = async (
  settings: AISettings | null | undefined,
  { onProgress = () => {}, signal, fetchImpl = fetch, ...request }: CompletionRequest,
): Promise<string> => {
  if (!isReady(settings)) throw new AIError('setup');
  const { format } = providerOf(settings);
  const build = format === 'anthropic' ? anthropicRequest : openaiRequest;
  let response = await send(fetchImpl, build(settings, request), signal);
  if (format === 'openai' && request.schema && (response.status === 400 || response.status === 422)) {
    response = await send(fetchImpl, build(settings, { ...request, schema: undefined }), signal);
  }
  if (!response.ok) throw await errorFor(response);
  if (!/event-stream/.test(response.headers.get('content-type') ?? '')) return readJson(response, format);
  return format === 'anthropic' ? readAnthropic(response, onProgress) : readOpenAI(response, onProgress);
};

export const listModels = async (
  settings: AISettings,
  { fetchImpl = fetch, signal }: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<string[]> => {
  const { format } = providerOf(settings);
  const headers = format === 'anthropic' ? anthropicHeaders(settings) : openaiHeaders(settings);
  delete headers['content-type'];
  const url = `${baseUrlOf(settings)}/models${format === 'anthropic' ? '?limit=1000' : ''}`;
  const response = await send(fetchImpl, { url, init: { headers } }, signal);
  if (!response.ok) throw await errorFor(response);
  const payload = await response.json();
  return ((payload.data ?? payload.models ?? []) as { id?: string; name?: string }[])
    .map((model) => String(model.id ?? model.name ?? '').replace(/^models\//, ''))
    .filter(Boolean)
    .toSorted((a, b) => a.localeCompare(b));
};
