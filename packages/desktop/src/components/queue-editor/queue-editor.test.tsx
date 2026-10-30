import { act, render, screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { PATH_PRESETS, QueueEditor, queueSummary } from "@/components/queue-editor/queue-editor";
import { TEMPLATES, type Queue, type QueueKind } from "@/utils/config/config";
import { i18n, setLanguage } from "@/utils/i18n/i18n";
import { renderEditing, typeRepository } from "@/utils/mock-render/mock-render";

const make = (kind: QueueKind, patch: Partial<Queue> = {}): Queue => ({ ...TEMPLATES[kind].make(), ...patch });

function setup(initial: Queue) {
  return renderEditing(initial, (queue, onChange) => <QueueEditor queue={queue} onChange={onChange} />);
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("QueueEditor", () => {
  it("renames the queue and picks its colour", async () => {
    const { user, last } = setup(make("review"));
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Mine");
    expect(last().name).toBe("Mine");

    const colors = screen.getByRole("radiogroup", { name: "Color" });
    expect(within(colors).getByRole("radio", { name: "Blue" }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(colors).getByRole("radio", { name: "Red" }));
    expect(last().tone).toBe("red");
    expect(within(colors).getByRole("radio", { name: "Red" }).getAttribute("tabindex")).toBe("0");
  });

  it("switches between open and merged pull requests, and ignores letting go of the chosen one", async () => {
    const { user, changes, last } = setup(make("review"));
    await user.click(screen.getByRole("button", { name: "Merged lately" }));
    expect(last()).toMatchObject({ kind: "merged", requestedOnly: true });
    const before = changes.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Merged lately" }));
    expect(changes.mock.calls.length).toBe(before);
  });

  it("changes where I come in, with parts a merged queue can't have turned off", async () => {
    const { user, last } = setup(make("review"));
    await choose(user, "Where I come in", "I opened them");
    expect(last().kind).toBe("authored");
  });

  it("offers a review queue's own choices", async () => {
    const { user, last } = setup(make("review"));
    await user.click(screen.getByRole("switch", { name: /Leave once I've reviewed/u }));
    expect(last().hideOnceReviewed).toBe(false);

    const teams = screen.getByRole("textbox", { name: "Teams" });
    await user.type(teams, "nope{Enter}");
    expect(screen.getByRole("alert").textContent).toContain("Use organization/team");
    await user.clear(teams);
    await user.type(teams, "acme/web{Enter}");
    expect(last().teams).toEqual(["acme/web"]);

    await choose(user, "Waiting long after", "Never");
    expect(last().staleHours).toBe(0);
    expect(screen.getByRole("combobox", { name: "Waiting long after" }).textContent).toContain("Never");
    await choose(user, "Waiting long after", "2 days");
    expect(last().staleHours).toBe(48);
    await choose(user, "Waiting long after", "8 hours");
    expect(last().staleHours).toBe(8);

    await user.click(screen.getByRole("switch", { name: /Only when I'm asked directly/u }));
    expect(last().directOnly).toBe(true);
    expect(screen.queryByRole("textbox", { name: "Teams" })).toBeNull();
  });

  it("offers an involved queue only-news", async () => {
    const { user, last } = setup(make("involved"));
    expect(screen.queryByRole("combobox", { name: "Waiting long after" })).toBeNull();
    await user.click(screen.getByRole("switch", { name: /Only with something new/u }));
    expect(last().onlyNews).toBe(true);
  });

  it("offers a merged queue its window, what to skip, and whose merges to leave out", async () => {
    const { user, last } = setup(make("merged"));
    await choose(user, "Days", "14 days");
    expect(last().mergedDays).toBe(14);
    await choose(user, "Leave out those I", "reviewed in any way");
    expect(last().skipIfI).toBe("reviewed");

    const teams = screen.getByRole("textbox", { name: "Teams" });
    await user.type(teams, "acme/api{Enter}");
    expect(last().teams).toEqual(["acme/api"]);
    await user.click(screen.getByRole("switch", { name: /Only when I was asked directly/u }));
    expect(last().directOnly).toBe(true);
    expect(screen.queryByRole("textbox", { name: "Teams" })).toBeNull();

    const mergers = screen.getByRole("textbox", { name: "Mergers to leave out" });
    await user.type(mergers, "not a name{Enter}");
    expect(screen.getByRole("alert").textContent).toContain("A GitHub username");
    await user.clear(mergers);
    await user.click(mergers);
    await user.paste("renovate[bot]");
    await user.keyboard("{Enter}");
    expect(last().skipMergedBy).toEqual(["renovate[bot]"]);
  });

  it("asks a merged queue of anyone's nothing about teams", () => {
    setup(make("merged", { requestedOnly: false }));
    expect(screen.queryByRole("switch", { name: /Only when I was asked directly/u })).toBeNull();
  });

  it("narrows by search terms and repositories", async () => {
    const { user, last } = setup(make("custom"));
    await user.type(screen.getByLabelText("GitHub search terms"), "label:x");
    expect(last().query).toBe("label:x");

    await typeRepository(user, "acme/*");
    expect(last().repos).toEqual(["acme/*"]);
  });

  it("fills the path filters from a preset, clears them, and flags a broken pattern", async () => {
    const { user, last } = setup(make("custom"));
    expect(screen.queryByRole("button", { name: "Any file" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Frontend" }));
    expect(last()).toMatchObject({ includePaths: PATH_PRESETS[0]!.include, excludePaths: PATH_PRESETS[0]!.exclude });
    expect(screen.getByRole("button", { name: "Frontend" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Any file" }));
    expect(last()).toMatchObject({ includePaths: "", excludePaths: "" });

    const include = screen.getByLabelText("Include");
    await user.click(include);
    await user.paste("(");
    expect(include.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("isn't a valid regular expression");
    await user.clear(include);

    const exclude = screen.getByLabelText("Exclude");
    await user.click(exclude);
    await user.paste("[");
    expect(last().excludePaths).toBe("[");
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("shows, hides or keeps only drafts", async () => {
    const { user, changes, last } = setup(make("review"));
    await user.click(screen.getByRole("button", { name: "Only drafts" }));
    expect(last().drafts).toBe("only");
    const before = changes.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Only drafts" }));
    expect(changes.mock.calls.length).toBe(before);
  });

  it("leaves out bots, authors, approvers and labels", async () => {
    const { user, last } = setup(make("custom"));
    await user.click(screen.getByRole("switch", { name: /opened by bots/u }));
    expect(last().hideBots).toBe(false);
    await user.type(screen.getByRole("textbox", { name: "Authors to leave out" }), "octocat{Enter}");
    expect(last().excludeAuthors).toEqual(["octocat"]);
    await user.type(screen.getByRole("textbox", { name: "Approvers to leave out" }), "hubot{Enter}");
    expect(last().skipApprovedBy).toEqual(["hubot"]);
    await user.type(screen.getByRole("textbox", { name: "Labels to require" }), "urgent{Enter}");
    expect(last().includeLabels).toEqual(["urgent"]);
    await user.type(screen.getByRole("textbox", { name: "Labels to leave out" }), "wip{Enter}");
    expect(last().excludeLabels).toEqual(["wip"]);
  });

  it("chooses what to be told about, when, and what to leave out of it", async () => {
    const { user, changes, last } = setup(make("custom"));
    await user.click(screen.getByRole("button", { name: "At review time" }));
    expect(last().notifyAt).toBe("review");
    const before = changes.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "At review time" }));
    expect(changes.mock.calls.length).toBe(before);

    const bots = screen.getByRole("switch", { name: /What bots do/u });
    expect(screen.getByText("Pull requests they open, comments and reviews they post.")).toBeTruthy();
    await user.click(bots);
    expect(last().notifyLeaveOut).toEqual(["bots"]);
    await user.click(bots);
    expect(last().notifyLeaveOut).toEqual([]);

    await user.type(screen.getByRole("textbox", { name: "Repositories to notify about" }), "acme/web{Enter}");
    expect(last().notifyRepos).toEqual(["acme/web"]);

    await user.click(screen.getByRole("switch", { name: "Enters the queue" }));
    expect(last().notify).toEqual([]);
    expect(screen.queryByRole("group", { name: "When to tell me" })).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Enters the queue" }));
    expect(last().notify).toEqual(["new"]);
  });
});

describe("QueueEditor, drawn again with nothing changed", () => {
  it.each([
    ["review", make("review")],
    ["involved", make("involved")],
    ["merged", make("merged", { notify: ["new"] })],
    ["custom", make("custom", { includePaths: "(", excludePaths: "x" })],
  ])("keeps a %s queue as it was", (_, queue) => {
    const onChange = vi.fn<(q: Queue) => void>();
    const { container, rerender } = render(<QueueEditor queue={queue} onChange={onChange} />);
    const before = container.innerHTML;
    rerender(<QueueEditor queue={queue} onChange={onChange} />);
    expect(container.innerHTML).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("QueueEditor, in another language", () => {
  afterEach(() => {
    setLanguage("en");
  });

  it("follows the language picked in Settings", () => {
    render(<QueueEditor queue={make("custom")} onChange={vi.fn<(q: Queue) => void>()} />);
    expect(screen.getByLabelText("Name")).toBeTruthy();
    act(() => {
      setLanguage("pt-BR");
    });
    expect(screen.getByLabelText("Nome")).toBeTruthy();
    expect(screen.getByText("Me notificar quando")).toBeTruthy();
  });
});

describe("queueSummary", () => {
  const t = i18n();

  it("says where a queue's pull requests come from, alone", () => {
    expect(queueSummary(make("review"), t)).toBe("Waiting on my review");
  });

  it("adds its search, repositories, files and labels", () => {
    expect(
      queueSummary(
        make("custom", {
          query: "  label:x ",
          repos: ["acme/web"],
          includePaths: PATH_PRESETS[5]!.include,
          includeLabels: ["a", "b"],
        }),
        t,
      ),
    ).toBe("Open pull requests · label:x · acme/web · Docs · a, b");
    expect(queueSummary(make("merged", { repos: ["acme/web", "acme/api"], excludePaths: "x" }), t)).toBe(
      "Merged, my review was asked · 2 repositories · Some files",
    );
  });
});
