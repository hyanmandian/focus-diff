import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  ' ': { code: 'Space', keyCode: 32, text: ' ' },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
};

const findChrome = () => {
  const found = CANDIDATES.find((path) => path && existsSync(path));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.');
  return found;
};

const connect = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Set();
    let id = 0;
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id === undefined) return listeners.forEach((listener) => listener(message));
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
    };
    socket.onerror = () => reject(new Error(`Could not connect to ${url}`));
    socket.onopen = () =>
      resolve({
        send: (method, params = {}, sessionId) =>
          new Promise((resolveRequest, rejectRequest) => {
            pending.set(++id, { method, resolve: resolveRequest, reject: rejectRequest });
            socket.send(JSON.stringify({ id, method, params, sessionId }));
          }),
        listen: (listener) => listeners.add(listener),
        close: () => socket.close(),
      });
  });

const createPage = async (connection) => {
  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => connection.send(method, params, sessionId);
  const errorListeners = [];
  const waiters = new Set();
  let inflight = 0;
  let lastActivity = Date.now();

  connection.listen((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      const error = { message: details.exception?.description?.split('\n')[0] ?? details.text };
      errorListeners.forEach((listener) => listener(error));
    }
    if (message.method === 'Network.requestWillBeSent') inflight++;
    if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') inflight = Math.max(0, inflight - 1);
    if (message.method.startsWith('Network.')) lastActivity = Date.now();
    waiters.forEach((waiter) => waiter(message));
  });

  const waitFor = (method) =>
    new Promise((resolve) => {
      const waiter = (message) => {
        if (message.method !== method) return;
        waiters.delete(waiter);
        resolve(message.params);
      };
      waiters.add(waiter);
    });

  const networkIdle = async (quietMs = 300, timeoutMs = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (inflight === 0 && Date.now() - lastActivity >= quietMs) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Network.enable')]);

  const evaluate = async (fn, ...args) => {
    const expression = typeof fn === 'function' ? `(${fn})(...${JSON.stringify(args)})` : fn;
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };

  const press = async (key, modifiers = 0) => {
    const { code, keyCode, text } = KEYS[key] ?? { code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), text: key };
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };

  const $eval = (selector, fn, ...args) =>
    evaluate(
      `((selector, fn, args) => { const element = document.querySelector(selector); if (!element) throw new Error('No element matches ' + selector); return fn(element, ...args); })(${JSON.stringify(selector)}, ${fn}, ${JSON.stringify(args)})`,
    );

  const $$eval = (selector, fn, ...args) =>
    evaluate(`((selector, fn, args) => fn([...document.querySelectorAll(selector)], ...args))(${JSON.stringify(selector)}, ${fn}, ${JSON.stringify(args)})`);

  return {
    $eval,
    $$eval,
    on: (event, listener) => event === 'pageerror' && errorListeners.push(listener),
    evaluate,
    emulateMediaFeatures: (features) => send('Emulation.setEmulatedMedia', { features }),
    setViewport: ({ width, height, deviceScaleFactor = 1 }) =>
      send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false }),
    goto: async (url) => {
      const loaded = waitFor('Page.loadEventFired');
      await send('Page.navigate', { url });
      await loaded;
      await networkIdle();
    },
    click: async (selector, { shift = false } = {}) => {
      const box = await evaluate((target) => {
        const element = document.querySelector(target);
        if (!element) throw new Error(`No element matches ${target}`);
        element.scrollIntoView({ block: 'center', inline: 'center' });
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x: x + width / 2, y: y + height / 2 };
      }, selector);
      const modifiers = shift ? 8 : 0;
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, ...box, button: 'left', clickCount: 1, modifiers });
      }
    },
    keyboard: { press },
    screenshot: async ({ path, clip }) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip && { clip: { ...clip, scale: 1 } }) });
      writeFileSync(path, Buffer.from(data, 'base64'));
    },
    accessibilityTree: async (selector) => {
      const { result } = await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
      if (!result.objectId) return [];
      const { nodes } = await send('Accessibility.queryAXTree', { objectId: result.objectId });
      return nodes;
    },
    send,
    close: () => connection.send('Target.closeTarget', { targetId }),
  };
};

export const launch = async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focus-diff-chrome-'));
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--hide-scrollbars',
      '--mute-audio',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${output}`)), 15000);
    chrome.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    chrome.on('exit', (code) => reject(new Error(`Chrome exited with code ${code}:\n${output}`)));
  });

  const connection = await connect(endpoint);
  return {
    newPage: () => createPage(connection),
    close: async () => {
      await connection.send('Browser.close').catch(() => {});
      connection.close();
      await new Promise((resolve) => (chrome.exitCode === null ? chrome.once('exit', resolve) : resolve()));
      rmSync(profile, { recursive: true, force: true });
    },
  };
};
