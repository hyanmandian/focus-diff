import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = join(root, 'src');
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));

const targets = {
  chrome: (base) => base,
  firefox: ({ background, minimum_chrome_version, options_page, author, ...base }) => ({
    ...base,
    author: 'Hyan Mandian',
    background: { scripts: ['shared.js', 'background.js'] },
    options_ui: { page: options_page, open_in_tab: true },
    browser_specific_settings: {
      gecko: {
        id: 'focus-diff@hyan.com.br',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  }),
};

rmSync(dist, { recursive: true, force: true });

for (const [target, transform] of Object.entries(targets)) {
  const folder = join(dist, target);
  mkdirSync(folder, { recursive: true });
  cpSync(source, folder, { recursive: true, filter: (path) => !path.split('/').pop().startsWith('.') });
  writeFileSync(join(folder, 'manifest.json'), `${JSON.stringify(transform(structuredClone(manifest)), null, 2)}\n`);
  const zip = join(dist, `focus-diff-${manifest.version}-${target}.zip`);
  execFileSync('zip', ['-qr', zip, '.'], { cwd: folder });
  console.log(`dist/${zip.split('/dist/')[1]}`);
}
