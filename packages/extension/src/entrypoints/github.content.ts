// First, before the app's modules load: they set <html lang> and data-platform for pages of their own, and what GitHub
// had is read here to go back once the bar is up (utils/bar-language).
// oxlint-disable-next-line import/no-unassigned-import -- loaded first for what it reads, nothing to name
import "@/utils/host-page/host-page";
import { defineContentScript } from "#imports";
import { mountBar } from "@/components/mount-bar/mount-bar";
import { github } from "@/utils/github-provider/github-provider";

export default defineContentScript({
  matches: github.matches,
  runAt: "document_idle",
  cssInjectionMode: "ui",
  main: (ctx) => mountBar(ctx, github),
});
