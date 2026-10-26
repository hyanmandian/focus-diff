import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { isMarkdown, Rendered } from "@/components/rendered/rendered";
import type { Source } from "@/utils/contents/contents";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Args } from "@/utils/platform/platform";
import type { ReviewFile } from "@/utils/review/review";

type Reply = { status: number; body: string };

/** A command's named argument, as the page sent it. */
const arg = (args: Args | undefined, key: string): unknown => new Map(Object.entries(args ?? {})).get(key);

/** Answers GitHub's contents API for each file by its name, in turn (the last answer stays), and
 *  records the calls and the links opened. */
function github(replies: Record<string, Reply[]>) {
  const calls: Array<{ method: unknown; path: string; accept: unknown }> = [];
  const opened: unknown[] = [];
  mockCommands((cmd, args) => {
    if (cmd === "open_url") opened.push(arg(args, "url"));
    if (cmd !== "github") return null;
    const path = String(arg(args, "path"));
    calls.push({ method: arg(args, "method"), path, accept: arg(args, "accept") });
    const queue = replies[path.split("?")[0]!.split("/").pop()!]!;
    return queue.length > 1 ? queue.shift() : queue[0];
  });
  return { calls, opened };
}

const ok = (body: string): Reply[] => [{ status: 200, body }];

/** GitHub's answer held back until `answer` is called. */
function heldBack() {
  const pending: Array<(reply: Reply) => void> = [];
  mockCommands(
    () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  );
  return {
    answer: (body: string) => {
      for (const resolve of pending) resolve({ status: 200, body });
    },
  };
}

// Rust's errors reach the page as plain strings.
// oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the case under test.
const noBase = () => Promise.reject("no base");

const file = (path: string, extra: Partial<ReviewFile> = {}): ReviewFile => ({
  path,
  previousPath: null,
  status: "modified",
  additions: 1,
  deletions: 0,
  patch: "",
  ...extra,
});

const source = (base: () => Promise<string> = () => Promise.resolve("base1")): Source => ({
  repo: "acme/app",
  head: "head1",
  base,
});

describe("isMarkdown", () => {
  it("knows Markdown files by their extension", () => {
    expect(isMarkdown("README.md")).toBe(true);
    expect(isMarkdown("docs/Guide.MDX")).toBe(true);
    expect(isMarkdown("notes.markdown")).toBe(true);
    expect(isMarkdown("src/app.ts")).toBe(false);
  });
});

describe("Rendered", () => {
  it("shows GitHub's rendering of the file at the head commit", async () => {
    const { calls } = github({ "read%20me.md": ok("<h1>Hello</h1><script>x()</script>") });
    render(<Rendered file={file("docs/read me.md")} source={source()} />);
    expect(screen.getByRole("status").textContent).toContain("Loading…");
    expect(await screen.findByRole("heading", { name: "Hello" })).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/repos/acme/app/contents/docs/read%20me.md?ref=head1",
        accept: "application/vnd.github.html+json",
      },
    ]);
  });

  it("shows a deleted file as it was at the base, under its old name", async () => {
    const { calls } = github({ "old.md": ok("<p>Gone now</p>") });
    render(<Rendered file={file("new.md", { status: "removed", previousPath: "old.md" })} source={source()} />);
    expect(await screen.findByText("Gone now")).toBeTruthy();
    expect(calls[0]?.path).toBe("/repos/acme/app/contents/old.md?ref=base1");
  });

  it("uses a deleted file's own path when it wasn't renamed", async () => {
    const { calls } = github({ "removed.md": ok("<p>Removed</p>") });
    render(<Rendered file={file("removed.md", { status: "removed" })} source={source()} />);
    expect(await screen.findByText("Removed")).toBeTruthy();
    expect(calls[0]?.path).toBe("/repos/acme/app/contents/removed.md?ref=base1");
  });

  it("asks GitHub once per file and commit", async () => {
    const { calls } = github({ "cached.md": ok("<p>Cached</p>") });
    const first = render(<Rendered file={file("cached.md")} source={source()} />);
    await screen.findByText("Cached");
    first.unmount();
    render(<Rendered file={file("cached.md")} source={source()} />);
    await screen.findByText("Cached");
    expect(calls).toHaveLength(1);
  });

  it("says why it couldn't load, and asks again next time", async () => {
    const { calls } = github({
      "flaky.md": [
        { status: 404, body: "" },
        { status: 200, body: "<p>Back</p>" },
      ],
    });
    const first = render(<Rendered file={file("flaky.md")} source={source()} />);
    expect(await screen.findByText("Couldn't load it: GitHub returned 404")).toBeTruthy();
    first.unmount();
    render(<Rendered file={file("flaky.md")} source={source()} />);
    expect(await screen.findByText("Back")).toBeTruthy();
    expect(calls).toHaveLength(2);
  });

  it("says why when the failure isn't an Error", async () => {
    github({});
    render(<Rendered file={file("lost.md", { status: "removed" })} source={source(noBase)} />);
    expect(await screen.findByText("Couldn't load it: no base")).toBeTruthy();
  });

  it("loads again when it's shown another file", async () => {
    github({ "one.md": ok("<p>First</p>"), "two.md": ok("<p>Second</p>") });
    const s = source();
    const { rerender } = render(<Rendered file={file("one.md")} source={s} />);
    await screen.findByText("First");
    rerender(<Rendered file={file("two.md")} source={s} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(await screen.findByText("Second")).toBeTruthy();
  });

  it("drops an answer that comes after it's gone", async () => {
    const { answer } = heldBack();
    const late = render(<Rendered file={file("late.md")} source={source()} />);
    const failing = render(
      <Rendered
        file={file("late-fail.md", { status: "removed" })}
        source={source(() => Promise.reject(new Error("x")))}
      />,
    );
    late.unmount();
    failing.unmount();
    answer("<p>Too late</p>");
    await Promise.resolve();
    expect(screen.queryByText("Too late")).toBeNull();
  });

  it("opens links in the browser", async () => {
    const { opened } = github({ "links.md": ok('<p><a href="https://github.com/acme">Acme</a></p>') });
    render(<Rendered file={file("links.md")} source={source()} />);
    await userEvent.click(await screen.findByText("Acme"));
    expect(opened).toEqual(["https://github.com/acme"]);
  });
});
