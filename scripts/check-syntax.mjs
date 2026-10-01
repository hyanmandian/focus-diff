import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = new URL('../src', import.meta.url).pathname;
for (const file of readdirSync(source).filter((name) => name.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', join(source, file)], { stdio: 'inherit' });
}
for (const locale of readdirSync(join(source, '_locales'))) {
  JSON.parse(readFileSync(join(source, '_locales', locale, 'messages.json'), 'utf8'));
}
JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
console.log('Syntax OK');
