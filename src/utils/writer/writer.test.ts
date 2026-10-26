import type { InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vite-plus/test";

type Request = { method: string; path: string; body: string; accept: unknown };

/** One of the arguments a command was sent with. */
function sent(args: InvokeArgs | undefined, key: string): unknown {
  if (args === undefined || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array)
    return undefined;
  return args[key];
}

/** Answers GitHub with what `answer` gives (thrown: the call fails), and keeps each request. */
function github(answer: (request: Request) => unknown) {
  const asked: Request[] = [];
  mockIPC((_cmd, args) => {
    const request = {
      method: String(sent(args, "method")),
      path: String(sent(args, "path")),
      body: String(sent(args, "body")),
      accept: sent(args, "accept"),
    };
    asked.push(request);
    const reply = answer(request);
    return { status: 200, body: typeof reply === "string" ? reply : JSON.stringify(reply) };
  });
  return asked;
}

const DAY = 24 * 3_600_000;
const person = (login: string, name: string | null = null) => ({ login, name, avatarUrl: "" });

/** The module afresh, its memory empty, as a new window has it. */
function load() {
  vi.resetModules();
  return import("@/utils/writer/writer");
}

describe("emoji", () => {
  const pictures = {
    "+1": "https://github.githubassets.com/images/icons/emoji/unicode/1f44d.png?v8",
    octocat: "https://github.githubassets.com/images/icons/emoji/octocat.png?v8",
  };

  it("asks GitHub once and keeps them a day", async () => {
    const writer = await load();
    const asked = github(() => pictures);
    expect(await writer.emoji()).toEqual([{ name: "+1", char: "👍" }]);
    expect(await writer.emoji()).toHaveLength(1);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ method: "GET", path: "/emojis" });

    const again = await load();
    expect(await again.emoji()).toEqual([{ name: "+1", char: "👍" }]);
    expect(asked).toHaveLength(1);
  });

  it("asks again after a day", async () => {
    const writer = await load();
    vi.spyOn(Date, "now").mockReturnValue(0);
    const asked = github(() => pictures);
    await writer.emoji();
    const later = await load();
    vi.spyOn(Date, "now").mockReturnValue(DAY + 1);
    await later.emoji();
    expect(asked).toHaveLength(2);
  });

  it("asks again after a failure", async () => {
    const writer = await load();
    github(() => {
      throw new Error("offline");
    });
    await expect(writer.emoji()).rejects.toThrow("offline");
    const asked = github(() => pictures);
    expect(await writer.emoji()).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  it("asks GitHub when what's kept can't be read", async () => {
    const writer = await load();
    localStorage.setItem("emoji", "{");
    const asked = github(() => pictures);
    await writer.emoji();
    expect(asked).toHaveLength(1);
  });

  it("still answers when nothing can be kept", async () => {
    const writer = await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    github(() => pictures);
    expect(await writer.emoji()).toHaveLength(1);
  });
});

describe("previews", () => {
  it("asks GitHub to render the Markdown in the repository, once per text", async () => {
    const writer = await load();
    const asked = github(() => "<p>Hi <a>#12</a></p>");
    expect(await writer.preview("Hi #12", "acme/app")).toBe("<p>Hi <a>#12</a></p>");
    await writer.preview("Hi #12", "acme/app");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ method: "POST", path: "/markdown", accept: "text/html" });
    expect(JSON.parse(asked[0]!.body)).toEqual({ text: "Hi #12", mode: "gfm", context: "acme/app" });
  });

  it("asks again after a failure", async () => {
    const writer = await load();
    github(() => {
      throw new Error("offline");
    });
    await expect(writer.preview("Hi", "acme/app")).rejects.toThrow("offline");
    const asked = github(() => "<p>Hi</p>");
    expect(await writer.preview("Hi", "acme/app")).toBe("<p>Hi</p>");
    expect(asked).toHaveLength(1);
  });

  it("forgets the oldest past a hundred", async () => {
    const writer = await load();
    const asked = github((request) => request.body);
    await Promise.all(Array.from({ length: 101 }, (_, i) => writer.preview(`text ${i}`, "acme/app")));
    await writer.preview("text 100", "acme/app");
    expect(asked).toHaveLength(101);
    await writer.preview("text 0", "acme/app");
    expect(asked).toHaveLength(102);
  });
});

const hundred = [person("ana", "Ana Souza"), person("bruno"), ...Array.from({ length: 98 }, (_, i) => person(`u${i}`))];

/** A hundred people, or one more for a search beyond them. */
const searchOrHundred = (request: Request) => ({
  data: {
    repository: { mentionableUsers: { nodes: request.body.includes("query: $q") ? [person("souza-c")] : hundred } },
  },
});

