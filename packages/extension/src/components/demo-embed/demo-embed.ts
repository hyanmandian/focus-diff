import { createDemo } from "@/components/demo/demo";
import { SAMPLE_PULL_REQUEST } from "@/utils/demo-sample/demo-sample";

import theme from "@/components/github-theme/github-theme.css?inline";

for (const target of document.querySelectorAll<HTMLElement>("[data-focus-diff-demo]")) {
  const settings = target.dataset.settings || "https://github.com/hyanmandian/focus-diff#readme";
  createDemo(target, SAMPLE_PULL_REQUEST, {
    onSettings: () => {
      location.assign(settings);
    },
    theme,
  });
}
