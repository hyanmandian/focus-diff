import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { LabelChip, Sidebar } from "@/components/sidebar/sidebar";
import type { Pull } from "@/hooks/use-pull/use-pull";
import type { Details } from "@/utils/details/details";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import type { LinkedIssue, Manage, Reviewer } from "@/utils/manage/manage";
import { fakeDetails, fakeManage, fakePull } from "@/utils/mock-pull/mock-pull";
import type { Args } from "@/utils/platform/platform";

const arg = (args: Args | undefined, key: string): unknown => new Map(Object.entries(args ?? {})).get(key);

const person = (login: string, name: string | null = null) => ({
  __typename: "User",
  login,
  name,
  avatarUrl: `https://a/${login}`,
});
const ana = person("ana", "Ana Lima");
const bo = person("bo");
const cy = person("cy", "Cy Ray");

type Lists = {
  people?: unknown[];
  teams?: unknown[] | null;
  labels?: unknown[];
  milestones?: unknown[];
  status?: number;
};

function github({ people = [ana, bo, cy], teams = [], labels = [], milestones = [], status = 200 }: Lists = {}) {
  const calls: string[] = [];
  mockCommands((cmd, args) => {
    if (cmd === "open_url") {
      calls.push(`open ${String(arg(args, "url"))}`);
      return null;
    }
    const method = String(arg(args, "method"));
    const path = String(arg(args, "path"));
    const body = String(arg(args, "body"));
    const ok = (data: unknown) => ({ status: 200, body: JSON.stringify({ data }) });
    if (path === "/graphql") {
      if (body.includes("assignableUsers")) return ok({ repository: { assignableUsers: { nodes: people } } });
      if (body.includes("organization")) return ok({ organization: teams && { teams: { nodes: teams } } });
      if (body.includes("labels(")) {
        return ok({ repository: { labels: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: labels } } });
      }
      return ok({ repository: { milestones: { nodes: milestones } } });
    }
    calls.push(`${method} ${path} ${body}`);
    return { status, body: status < 400 ? "{}" : JSON.stringify({ message: "Refused" }) };
  });
  return calls;
}

const reviewer = (key: string, extra: Partial<Reviewer> = {}): Reviewer => ({
  key,
  actor: person(key, key.toUpperCase()),
  team: null,
  state: null,
  requested: true,
  codeOwner: false,
  ...extra,
});

type Setup = { details?: Partial<Details>; manage?: Partial<Manage> | null; me?: string | null; pull?: Partial<Pull> };

function sidebar({ details: d = {}, manage = {}, me = "me", pull: p = {} }: Setup = {}) {
  const details = fakeDetails(d);
  const pull = fakePull({ manage: manage === null ? null : fakeManage(manage), ...p });
  const onError = vi.fn<(message: string) => void>();
  render(<Sidebar details={details} pull={pull} me={me} onError={onError} />);
  return { pull, onError };
}

const patched = (pull: Pull, manage: Manage) => vi.mocked(pull.patch).mock.lastCall![0](manage);
const section = (name: string) => screen.getByRole("region", { name });
const items = (name: string) =>
  within(section(name))
    .queryAllByRole("listitem")
    .map((li) => li.textContent);
const open = (name: string) => userEvent.click(screen.getByRole("button", { name }));
const option = (name: string | RegExp) => screen.findByRole("option", { name });

describe("LabelChip", () => {
  it("shows the label with its colour", () => {
    const { container } = render(<LabelChip label={{ name: "bug", color: "d73a4a" }} className="x" />);
    expect(screen.getByText("bug")).toBeTruthy();
    expect(container.querySelector<HTMLElement>("[aria-hidden]")?.style.backgroundColor).toBeTruthy();
  });
});

