import { describe, expect, it } from 'vitest';
import { AIError, complete, isReady, listModels, originOf, type AISettings } from '@/utils/ai';

const sse = (events: (object | string)[]) =>
  new Response(events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

const recorder = (...responses: Response[]) => {
  const calls: { url: string; init: RequestInit & { headers: Record<string, string> }; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
    calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : null });
    return responses.shift()!;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};

const anthropic: AISettings = { provider: 'anthropic', apiKey: ' sk-ant-test ', model: 'claude-opus-5-5' };
const openai: AISettings = { provider: 'openai', apiKey: 'sk-test', model: 'gpt-test' };
const request = {
  system: 'Be brief.',
  prompt: 'Guide this.',
  schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
};

describe('settings', () => {
  it('knows when a provider is ready', () => {
    expect(isReady(anthropic)).toBe(true);
    expect(isReady({ ...anthropic, apiKey: '' })).toBe(false);
    expect(isReady({ provider: 'ollama', model: 'llama3' })).toBe(true);
    expect(isReady({ provider: 'custom', baseUrl: 'not a url', model: 'x' })).toBe(false);
  });

  it('asks only for the provider host', () => {
    expect(originOf(anthropic)).toBe('https://api.anthropic.com/*');
    expect(originOf({ provider: 'ollama' })).toBe('http://localhost/*');
    expect(originOf({ provider: 'custom', baseUrl: 'https://llm.example.com:8443/v1/' })).toBe('https://llm.example.com/*');
  });
});

describe('Anthropic', () => {
  it('streams a structured answer from the Messages API', async () => {
    const progress: string[] = [];
    const { calls, fetchImpl } = recorder(
      sse([
        { type: 'message_start', message: {} },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"ok":' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'true}' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' },
      ]),
    );
    const text = await complete(anthropic, { ...request, fetchImpl, onProgress: (event) => progress.push(event.phase) });
    expect(text).toBe('{"ok":true}');
    expect(progress).toEqual(['thinking', 'writing', 'writing']);

    const [call] = calls;
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call?.init.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    });
    expect(call?.body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      stream: true,
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Guide this.' }],
      output_config: { format: { type: 'json_schema', schema: request.schema } },
    });
    expect(call?.body.thinking).toBeUndefined();
  });

  it('only opts into fallbacks where they apply', async () => {
    const { calls, fetchImpl } = recorder(sse([{ type: 'message_delta', delta: { stop_reason: 'end_turn' } }]));
    await complete({ ...anthropic, model: 'claude-haiku-4-5' }, { ...request, fetchImpl });
    expect(calls[0]?.body.fallbacks).toBeUndefined();
    expect(calls[0]?.init.headers['anthropic-beta']).toBeUndefined();
  });

  it('starts over when a fallback model takes the turn', async () => {
    const { fetchImpl } = recorder(
      sse([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
        { type: 'content_block_start', content_block: { type: 'fallback' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      ]),
    );
    expect(await complete(anthropic, { ...request, fetchImpl })).toBe('{}');
  });

  it('reports refusals, truncation and HTTP errors', async () => {
    const refusal = recorder(sse([{ type: 'message_delta', delta: { stop_reason: 'refusal' } }]));
    await expect(complete(anthropic, { ...request, fetchImpl: refusal.fetchImpl })).rejects.toMatchObject({ code: 'refusal' });
    const truncated = recorder(sse([{ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }]));
    await expect(complete(anthropic, { ...request, fetchImpl: truncated.fetchImpl })).rejects.toMatchObject({ code: 'length' });
    const rejected = recorder(new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }));
    await expect(complete(anthropic, { ...request, fetchImpl: rejected.fetchImpl })).rejects.toMatchObject({
      code: 'auth',
      detail: 'invalid x-api-key',
    });
    const failing = (async () => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    await expect(complete(anthropic, { ...request, fetchImpl: failing })).rejects.toBeInstanceOf(AIError);
  });

  it('needs complete settings', async () => {
    await expect(complete(null, request)).rejects.toMatchObject({ code: 'setup' });
  });

  it('lists models', async () => {
    const { calls, fetchImpl } = recorder(new Response(JSON.stringify({ data: [{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-4-5' }] })));
    expect(await listModels(anthropic, { fetchImpl })).toEqual(['claude-haiku-4-5', 'claude-opus-5-5']);
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
  });
});

describe('OpenAI-compatible', () => {
  it('streams chat completions with a JSON schema', async () => {
    const { calls, fetchImpl } = recorder(
      sse([{ choices: [{ delta: { content: '{"a"' } }] }, { choices: [{ delta: { content: ':1}' }, finish_reason: 'stop' }] }, '[DONE]']),
    );
    expect(await complete(openai, { ...request, fetchImpl })).toBe('{"a":1}');
    const [call] = calls;
    expect(call?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call?.init.headers.authorization).toBe('Bearer sk-test');
    expect(call?.body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Guide this.' },
    ]);
    expect(call?.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
  });

  it('retries without a schema when the provider does not support one', async () => {
    const { calls, fetchImpl } = recorder(
      new Response('{"error":{"message":"response_format not supported"}}', { status: 400 }),
      sse([{ choices: [{ delta: { content: '{}' }, finish_reason: 'stop' }] }]),
    );
    expect(await complete({ provider: 'ollama', model: 'llama3' }, { ...request, fetchImpl })).toBe('{}');
    expect(calls[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(calls[0]?.init.headers.authorization).toBeUndefined();
    expect(calls[1]?.body.response_format).toBeUndefined();
  });

  it('identifies itself to OpenRouter', async () => {
    const { calls, fetchImpl } = recorder(sse([{ choices: [{ delta: { content: '{}' }, finish_reason: 'stop' }] }]));
    await complete({ provider: 'openrouter', apiKey: 'k', model: 'some/model' }, { ...request, fetchImpl });
    expect(calls[0]?.init.headers['x-title']).toBe('Focus Diff');
  });

  it('accepts a plain JSON answer from servers that do not stream', async () => {
    const { fetchImpl } = recorder(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"b":2}' } }] }), { headers: { 'content-type': 'application/json' } }),
    );
    expect(await complete(openai, { ...request, fetchImpl })).toBe('{"b":2}');
  });

  it('reports a cut-off answer', async () => {
    const { fetchImpl } = recorder(sse([{ choices: [{ delta: { content: '{' }, finish_reason: 'length' }] }]));
    await expect(complete(openai, { ...request, fetchImpl })).rejects.toMatchObject({ code: 'length' });
  });

  it('lists models, including Gemini names', async () => {
    const { fetchImpl } = recorder(new Response(JSON.stringify({ data: [{ id: 'models/gemini-pro' }, { id: 'gpt-x' }] })));
    expect(await listModels(openai, { fetchImpl })).toEqual(['gemini-pro', 'gpt-x']);
  });
});
