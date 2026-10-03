import { createDemo } from './demo';
import { SAMPLE_PULL_REQUEST } from './sample';

/**
 * The demo for pages outside the extension, like the site, built by `npm run build:demo`: every element marked
 * `data-focus-diff-demo` gets the sample pull request. Its settings button goes to the element's `data-settings` link,
 * or to the project's page.
 */
for (const target of document.querySelectorAll<HTMLElement>('[data-focus-diff-demo]')) {
  const settings = target.dataset.settings || 'https://github.com/hyanmandian/focus-diff#readme';
  createDemo(target, SAMPLE_PULL_REQUEST, { onSettings: () => location.assign(settings) });
}
