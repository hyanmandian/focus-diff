import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = new URL('../src', import.meta.url).pathname;
const problems = [];
const warnings = [];
const read = (file) => readFileSync(join(source, file), 'utf8');
const files = readdirSync(source);
const scripts = files.filter((name) => name.endsWith('.js'));
const pages = files.filter((name) => name.endsWith('.html'));

for (const file of scripts) {
  try {
    execFileSync(process.execPath, ['--check', join(source, file)], { stdio: 'pipe' });
  } catch (error) {
    problems.push(`${file}: ${error.stderr.toString().trim()}`);
  }
}

const UNSAFE = [
  [/\.(innerHTML|outerHTML)\s*=/, 'assigns HTML strings; build DOM nodes instead'],
  [/insertAdjacentHTML|document\.write\(/, 'writes HTML strings; build DOM nodes instead'],
  [/\beval\(|new Function\(/, 'evaluates code from strings'],
  [/set(Timeout|Interval)\(\s*['"`]/, 'evaluates code from strings'],
];
for (const file of scripts) {
  read(file)
    .split('\n')
    .forEach((line, index) => {
      for (const [pattern, reason] of UNSAFE) if (pattern.test(line)) problems.push(`${file}:${index + 1} ${reason}`);
    });
}

for (const file of pages) {
  const html = read(file);
  if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) problems.push(`${file}: inline <script> is blocked by the extension content security policy`);
  if (/\son[a-z]+\s*=/.test(html)) problems.push(`${file}: inline event handlers are blocked by the extension content security policy`);
}

for (const name of files) {
  if (name.startsWith('_') && name !== '_locales') problems.push(`${name}: names starting with "_" are reserved by the browser`);
  if (name.startsWith('.')) problems.push(`${name}: hidden files don't belong in the extension`);
}

let manifest;
try {
  manifest = JSON.parse(read('manifest.json'));
} catch (error) {
  problems.push(`manifest.json: ${error.message}`);
}

const catalogs = {};
for (const locale of readdirSync(join(source, '_locales'))) {
  try {
    catalogs[locale] = JSON.parse(read(join('_locales', locale, 'messages.json')));
  } catch (error) {
    problems.push(`_locales/${locale}: ${error.message}`);
  }
}

const reference = catalogs[manifest?.default_locale] ?? {};
const placeholders = (message) => [...message.matchAll(/\$(\d)/g)].map(([, index]) => index).sort().join(',');
for (const [locale, catalog] of Object.entries(catalogs)) {
  for (const key of Object.keys(reference)) {
    if (!catalog[key]) problems.push(`_locales/${locale}: missing "${key}"`);
    else if (placeholders(catalog[key].message) !== placeholders(reference[key].message)) problems.push(`_locales/${locale}: "${key}" uses different placeholders`);
  }
  for (const key of Object.keys(catalog)) if (!reference[key]) problems.push(`_locales/${locale}: "${key}" is not in ${manifest?.default_locale}`);
}

if (manifest) {
  const referenced = [
    ...Object.values(manifest.icons ?? {}),
    manifest.background?.service_worker,
    manifest.options_page,
    ...(manifest.content_scripts ?? []).flatMap((entry) => [...(entry.js ?? []), ...(entry.css ?? [])]),
  ].filter(Boolean);
  for (const file of referenced) if (!existsSync(join(source, file))) problems.push(`manifest.json: ${file} does not exist`);
  for (const [, key] of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) if (!reference[key]) problems.push(`manifest.json: no message "${key}"`);
  if (!existsSync(join(source, '_locales', manifest.default_locale ?? ''))) problems.push('manifest.json: default_locale has no folder');
}

const everything = [...scripts, ...pages].map(read).join('\n');
const used = new Set([...everything.matchAll(/['"`]([a-zA-Z][\w]*)['"`]/g)].map(([, key]) => key));
for (const [, key] of everything.matchAll(/data-i18n(?:-html|-placeholder|-label)?="(\w+)"/g)) used.add(key);
for (const [, key] of everything.matchAll(/(?<![\w.])t\(\s*['"`](\w+)['"`]/g)) if (!reference[key]) problems.push(`no message "${key}" for t('${key}')`);
for (const [, key] of everything.matchAll(/data-i18n(?:-html|-placeholder|-label)?="(\w+)"/g)) if (!reference[key]) problems.push(`no message "${key}" for data-i18n`);
const manifestKeys = new Set([...JSON.stringify(manifest ?? {}).matchAll(/__MSG_(\w+)__/g)].map(([, key]) => key));
for (const key of Object.keys(reference)) if (!used.has(key) && !manifestKeys.has(key)) warnings.push(`message "${key}" looks unused`);

warnings.forEach((warning) => console.warn(`warning  ${warning}`));
if (problems.length) {
  problems.forEach((problem) => console.error(`error    ${problem}`));
  process.exit(1);
}
console.log(`Lint OK: ${scripts.length} scripts, ${pages.length} pages, ${Object.keys(catalogs).length} locales`);