describe("Reviewers", () => {
  it("lists who's asked and how they answered", () => {
    sidebar({
      manage: {
        reviewers: [
          reviewer("ana", { state: "APPROVED", requested: false, codeOwner: true }),
          reviewer("bo", { state: "CHANGES_REQUESTED", requested: true }),
          reviewer("cy"),
          reviewer("team:core", { actor: null, team: { slug: "core", name: "Core", combinedSlug: "acme/core" } }),
          reviewer("dee", { state: "COMMENTED", requested: false }),
          reviewer("eve", { state: null, requested: false }),
        ],
        rule: { approvals: 2, codeOwners: true, checks: [], conversations: false, linear: false },
      },
      me: "dee",
    });
    expect(items("Reviewers")).toEqual([
      "ANANAApproved",
      "BOBOChanges requested",
      "CYCYNot reviewed yet",
      "CoreNot reviewed yet",
      "DEDEECommented",
      "EVEVE",
    ]);
    expect(screen.getByLabelText("Code owner")).toBeTruthy();
    expect(screen.getByLabelText("Asked again")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask ANA again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask DEE again" })).toBeNull();
    expect(screen.getByText("A code owner's review is required.")).toBeTruthy();
    expect(screen.getByText("2 approvals are required.")).toBeTruthy();
  });

  it("explains a code owner in a tooltip", async () => {
    sidebar({ manage: { reviewers: [reviewer("ana", { codeOwner: true })] } });
    await userEvent.hover(screen.getByLabelText("Code owner"));
    expect(await screen.findByText("Asked because they own code this changes")).toBeTruthy();
  });

  it("falls back to the details' reviewers until the rest loads, and can't change them", () => {
    sidebar({
      manage: null,
      details: {
        reviewers: [
          { actor: ana, state: "APPROVED" },
          { actor: bo, state: "PENDING" },
          { actor: { login: "core" }, state: "PENDING", team: "Core" },
          { actor: null, state: "PENDING", team: "Ghosts" },
          { actor: null, state: "COMMENTED" },
        ],
      },
    });
    expect(items("Reviewers")).toEqual([
      "ANAnaApproved",
      "BOboNot reviewed yet",
      "CoreNot reviewed yet",
      "GhostsNot reviewed yet",
      "?SomeoneCommented",
    ]);
    expect(screen.queryByRole("button", { name: "Edit reviewers" })).toBeNull();
  });

  it("says nobody's asked", () => {
    sidebar({ manage: { reviewers: [] } });
    expect(within(section("Reviewers")).getByText("Nobody asked yet.")).toBeTruthy();
  });

  it("asks someone to review, from the people and the organization's teams", async () => {
    const calls = github({ teams: [{ slug: "core", name: "Core", combinedSlug: "acme/core" }] });
    const { pull } = sidebar({ manage: { reviewers: [reviewer("zed")] }, details: { author: cy } });
    await open("Edit reviewers");
    await option(/Ana Lima/u);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "ZEZED",
      "Coreacme/core",
      "ANAna Limaana",
      "BObo",
    ]);
    await userEvent.click(await option(/Ana Lima/u));
    await waitFor(() => {
      expect(calls).toEqual([
        `POST /repos/acme/shop/pulls/42/requested_reviewers {"reviewers":["ana"],"team_reviewers":[]}`,
      ]);
    });
    expect(patched(pull, fakeManage()).reviewers).toEqual([
      { key: "ana", actor: ana, team: null, state: null, requested: true, codeOwner: false },
    ]);
    expect(pull.reloadManage).toHaveBeenCalled();
    await userEvent.click(await option(/^Core/u));
    expect(patched(pull, fakeManage()).reviewers[0]?.team).toEqual({
      slug: "core",
      name: "Core",
      combinedSlug: "acme/core",
    });
  });

  it("takes a request back, keeping a review already given", async () => {
    const calls = github();
    const asked = [reviewer("ana"), reviewer("bo", { state: "COMMENTED" })];
    const { pull } = sidebar({ manage: { reviewers: asked } });
    await open("Edit reviewers");
    await userEvent.click(await option(/Ana Lima/u));
    expect(patched(pull, fakeManage({ reviewers: asked })).reviewers).toEqual([asked[1]]);
    await userEvent.click(await option(/bo$/u));
    expect(patched(pull, fakeManage({ reviewers: asked })).reviewers).toEqual([
      asked[0],
      { ...asked[1], requested: false },
    ]);
    await waitFor(() => {
      expect(calls[0]).toBe(
        `DELETE /repos/acme/shop/pulls/42/requested_reviewers {"reviewers":["ana"],"team_reviewers":[]}`,
      );
    });
  });

  it("asks someone again, and a team it doesn't know yet", async () => {
    github({ teams: null });
    const given = [reviewer("ana", { state: "APPROVED", requested: false }), reviewer("bo")];
    const { pull } = sidebar({ manage: { reviewers: given, orgOwned: true } });
    await userEvent.click(screen.getByRole("button", { name: "Ask ANA again" }));
    expect(patched(pull, fakeManage({ reviewers: given })).reviewers).toEqual([
      { ...given[0], requested: true },
      given[1],
    ]);
    await open("Edit reviewers");
    await userEvent.type(screen.getByRole("combobox"), "x");
    const asked = [reviewer("team:ops", { actor: null, team: { slug: "ops", name: "Ops", combinedSlug: "" } })];
    const { pull: other } = sidebar({ manage: { reviewers: asked, orgOwned: false } });
    await userEvent.click(screen.getAllByRole("button", { name: "Edit reviewers" })[1]!);
    await userEvent.click(await option(/^Ops/u));
    expect(patched(other, fakeManage()).reviewers).toEqual([]);
  });

  it("asks a team by its slug when it isn't in the list", async () => {
    github();
    const { pull } = sidebar({
      manage: { reviewers: [reviewer("team:ops", { actor: null, team: null, requested: true })] },
    });
    await open("Edit reviewers");
    await userEvent.click(await option(/Someone/u));
    expect(patched(pull, fakeManage()).reviewers).toEqual([]);
    expect(patched(pull, fakeManage({ reviewers: [] })).reviewers).toEqual([]);
  });

  it("says what Rust said when the call itself failed", async () => {
    mockCommands((_, args) => {
      if (String(arg(args, "path")) === "/graphql") {
        return { status: 200, body: JSON.stringify({ data: { repository: { assignableUsers: { nodes: [bo] } } } }) };
      }
      // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Rust's errors reach the page as strings.
      throw "Offline";
    });
    const { onError } = sidebar();
    await open("Edit reviewers");
    await userEvent.click(await option(/bo$/u));
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Offline");
    });
    await userEvent.keyboard("{Escape}");
  });

  it("puts it back and says why when GitHub refuses", async () => {
    github({ status: 422 });
    const { onError, pull } = sidebar();
    await open("Edit reviewers");
    await userEvent.click(await option(/bo$/u));
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Refused");
    });
    expect(pull.reloadManage).toHaveBeenCalled();
  });

  it("lets only who may change reviewers, while it's open", () => {
    sidebar({ manage: { viewerPermission: "READ" } });
    sidebar({ manage: { viewerPermission: "READ" }, details: { viewerDidAuthor: true } });
    sidebar({ details: { state: "MERGED" } });
    expect(screen.getAllByRole("button", { name: "Edit reviewers" })).toHaveLength(1);
  });
});

