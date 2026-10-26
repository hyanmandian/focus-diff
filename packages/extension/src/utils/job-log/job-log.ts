// A GitHub Actions job's log, as the desktop's logs.rs: the end of it, when it's long. GitHub answers with a redirect
// to its storage, which the browser follows without the token. A finished job's log doesn't change, so the last few
// are kept.

import type { GitHubApi } from "@/utils/github-api/github-api";
import { returned } from "@/utils/github-api/github-api";
import { tr } from "@/utils/words/words";

/** What's kept of a log: its last megabyte, from the start of a line. */
export const TAIL = 1024 * 1024;
/** How many finished logs are kept. */
export const MOST = 12;

export type Log = { text: string; truncated: boolean };

/** Where GitHub keeps logs, over https. */
export const trusted = (url: string): boolean => {
  if (!url.startsWith("https://")) return false;
  const host = url.slice("https://".length).split(/[/?#]/u)[0]!;
  if (host.includes("@") || host.includes(":")) return false;
  return [".blob.core.windows.net", ".actions.githubusercontent.com", ".githubusercontent.com"].some((s) =>
    host.endsWith(s),
  );
};

/** The end of a log, at most `max` bytes, starting at a line when it was cut. */
export const tail = (text: string, max: number): Log => {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return { text, truncated: false };
  let kept = bytes.subarray(bytes.length - max);
  const newline = kept.indexOf(10);
  if (newline !== -1) kept = kept.subarray(newline + 1);
  return { text: new TextDecoder().decode(kept), truncated: true };
};

/** An owner's or a repository's name. */
export const nameOk = (name: string): boolean => /^[\w.-]+$/u.test(name) && name !== "." && name !== "..";

export const createJobLogs = (api: Pick<GitHubApi, "follow">) => {
  const kept = new Map<number, Log>();

  return async (owner: string, repo: string, job: number, done: boolean): Promise<Log> => {
    if (!nameOk(owner) || !nameOk(repo) || !Number.isSafeInteger(job) || job < 0) throw new Error("Bad request");
    const known = done ? kept.get(job) : undefined;
    if (known) return known;
    let response: Response;
    try {
      response = await api.follow(`/repos/${owner}/${repo}/actions/jobs/${job}/logs`);
    } catch (error) {
      const e = error instanceof Error ? error.message : String(error);
      throw new Error(tr(`Couldn't download the log: ${e}`, `Não foi possível baixar o log: ${e}`), { cause: error });
    }
    const { status } = response;
    if (status === 404 || status === 410)
      throw new Error(
        tr(
          "This job's log isn't available (yet, or any more).",
          "O log deste job não está disponível (ainda, ou não mais).",
        ),
      );
    if (status === 403) throw new Error(tr("You can't read this job's log.", "Você não pode ler o log deste job."));
    if (status !== 200) throw new Error(returned(status));
    if (response.redirected && !trusted(response.url))
      throw new Error(
        tr("GitHub sent the log from somewhere unexpected.", "O GitHub mandou o log de um lugar inesperado."),
      );
    const log = tail(await response.text(), TAIL);
    if (done) {
      kept.delete(job);
      kept.set(job, log);
      if (kept.size > MOST) kept.delete(kept.keys().next().value!);
    }
    return log;
  };
};
