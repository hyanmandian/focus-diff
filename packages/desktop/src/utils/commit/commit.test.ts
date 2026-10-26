import { describe, expect, it } from "vite-plus/test";

import { GitHubError } from "@/utils/bridge/bridge";
import { commitSuggestions, defaultHeadline, StaleHead, type Applied } from "@/utils/commit/commit";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Args } from "@/utils/platform/platform";
import type { Author } from "@/utils/suggestion/suggestion";

const ana = { login: "ana", name: "Ana Lima", databaseId: 11 };
const item = (path: string, start: number, lines: string[], author: Author = ana): Applied => ({
  thread: "T1",
  comment: "C1",
  path,
  start,
  end: start,
  lines,
  author,
});

type Sent = Record<string, unknown>;
const fields = (args: Args | undefined): Sent =>
  args === undefined || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array ? {} : args;

/** GitHub as Rust passes it on: files read raw, and the commit mutation answered with `commit`. */
function github(files: Record<string, string>, commit: { status: number; body: string }) {
  const sent: Sent[] = [];
  mockCommands((cmd, args) => {
    const call = fields(args);
    sent.push(call);
    if (call.path === "/graphql") return commit;
    const path = decodeURIComponent(String(call.path).replace(/^.*\/contents\/(.*)\?ref=.*$/u, "$1"));
    return cmd === "github" ? { status: 200, body: files[path] } : null;
  });
  return sent;
}

/** Files read, then the commit refused by Rust itself. */
function offline() {
  mockCommands((_, args) =>
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Rust's errors reach the page as strings
    fields(args).path === "/graphql" ? Promise.reject("offline") : { status: 200, body: "x\n" },
  );
}

const ok = { status: 200, body: JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: "c2" } } } }) };

describe("defaultHeadline", () => {
  it("names the file for one suggestion, as GitHub does", () => {
    expect(defaultHeadline([item("src/app/main.ts", 1, [])])).toBe("Update main.ts");
    expect(defaultHeadline([item("a.ts", 1, []), item("b.ts", 1, [])])).toBe("Apply suggestions from code review");
  });
});

describe("commitSuggestions", () => {
  it("applies each file's suggestions at the reviewed head and commits them, crediting the authors", async () => {
    const sent = github({ "src/a b.ts": "one\ntwo\nthree\n", "README.md": "hi\n" }, ok);
    await commitSuggestions({
      repo: "acme/web",
      branch: "fix",
      head: "h1",
      items: [item("src/a b.ts", 1, ["ONE"]), item("src/a b.ts", 3, ["THREE"]), item("README.md", 1, ["hello"])],
      headline: " Apply suggestions ",
      body: " Thanks ",
      me: "me",
    });
    expect(sent.slice(0, 2).map((s) => [s.method, s.path, s.accept])).toEqual([
      ["GET", "/repos/acme/web/contents/src/a%20b.ts?ref=h1", "application/vnd.github.raw+json"],
      ["GET", "/repos/acme/web/contents/README.md?ref=h1", "application/vnd.github.raw+json"],
    ]);
    expect(JSON.parse(String(sent[2]!.body))).toMatchObject({
      variables: {
        input: {
          branch: { repositoryNameWithOwner: "acme/web", branchName: "fix" },
          expectedHeadOid: "h1",
          message: {
            headline: "Apply suggestions",
            body: "Thanks\n\nCo-authored-by: Ana Lima <11+ana@users.noreply.github.com>",
          },
          fileChanges: {
            additions: [
              { path: "src/a b.ts", contents: btoa("ONE\ntwo\nTHREE\n") },
              { path: "README.md", contents: btoa("hello\n") },
            ],
          },
        },
      },
    });
  });

  it("sends only a headline when there's nothing else to say", async () => {
    const sent = github({ "a.ts": "x\n" }, ok);
    const mine = item("a.ts", 1, ["y"], { login: "me", name: null, databaseId: 1 });
    await commitSuggestions({
      repo: "o/r",
      branch: "b",
      head: "h",
      items: [mine],
      headline: "Fix",
      body: " ",
      me: "me",
    });
    expect(JSON.parse(String(sent[1]!.body))).toMatchObject({ variables: { input: { message: { headline: "Fix" } } } });
    expect(String(sent[1]!.body)).not.toContain('"body"');
  });

  it("says the branch moved when GitHub refuses the expected head", async () => {
    const moved = {
      status: 200,
      body: JSON.stringify({ errors: [{ message: "Expected branch to point to h1 but it did not" }] }),
    };
    github({ "a.ts": "x\n" }, moved);
    const run = commitSuggestions({
      repo: "o/r",
      branch: "b",
      head: "h1",
      items: [item("a.ts", 1, ["y"])],
      headline: "Fix",
      body: "",
      me: null,
    });
    await expect(run).rejects.toBeInstanceOf(StaleHead);
  });

  it("passes on any other failure as it is", async () => {
    github({ "a.ts": "x\n" }, { status: 403, body: JSON.stringify({ message: "Forbidden" }) });
    const run = commitSuggestions({
      repo: "o/r",
      branch: "b",
      head: "h1",
      items: [item("a.ts", 1, ["y"])],
      headline: "Fix",
      body: "",
      me: null,
    });
    await expect(run).rejects.toThrow(new GitHubError(403, "Forbidden"));
    await expect(run).rejects.not.toBeInstanceOf(StaleHead);
  });

  it("passes on a failure that isn't GitHub's", async () => {
    offline();
    const run = commitSuggestions({
      repo: "o/r",
      branch: "b",
      head: "h1",
      items: [item("a.ts", 1, ["y"])],
      headline: "Fix",
      body: "",
      me: null,
    });
    await expect(run).rejects.toBe("offline");
  });
});
