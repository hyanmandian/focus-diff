import { describe, expect, it, vi } from "vitest";

import { createJobLogs, MOST, nameOk, tail, trusted } from "./job-log";

/** A response as fetch gives it after following GitHub's redirect to `url`. */
const answer = (status: number, body = "", url = "") => {
  const response = new Response(body, { status });
  Object.defineProperties(response, { redirected: { value: url !== "" }, url: { value: url } });
  return response;
};

describe("a job's log", () => {
  it("is kept whole when short", () => {
    expect(tail("one\ntwo\n", 100)).toEqual({ text: "one\ntwo\n", truncated: false });
  });

  it("keeps the end of a long one, from a line's start", () => {
    const log = Array.from({ length: 1000 }, (_, i) => `line ${i}\n`).join("");
    const { text, truncated } = tail(log, 50);
    expect(truncated).toBe(true);
    expect(text.endsWith("line 999\n")).toBe(true);
    expect(text.startsWith("line ")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(50);
    expect(tail("x".repeat(20), 5)).toEqual({ text: "xxxxx", truncated: true });
  });

  it("comes only from GitHub's storage", () => {
    expect(trusted("https://productionresultssa11.blob.core.windows.net/actions-results/x?sig=1")).toBe(true);
    expect(trusted("https://pipelines.actions.githubusercontent.com/abc")).toBe(true);
    expect(trusted("http://productionresultssa11.blob.core.windows.net/x")).toBe(false);
    expect(trusted("https://evil.com/.blob.core.windows.net")).toBe(false);
    expect(trusted("https://user@x.blob.core.windows.net/")).toBe(false);
    expect(trusted("https://x.blob.core.windows.net:8443/")).toBe(false);
    expect(trusted("https://blob.core.windows.net.evil.com/")).toBe(false);
  });

  it("checks names", () => {
    expect(nameOk("focus-diff.pro")).toBe(true);
    expect(nameOk("..")).toBe(false);
    expect(nameOk(".")).toBe(false);
    expect(nameOk("a/b")).toBe(false);
    expect(nameOk("")).toBe(false);
  });

  it("is fetched from the job's logs, and a finished one is kept", async () => {
    const api = {
      follow: vi.fn<() => Promise<Response>>(() =>
        Promise.resolve(answer(200, "ok\n", "https://x.blob.core.windows.net/log")),
      ),
    };
    const jobLog = createJobLogs(api);
    await expect(jobLog("acme", "web", 7, true)).resolves.toEqual({ text: "ok\n", truncated: false });
    await jobLog("acme", "web", 7, true);
    expect(api.follow).toHaveBeenCalledTimes(1);
    expect(api.follow).toHaveBeenCalledWith("/repos/acme/web/actions/jobs/7/logs");
    await jobLog("acme", "web", 8, false);
    await jobLog("acme", "web", 8, false);
    expect(api.follow).toHaveBeenCalledTimes(3);
  });

  it("keeps the latest finished ones only", async () => {
    const api = { follow: vi.fn<() => Promise<Response>>(() => Promise.resolve(answer(200, "ok"))) };
    const jobLog = createJobLogs(api);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
    for (let job = 0; job <= MOST; job++) await jobLog("acme", "web", job, true);
    await jobLog("acme", "web", MOST, true);
    expect(api.follow).toHaveBeenCalledTimes(MOST + 1);
    await jobLog("acme", "web", 0, true);
    expect(api.follow).toHaveBeenCalledTimes(MOST + 2);
  });

  it("says why it can't be had", async () => {
    const said = async (response: Response | Error | string) => {
      const api = {
        follow: vi.fn<() => Promise<Response>>(() =>
          response instanceof Response ? Promise.resolve(response) : Promise.reject(response),
        ),
      };
      return String(await createJobLogs(api)("acme", "web", 1, true).catch((e: unknown) => e));
    };
    expect(await said(answer(404))).toContain("isn't available (yet, or any more)");
    expect(await said(answer(410))).toContain("isn't available");
    expect(await said(answer(403))).toContain("You can't read this job's log.");
    expect(await said(answer(500))).toContain("GitHub returned 500");
    expect(await said(answer(200, "x", "https://evil.com/log"))).toContain("from somewhere unexpected");
    expect(await said(new TypeError("Failed to fetch"))).toContain("Couldn't download the log: Failed to fetch");
    expect(await said("down")).toContain("Couldn't download the log: down");
  });

  it("turns down names that aren't", async () => {
    const jobLog = createJobLogs({ follow: vi.fn<() => Promise<Response>>() });
    await expect(jobLog("..", "web", 1, true)).rejects.toThrow("Bad request");
    await expect(jobLog("acme", "a/b", 1, true)).rejects.toThrow("Bad request");
    await expect(jobLog("acme", "web", -1, true)).rejects.toThrow("Bad request");
    await expect(jobLog("acme", "web", 1.5, true)).rejects.toThrow("Bad request");
  });
});