describe("Assignees", () => {
  it("assigns and unassigns from the people", async () => {
    const calls = github();
    const { pull } = sidebar({ manage: { assignees: [person("zed", "Zed"), cy, person("quiet")] } });
    expect(items("Assignees")).toEqual(["ZEZed", "CYCy", "QUquiet"]);
    await open("Edit assignees");
    await option(/Ana Lima/u);
    expect(screen.getAllByRole("option").map((o) => o.textContent?.replace(/^[A-Z]{2}/u, ""))).toEqual([
      "quiet",
      "Zed",
      "Cy Raycy",
      "Ana Limaana",
      "bo",
    ]);
    await userEvent.click(await option(/Ana Lima/u));
    expect(patched(pull, fakeManage()).assignees).toEqual([ana]);
    await userEvent.click(await option(/Zed/u));
    expect(patched(pull, fakeManage({ assignees: [person("zed")] })).assignees).toEqual([]);
    await userEvent.type(screen.getByRole("combobox"), "c");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(calls).toEqual([
        `POST /repos/acme/shop/issues/42/assignees {"assignees":["ana"]}`,
        `DELETE /repos/acme/shop/issues/42/assignees {"assignees":["zed"]}`,
      ]);
    });
  });

  it("offers to assign yourself", async () => {
    github({ people: [] });
    const { pull } = sidebar({ me: "me" });
    expect(within(section("Assignees")).getByText("No one.", { exact: false })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Assign yourself" }));
    expect(patched(pull, fakeManage()).assignees).toEqual([]);
  });

  it("doesn't offer it when signed out, on a closed one, or to who can't", () => {
    sidebar({ me: null });
    sidebar({ details: { state: "CLOSED" } });
    sidebar({ manage: { viewerPermission: "READ" } });
    sidebar({ manage: null });
    expect(screen.queryByRole("button", { name: "Assign yourself" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Edit assignees" })).toHaveLength(2);
  });
});

describe("Labels", () => {
  const bug = { id: "L1", name: "bug", color: "d73a4a", description: "Something's wrong" };
  const docs = { id: "L2", name: "docs", color: "0075ca", description: null };

  it("applies and removes labels", async () => {
    const calls = github({ labels: [bug, docs] });
    const { pull } = sidebar({ manage: { labels: [bug] } });
    expect(within(section("Labels")).getByRole("listitem").title).toBe("Something's wrong");
    await open("Edit labels");
    await userEvent.click(await option(/^docs/u));
    expect(patched(pull, fakeManage()).labels).toEqual([docs]);
    await userEvent.click(await option(/^bug/u));
    expect(patched(pull, fakeManage({ labels: [bug] })).labels).toEqual([]);
    await waitFor(() => {
      expect(calls).toEqual([
        `POST /repos/acme/shop/issues/42/labels {"labels":["docs"]}`,
        "DELETE /repos/acme/shop/issues/42/labels/bug null",
      ]);
    });
  });

  it("says when there are none", async () => {
    github({ labels: [] });
    sidebar({ manage: { labels: [docs] } });
    expect(within(section("Labels")).getByRole("listitem").title).toBe("");
    sidebar({ manage: { labels: [] } });
    expect(screen.getByText("None yet.")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Edit labels" })[0]!);
    expect(await screen.findByText("No labels found.")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
  });
});

describe("Milestone", () => {
  const v1 = { id: "M1", number: 1, title: "v1", dueOn: "2026-11-01T00:00:00Z" };
  const v2 = { id: "M2", number: 2, title: "v2", dueOn: null };

  it("sets the milestone, and takes it off", async () => {
    const calls = github({ milestones: [v1, v2] });
    const { pull } = sidebar({ manage: { milestone: v1 } });
    expect(within(section("Milestone")).getByText("v1")).toBeTruthy();
    await open("Edit milestone");
    expect((await option(/^v1/u)).textContent).toMatch(/^v1Due /u);
    await userEvent.click(await option(/^v2/u));
    expect(patched(pull, fakeManage()).milestone).toEqual(v2);
    await open("Edit milestone");
    await userEvent.click(await option(/^v1/u));
    expect(patched(pull, fakeManage()).milestone).toBeNull();
    await waitFor(() => {
      expect(calls).toEqual([
        `PATCH /repos/acme/shop/issues/42 {"milestone":2}`,
        `PATCH /repos/acme/shop/issues/42 {"milestone":null}`,
      ]);
    });
  });

  it("keeps a closed milestone in the list, and says when there's none", async () => {
    github({ milestones: [v2] });
    sidebar({ manage: { milestone: { id: "M9", number: 9, title: "Old", dueOn: null } } });
    await open("Edit milestone");
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Old", "v2"]);
    await userEvent.keyboard("{Escape}");
    sidebar({ manage: { milestone: null }, pull: {} });
    expect(screen.getByText("No milestone.")).toBeTruthy();
  });

  it("can't be changed by who can't triage", () => {
    sidebar({ manage: { viewerPermission: "READ" } });
    expect(screen.queryByRole("button", { name: "Edit milestone" })).toBeNull();
  });
});

describe("Development and deployments", () => {
  it("lists the issues it closes, and opens them", async () => {
    const calls = github();
    const issue = (n: number, extra: Partial<LinkedIssue> = {}): LinkedIssue => ({
      id: `I${n}`,
      number: n,
      title: `Issue ${n}`,
      url: `https://github.com/acme/shop/issues/${n}`,
      repo: "acme/shop",
      state: "OPEN",
      stateReason: null,
      ...extra,
    });
    sidebar({
      manage: {
        issues: [
          issue(1),
          issue(2, { state: "CLOSED", stateReason: "COMPLETED" }),
          issue(3, { state: "CLOSED", stateReason: "NOT_PLANNED", repo: "acme/other" }),
        ],
      },
    });
    expect(items("Development")).toEqual(["Issue 1#1", "Issue 2#2", "Issue 3acme/other#3"]);
    expect(within(section("Development")).getAllByLabelText("Closed issue")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: /Issue 1/u }));
    expect(calls).toEqual(["open https://github.com/acme/shop/issues/1"]);
  });

  it("leaves the pull request's own repository off its issues when it comes from a fork", () => {
    sidebar({
      manage: {
        headOwner: "ana",
        issues: [
          {
            id: "I1",
            number: 1,
            title: "Issue 1",
            url: "https://github.com/acme/shop/issues/1",
            repo: "acme/shop",
            state: "OPEN",
            stateReason: null,
          },
        ],
      },
    });
    expect(items("Development")).toEqual(["Issue 1#1"]);
  });

  it("shows the latest deployment per environment, with a link where there's one", async () => {
    const calls = github();
    const deployment = (
      id: string,
      environment: string,
      state: string,
      url: string | null,
      logUrl: string | null = null,
    ) => ({
      id,
      environment,
      state,
      url,
      logUrl,
      at: "2026-10-20T10:00:00Z",
    });
    sidebar({
      manage: {
        deployments: [
          deployment("D1", "staging", "INACTIVE", null),
          deployment("D2", "staging", "SUCCESS", "https://staging.acme"),
          deployment("D3", "preview", "WEIRD", null, "https://logs.acme"),
          deployment("D4", "prod", "FAILURE", "http://insecure"),
        ],
      },
    });
    expect(
      within(section("Deployments"))
        .getAllByRole("listitem")
        .map((li) => li.textContent?.split(/\d/u)[0]),
    ).toEqual(["staging", "preview", "prod"]);
    expect(
      within(section("Deployments"))
        .getAllByRole("listitem")
        .map((li) => li.querySelector("svg")?.getAttribute("aria-label")),
    ).toEqual(["Deployed", "Inactive", "Failed"]);
    expect(screen.queryByRole("button", { name: "Open prod" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open staging" }));
    await userEvent.click(screen.getByRole("button", { name: "Open preview" }));
    expect(calls).toEqual(["open https://staging.acme", "open https://logs.acme"]);
  });

  it("leaves them out when there are none", () => {
    sidebar({ manage: null });
    expect(screen.queryByRole("region", { name: "Development" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Deployments" })).toBeNull();
  });
});
