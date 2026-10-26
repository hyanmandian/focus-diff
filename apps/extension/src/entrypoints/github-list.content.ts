import { defineContentScript } from "#imports";
import { closeUpList } from "@/utils/github-virtual-list/github-virtual-list";

/**
 * In the page's own world, beside GitHub's scripts, for the one thing the bar's content script can't reach: the layout
 * of GitHub's virtual diff list. It only ever reads which files the bar hides, from an attribute on `<html>`.
 */
export default defineContentScript({
  matches: ["https://github.com/*"],
  world: "MAIN",
  runAt: "document_idle",
  // Safari runs it in the page's world from version 18. An older one runs it beside the bar instead, where GitHub's list
  // can't be reached, so it does nothing and the gaps stay.
  main: () => closeUpList(),
});
