import { createDemo } from "@/components/demo/demo";
import { SAMPLE_PULL_REQUEST } from "@/utils/demo-sample/demo-sample";

import theme from "@/components/github-theme/github-theme.css?inline";

/**
 * The demo for pages outside the extension, like the site, built by `npm run build:demo`: every element marked
 * `data-focus-diff-demo` gets the sample pull request, in GitHub's colours. Its settings button goes to the element's
 * `data-settings` link, or to the project's page.
 */
for (const target of document.querySelectorAll<HTMLElement>("[data-focus-diff-demo]")) {
  const settings = target.dataset.settings || "https://github.com/hyanmandian/focus-diff#readme";
  createDemo(target, SAMPLE_PULL_REQUEST, { onSettings: () => location.assign(settings), theme });
}
