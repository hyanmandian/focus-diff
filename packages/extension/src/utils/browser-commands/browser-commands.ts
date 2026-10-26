// The app's commands a browser has no part of: updating (the extension stores do it), the AI tools and commands on
// the computer (the screens hide them: Platform.features), and the desktop's own windows' housekeeping.

import type { Commands } from "@/utils/command-server/command-server";
import { tr } from "@/utils/words/words";

const nothing = () => null;

/** What a command needing the Mac app says in the browser. */
const needsMac = (what: () => string) => () => {
  throw new Error(what());
};

export const browserCommands = (): Commands => ({
  update_offered: nothing,
  check_update: nothing,
  install_update: needsMac(() =>
    tr("Your browser updates Focus Diff from its extension store", "Seu navegador atualiza o Focus Diff pela loja de extensões"),
  ),
  // No AI tools in a browser: none installed, as the screens say when there's none on a Mac.
  ai_statuses: () => [],
  ai_models: () => [],
  ai_ask: needsMac(() => tr("Asking the AI needs Focus Diff for Mac", "Perguntar à IA precisa do Focus Diff para Mac")),
  ai_prepare: nothing,
  ai_cancel: nothing,
  // An action's other steps (comments, reviewers, labels, links) run in the page; a command can't run in a browser,
  // so the action stops at it, saying so.
  run_action: needsMac(() =>
    tr(
      "Commands can't run in a browser: this step needs Focus Diff for Mac",
      "Comandos não rodam no navegador: este passo precisa do Focus Diff para Mac",
    ),
  ),
  // The desktop's windows and menu bar.
  spare_ready: nothing,
  menu_state: nothing,
  hide_panel: nothing,
  quit: nothing,
  log: nothing,
});
