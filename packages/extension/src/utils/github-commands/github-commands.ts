// The app's GitHub-side commands, as the background answers them for the pages (the desktop's lib.rs answers the same
// names): calls to GitHub with the token, files at a commit, a job's log, signing in, the viewed marks and pending
// review comments on their way, and each review's last copy.

import type { DraftPut, UploadError } from "@focus-diff/app/utils/bridge";

import { createBlobs } from "@/utils/blobs/blobs";
import type { Commands } from "@/utils/command-server/command-server";
import { startDrafts } from "@/utils/drafts/drafts";
import type { GitHubApi } from "@/utils/github-api/github-api";
import { createJobLogs } from "@/utils/job-log/job-log";
import { keptRead, keptWrite } from "@/utils/kept/kept";
import { isRecord } from "@/utils/record/record";
import { startOutbox } from "@/utils/viewed-outbox/viewed-outbox";
import { tr } from "@/utils/words/words";

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const maybe = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number => (typeof value === "number" ? value : Number.NaN);

const badRequest = () => new Error("Bad request");
const side = (value: unknown) => (value === "deletions" ? "deletions" : "additions");

/** A comment for the pending review, as the page sends it. */
export const readPut = (value: unknown): DraftPut => {
  if (!isRecord(value)) throw badRequest();
  const v = value;
  if (![v.key, v.pull, v.path, v.body].every((s) => typeof s === "string") || typeof v.line !== "number")
    throw badRequest();
  return {
    key: text(v.key),
    pull: text(v.pull),
    path: text(v.path),
    line: v.line,
    side: side(v.side),
    ...(typeof v.startLine === "number" ? { startLine: v.startLine } : {}),
    ...(typeof v.startSide === "string" ? { startSide: side(v.startSide) } : {}),
    ...(v.file === true ? { file: true } : {}),
    body: text(v.body),
    ...(typeof v.id === "string" ? { id: v.id } : {}),
    ...(typeof v.replyTo === "string" ? { replyTo: v.replyTo } : {}),
  };
};

/** Why attaching a file isn't done here: github.com's own uploads need a page of github.com, which the background
 *  isn't (the screens hide attaching in the browser, Platform.features.uploads). */
const uploadUnavailable = (): UploadError => ({
  kind: "failed",
  message: tr(
    "Attaching pictures and videos needs Focus Diff for Mac",
    "Anexar imagens e vídeos precisa do Focus Diff para Mac",
  ),
});

/** Starts sending what was left on its way (pending comments, viewed marks) and answers the commands. `emit` tells the
 *  pages an event ("drafts"). */
export const startGitHubCommands = async (
  api: GitHubApi,
  emit: (event: string, payload: unknown) => void,
): Promise<Commands> => {
  const drafts = await startDrafts(api, emit);
  const outbox = await startOutbox(api);
  const fileAt = createBlobs(api);
  const jobLog = createJobLogs(api);

  return {
    github: ({ method, path, body, accept }) =>
      api.requestForPage(text(method), text(path), maybe(body), maybe(accept)),
    github_file: ({ repo, sha, path }) => fileAt(text(repo), text(sha), text(path)),
    job_log: ({ owner, repo, job, done }) => jobLog(text(owner), text(repo), count(job), done === true),

    auth_status: () => api.status(),
    auth_use_gh: () => {
      throw new Error(
        tr(
          "The GitHub CLI can't be used from a browser: sign in with GitHub or a token",
          "O GitHub CLI não pode ser usado num navegador: entre com o GitHub ou um token",
        ),
      );
    },
    auth_use_token: ({ token }) => api.useToken(text(token)),
    auth_device_start: () => api.deviceStart(),
    auth_device_finish: ({ deviceCode, interval, expiresIn }) =>
      api.deviceFinish(text(deviceCode), count(interval), count(expiresIn)),
    auth_sign_out: () => api.signOut(),

    queue_viewed: ({ pull, path, viewed }) => outbox.add(text(pull), text(path), viewed === true),
    queued_viewed: ({ pull }) => outbox.pending(text(pull)),

    drafts_put: ({ put }) => drafts.put(readPut(put)),
    drafts_remove: ({ pull, key, id }) => drafts.remove(text(pull), text(key), maybe(id)),
    drafts_state: ({ pull }) => drafts.pending(text(pull)),
    drafts_retry: ({ pull }) => drafts.retry(text(pull)),
    drafts_forget: ({ pull }) => drafts.forget(text(pull)),
    drafts_flush: ({ pull }) => drafts.flush(text(pull)),

    kept_read: ({ id }) => keptRead(text(id)),
    kept_write: ({ id, contents }) => keptWrite(text(id), text(contents)),

    // Signing in on github.com itself, for attaching files: not in the browser.
    github_web_session: () => null,
    sign_in_web: () => null,
    sign_out_web: () => null,
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the pages tell an upload's errors apart by their kind, as the desktop sends them
    upload_attachment: () => Promise.reject(uploadUnavailable()),
  };
};