describe("mentions", () => {
  it("lists the repository's people, kept a day", async () => {
    const writer = await load();
    const asked = github(() => ({ data: { repository: { mentionableUsers: { nodes: [person("ana")] } } } }));
    expect(await writer.mentionable("acme/app", "")).toEqual([person("ana")]);
    expect(await writer.mentionable("acme/app", "")).toEqual([person("ana")]);
    expect(asked).toHaveLength(1);
    expect(JSON.parse(asked[0]!.body)).toMatchObject({ variables: { owner: "acme", name: "app" } });
  });

  it("finds them by login or name among those kept", async () => {
    const writer = await load();
    github(() => ({ data: { repository: { mentionableUsers: { nodes: hundred } } } }));
    expect(await writer.mentionable("acme/app", "u1")).toHaveLength(11);
    expect(await writer.mentionable("acme/app", "")).toHaveLength(100);
  });

  it("only searches what's kept when the repository has fewer than a hundred", async () => {
    const writer = await load();
    const asked = github(() => ({ data: { repository: { mentionableUsers: { nodes: [person("ana", "Ana")] } } } }));
    expect(await writer.mentionable("acme/app", "SOUZ")).toEqual([]);
    expect(await writer.mentionable("acme/app", "an")).toEqual([person("ana", "Ana")]);
    expect(asked).toHaveLength(1);
  });

  it("asks GitHub about the rest when the hundred kept don't have enough, once per search", async () => {
    const writer = await load();
    const asked = github(searchOrHundred);
    expect(await writer.mentionable("acme/app", "Souza")).toEqual([person("ana", "Ana Souza"), person("souza-c")]);
    await writer.mentionable("acme/app", "souza");
    expect(asked).toHaveLength(2);
    expect(JSON.parse(asked[1]!.body)).toMatchObject({ variables: { q: "Souza" } });
  });
});

describe("references", () => {
  const nodes = [
    { __typename: "PullRequest", number: 12, title: "Faster diffs", state: "OPEN" },
    { __typename: "Issue", number: 9, title: "Slow diffs" },
    { __typename: "Discussion" },
  ];

  it("lists issues and pull requests, skipping what can't be pointed to", async () => {
    const writer = await load();
    const asked = github(() => ({ data: { search: { nodes } } }));
    expect(await writer.referable("acme/app", "")).toEqual([
      { number: 12, title: "Faster diffs", kind: "pull", state: "OPEN" },
      { number: 9, title: "Slow diffs", kind: "issue", state: "" },
    ]);
    await writer.referable("acme/app", "");
    expect(asked).toHaveLength(1);
    expect(JSON.parse(asked[0]!.body)).toMatchObject({ variables: { q: "repo:acme/app sort:updated-desc" } });
  });

  it("searches by number, or by words in the title", async () => {
    const writer = await load();
    const asked = github(() => ({ data: { search: { nodes: [] } } }));
    await writer.referable("acme/app", "12");
    await writer.referable("acme/app", "slow diffs");
    expect(asked.map((r): unknown => JSON.parse(r.body))).toMatchObject([
      { variables: { q: "repo:acme/app 12 sort:updated-desc" } },
      { variables: { q: "repo:acme/app slow diffs in:title sort:updated-desc" } },
    ]);
  });

  it("asks again after a failure", async () => {
    const writer = await load();
    github(() => {
      throw new Error("offline");
    });
    await expect(writer.referable("acme/app", "")).rejects.toThrow("offline");
    const asked = github(() => ({ data: { search: { nodes } } }));
    expect(await writer.referable("acme/app", "")).toHaveLength(2);
    expect(asked).toHaveLength(1);
  });
});

describe("saved replies", () => {
  const replies = [{ id: "R1", title: "Thanks", body: "Thanks!" }];

  it("lists them, kept a day", async () => {
    const writer = await load();
    const asked = github(() => ({ data: { viewer: { savedReplies: { nodes: replies } } } }));
    expect(await writer.savedReplies()).toEqual(replies);
    expect(await writer.savedReplies()).toEqual(replies);
    expect(asked).toHaveLength(1);
  });

  it("has none when the token can't read them", async () => {
    const writer = await load();
    const asked = github(() => ({ data: { viewer: { savedReplies: null } } }));
    expect(await writer.savedReplies()).toBeNull();
    await writer.savedReplies();
    expect(asked).toHaveLength(2);
  });

  it("has none when GitHub fails", async () => {
    const writer = await load();
    github(() => {
      throw new Error("offline");
    });
    expect(await writer.savedReplies()).toBeNull();
  });
});
