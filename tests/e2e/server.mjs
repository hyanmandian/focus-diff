import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const source = join(root, 'src');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json' };
const CONTENT_SCRIPTS = ['shared.js', 'github.js', 'panel.js', 'content.js'];

const messages = (locale) => {
  const catalog = JSON.parse(readFileSync(join(source, '_locales', locale, 'messages.json'), 'utf8'));
  return Object.fromEntries(Object.entries(catalog).map(([key, { message }]) => [key, message]));
};

const shim = (locale) => `
  (() => {
    const messages = ${JSON.stringify(messages(locale))};
    const memory = { sync: {}, local: {} };
    const changeListeners = [];
    const messageListeners = [];
    const area = (name) => ({
      get: async (key) => ({ [key]: structuredClone(memory[name][key]) }),
      set: async (values) => {
        Object.assign(memory[name], structuredClone(values));
        const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: structuredClone(value) }]));
        changeListeners.forEach((listener) => listener(changes, name));
      },
    });
    window.__sent = [];
    window.__dispatch = (message) => messageListeners.forEach((listener) => listener(message));
    window.chrome = {
      storage: { sync: area('sync'), local: area('local'), onChanged: { addListener: (fn) => changeListeners.push(fn) } },
      commands: { getAll: async () => [] },
      runtime: { id: 'focus-diff-test', sendMessage: async (message) => window.__sent.push(message), onMessage: { addListener: (fn) => messageListeners.push(fn) } },
      i18n: {
        getUILanguage: () => '${locale.replace('_', '-')}',
        getMessage: (key, substitutions = []) =>
          (messages[key] ?? '').replace(/\\$(\\d)/g, (_, index) => substitutions[index - 1] ?? ''),
      },
    };
    memory.sync.config = {
      global: [
        { id: 'frontend', name: 'Frontend', include: '\\\\.(ts|tsx|js|jsx)$', exclude: '\\\\.(test|spec|stories)\\\\.' },
        { id: 'backend', name: 'Backend', include: '\\\\.py$', exclude: '(^|/)tests/' },
        { id: 'docs', name: 'Docs', include: '\\\\.mdx?$', exclude: '' },
      ],
      repos: [],
    };
  })();`;

export const startServer = () =>
  new Promise((resolve) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      const locale = url.searchParams.get('locale') ?? 'en';
      const send = (body, type = 'text/html') => {
        response.writeHead(200, { 'content-type': type });
        response.end(body);
      };

      if (url.pathname === '/test/shim.js') return send(shim(locale), types['.js']);
      if (/^\/octo\/web\/pull\/\d+(\/(changes|files))?$/.test(url.pathname)) {
        const page = readFileSync(join(root, 'tests/e2e/fixtures/pull-request.html'), 'utf8');
        const scripts = [`/test/shim.js?locale=${locale}`, ...CONTENT_SCRIPTS.map((file) => `/ext/${file}`)]
          .map((src) => `<script src="${src}"></script>`)
          .join('');
        return send(page.replace('</body>', `${scripts}</body>`));
      }
      if (/^\/ext\/[\w-]+\.html$/.test(url.pathname)) {
        const page = readFileSync(join(source, url.pathname.slice(5)), 'utf8');
        return send(page.replace('<script src="shared.js">', `<script src="/test/shim.js?locale=${locale}"></script><script src="shared.js">`));
      }
      if (url.pathname.startsWith('/ext/')) {
        try {
          return send(readFileSync(join(source, url.pathname.slice(5))), types[extname(url.pathname)] ?? 'application/octet-stream');
        } catch {
          response.writeHead(404).end();
          return;
        }
      }
      response.writeHead(404).end();
    });
    server.listen(0, () => resolve({ server, origin: `http://localhost:${server.address().port}` }));
  });
