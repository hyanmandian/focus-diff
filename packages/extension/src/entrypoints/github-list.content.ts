import { defineContentScript } from "#imports";
import { closeUpList } from "@/utils/github-virtual-list/github-virtual-list";

export default defineContentScript({
  matches: ["https://github.com/*"],
  world: "MAIN",
  runAt: "document_idle",
  main: () => {
    closeUpList();
  },
});
