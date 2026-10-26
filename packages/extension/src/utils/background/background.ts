// The background: what the desktop's Rust is to its windows (src-tauri/src/lib.rs). It answers the pages' commands
// over their ports, runs the queues on an alarm and notifies, keeps the GitHub token and the app's files, sends the
// keyboard shortcuts to the bar on github.com, and on install or update opens setup (moving the old settings over).
// Every listener is added as it starts, so the browser can wake it for any of them.

import type { Snapshot } from "@focus-diff/core/queue-panel";
import { browser } from "wxt/browser";

import { storage } from "#imports";
import { appFileCommands, fileKey, FILES, readAppFile } from "@/utils/app-files/app-files";
import { browserCommands } from "@/utils/browser-commands/browser-commands";
import { startCommandServer, type Commands } from "@/utils/command-server/command-server";
import { createGitHubApi } from "@/utils/github-api/github-api";
import { startGitHubCommands } from "@/utils/github-commands/github-commands";
import { legacyDismissals, migrate, takeLegacyDone } from "@/utils/migration/migration";
import { startQueues } from "@/utils/queue-service/queue-service";
import { windowCommands } from "@/utils/windows/windows";
import { followConfig } from "@/utils/words/words";

/** The bar's keyboard shortcuts (the manifest's commands), for the tab in front. */
export const forwardCommand = async (command: string) => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  try {
    await browser.tabs.sendMessage(tab.id, { type: "command", command });
  } catch {
    // Not a page with the bar.
  }
};

/** The pull requests the old extension's popup had marked done, taken off their queues once GitHub has answered. */
export const applyLegacyDone = async (
  snapshot: Pick<Snapshot, "signedIn" | "status"> & {
    items: Record<string, ReadonlyArray<{ pr: { id: string; url: string; updatedAt: string } }>>;
  },
  dismiss: (queueId: string, prId: string) => Promise<void>,
) => {
  if (!snapshot.signedIn || snapshot.status.phase !== "idle" || snapshot.status.updatedAt === 0) return;
  const done = await takeLegacyDone();
  if (!done) return;
  const items = Object.entries(snapshot.items).flatMap(([queueId, list]) =>
    list.map((item) => ({ queueId, pr: item.pr })),
  );
  await Promise.all(legacyDismissals(done, items).map(([queueId, prId]) => dismiss(queueId, prId)));
};

export const startBackground = () => {
  const commands: Commands = {};
  const ready = Promise.withResolvers<null>();
  const server = startCommandServer(commands, ready.promise);
  const api = createGitHubApi();
  let applying = false;
  const queues = startQueues({
    request: (method, path, body, accept) => api.request(method, path, body, accept),
    login: () => api.login(),
    server: {
      broadcast: (event, payload) => {
        server.broadcast(event, payload);
        if (event !== "snapshot" || applying) return;
        applying = true;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the queues' own snapshot, as they publish it
        void applyLegacyDone(payload as Snapshot, (queueId, prId) => queues.watch.dismiss(queueId, prId)).finally(
          () => {
            applying = false;
          },
        );
      },
    },
  });
  Object.assign(commands, browserCommands(), windowCommands(server), appFileCommands(), queues.commands);
  // The GitHub commands once what was on its way to GitHub (pending comments, viewed marks) is read back.
  void startGitHubCommands(api, server.broadcast)
    .then((github) => Object.assign(commands, github))
    .catch((error: unknown) => {
      // Without them the other commands still answer; the pages say what GitHub's couldn't.
      console.error(error);
    })
    .finally(() => {
      ready.resolve(null);
    });

  // The app's files: every page follows a change, whoever made it (the bar on github.com writes the pace too).
  void readAppFile("config").then(followConfig);
  for (const name of FILES) {
    storage.watch<string>(fileKey(name), (contents) => {
      if (name === "config") {
        followConfig(contents);
        void queues.configChanged();
      }
      server.broadcast("file-changed", name);
    });
  }
  api.onChange(() => void queues.authChanged());

  browser.alarms.onAlarm.addListener((alarm) => void queues.onAlarm(alarm));
  browser.commands.onCommand.addListener((command) => void forwardCommand(command));
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void (async () => {
      if (reason === "update" && !(await migrate()).migrated) return;
      if (reason !== "install" && reason !== "update") return;
      // First run, or the first since the extension became the app: connect GitHub, pick queues.
      await browser.tabs.create({ url: browser.runtime.getURL("/setup.html") });
    })();
  });
};
