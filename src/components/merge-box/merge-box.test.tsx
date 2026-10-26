import type { InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { MergeBox } from "@/components/merge-box/merge-box";
import type { Pull } from "@/hooks/use-pull/use-pull";
import type { Details } from "@/utils/details/details";
import type { Manage } from "@/utils/manage/manage";
import type { MergeView } from "@/utils/merging/merging";
import { fakeCommit, fakeDetails, fakeManage, fakePull, fakeView } from "@/utils/mock-pull/mock-pull";
import { renderTwice } from "@/utils/mock-render/mock-render";

type Setup = { details?: Partial<Details>; view?: Partial<MergeView>; manage?: Partial<Manage>; pull?: Partial<Pull> };

function box({ details: d = {}, view = {}, manage = {}, pull: p = {} }: Setup = {}) {
  const details = fakeDetails(d);
  const pull = fakePull({ view: fakeView(view), manage: fakeManage(manage), ...p });
  const result = renderTwice(() => <MergeBox details={details} pull={pull} />);
  return { pull, details, ...result };
}

const status = () => screen.getByRole("region").querySelector("h2")?.textContent;
const detail = () => screen.getByRole("heading").nextElementSibling?.textContent ?? null;
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const noButton = (name: string) => screen.queryByRole("button", { name });

/** A command's named argument, as the page sent it. */
const arg = (args: InvokeArgs | undefined, key: string): unknown => new Map(Object.entries(args ?? {})).get(key);

/** Records the links opened in the browser. */
function opened() {
  const urls: unknown[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "open_url") urls.push(arg(args, "url"));
  });
  return urls;
}

describe("MergeBox", () => {
  it("shows nothing until it knows where the pull request stands", () => {
    const { container } = box({ pull: { view: null } });
    box({ pull: { manage: null } });
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it.each<[string, Setup, string, string | null]>([
    ["ready", {}, "Ready to merge", "Merging goes into main."],
    [
      "ready through the queue",
      { manage: { isMergeQueueEnabled: true } },
      "Ready to merge",
      "This branch merges through the merge queue.",
    ],
    ["unstable", { view: { status: "unstable" } }, "Some checks didn't pass", "Merging goes into main."],
    [
      "queued",
      { view: { status: "queued" }, manage: { queuePosition: 2 } },
      "Queued to merge",
      "Position 2 in the merge queue.",
    ],
    ["queued, place unknown", { view: { status: "queued" } }, "Queued to merge", null],
    [
      "auto",
      { view: { status: "auto" }, manage: { autoMerge: { method: "SQUASH", by: "ana" } } },
      "Auto-merge is on",
      "It's squashed and merged once everything passes.",
    ],
    ["auto, how unknown", { view: { status: "auto" } }, "Auto-merge is on", null],
    [
      "merged",
      { view: { status: "merged" }, details: { state: "MERGED" } },
      "Merged",
      "The promo-keep branch can be deleted.",
    ],
    [
      "merged, branch gone",
      { view: { status: "merged" }, details: { state: "MERGED" }, manage: { headRefExists: false } },
      "Merged",
      "The branch is gone.",
    ],
    [
      "closed, branch can't be deleted",
      { view: { status: "closed" }, details: { state: "CLOSED" }, manage: { viewerCanDeleteHeadRef: false } },
      "Closed",
      "The branch is gone.",
    ],
    [
      "behind",
      { view: { status: "behind" } },
      "This branch is out of date",
      "Bring in the latest from main before merging.",
    ],
    [
      "conflicts",
      { view: { status: "conflicts" } },
      "This branch has conflicts that must be resolved",
      "Resolve them on GitHub or locally, then push.",
    ],
    ["blocked", { view: { status: "blocked" } }, "Merging is blocked", null],
    ["checking", { view: { status: "checking" } }, "Checking whether it can be merged…", null],
  ])("says where it stands when %s", (_, setup, title, words) => {
    box(setup);
    expect(status()).toBe(title);
    expect(detail()).toBe(words);
  });

  it("lists what stands in the way, in words", () => {
    box({
      view: {
        status: "blocked",
        canMerge: false,
        reasons: ["approvals", "changes", "codeOwners", "failing", "pending", "conversations", "behind", "conflicts"],
      },
      pull: { unresolved: 3 },
    });
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Review required",
      "Changes were requested",
      "Review from a code owner is required",
      "Required checks are failing",
      "Required checks are still running",
      "3 conversations must be resolved",
      "The base branch has new commits",
      "Conflicts with the base branch",
    ]);
  });

  it("counts the approvals the branch rule asks for", () => {
    box({
      view: { status: "blocked", canMerge: false, reasons: ["approvals"] },
      manage: { rule: { approvals: 2, codeOwners: false, checks: [], conversations: false, linear: false } },
    });
    expect(screen.getByRole("listitem").textContent).toBe("At least 2 approving reviews are required");
  });

  it("lists nothing in the way of a draft or a closed one", () => {
    box({ view: { status: "draft", reasons: ["approvals"] }, details: { isDraft: true } });
    box({ view: { status: "closed", reasons: ["approvals"] }, details: { state: "CLOSED" } });
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("merges the way chosen, with the message GitHub would write, edited", async () => {
    const commits = { commits: [fakeCommit()], forcePushes: [], reviewed: null };
    const { pull } = box({ pull: { commits } });
    await userEvent.click(button("Commit Message"));
    const title = screen.getByRole("textbox", { name: "Commit title" });
    expect(title).toHaveProperty("value", "Keep the promo code through checkout (#42)");
    expect(screen.getByRole("textbox", { name: "Commit message" })).toHaveProperty("value", "Fixes the promo code.");
    await userEvent.clear(title);
    await userEvent.type(title, "Promo");
    await userEvent.type(screen.getByRole("textbox", { name: "Commit message" }), "!");
    await userEvent.click(screen.getByRole("checkbox", { name: "Delete the branch after merging" }));
    await userEvent.click(button("Squash and Merge"));
    expect(pull.actions.merge).toHaveBeenCalledWith(
      "squash",
      { title: "Promo", body: "Fixes the promo code.!" },
      { bypass: false, deleteAfter: true },
    );
  });

  it("keeps each way's message apart, and rebases with the commits' own", async () => {
    const { pull } = box();
    await userEvent.click(button("Commit Message"));
    await userEvent.type(screen.getByRole("textbox", { name: "Commit title" }), " edited");
    await userEvent.click(screen.getByRole("combobox", { name: "Merge method" }));
    await userEvent.click(await screen.findByRole("option", { name: "Create Merge Commit" }));
    expect(screen.getByRole("textbox", { name: "Commit title" })).toHaveProperty(
      "value",
      "Merge pull request #42 from acme/promo-keep",
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Merge method" }));
    await userEvent.click(await screen.findByRole("option", { name: "Rebase and Merge" }));
    expect(noButton("Commit Message")).toBeNull();
    await userEvent.click(button("Rebase and Merge"));
    expect(pull.actions.merge).toHaveBeenCalledWith("rebase", undefined, { bypass: false, deleteAfter: false });
    await userEvent.click(screen.getByRole("combobox", { name: "Merge method" }));
    await userEvent.click(await screen.findByRole("option", { name: "Squash and Merge" }));
    await userEvent.click(button("Commit Message"));
    expect(screen.getByRole("textbox", { name: "Commit title" })).toHaveProperty(
      "value",
      "Keep the promo code through checkout (#42) edited",
    );
  });

  it("doesn't offer a choice of one, or deleting a branch GitHub deletes itself", () => {
    box({ details: { mergeMethods: ["merge"] }, manage: { deleteBranchOnMerge: true } });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(button("Create Merge Commit")).toBeTruthy();
  });

  it("stops offering a way chosen once it's no longer allowed", async () => {
    const view = fakeView();
    const pull = fakePull({ view, manage: fakeManage() });
    const all = fakeDetails();
    const { rerender } = renderTwice(() => <MergeBox details={all} pull={pull} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Merge method" }));
    await userEvent.click(await screen.findByRole("option", { name: "Rebase and Merge" }));
    expect(button("Rebase and Merge")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
    rerender(<MergeBox details={fakeDetails({ mergeMethods: ["merge", "squash"] })} pull={pull} />);
    expect(noButton("Rebase and Merge")).toBeNull();
  });

  it("offers nothing to merge when no way is allowed", () => {
    box({ details: { mergeMethods: [] } });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows it's merging", () => {
    box({ pull: { busy: "merge" } });
    expect(button("Squash and Merge").hasAttribute("disabled")).toBe(true);
  });

  it("lets an admin merge without waiting, as a warning", async () => {
    const { pull } = box({ view: { status: "blocked", canMerge: false, canBypass: true } });
    expect(noButton("Squash and Merge")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: /bypass rules/u }));
    await userEvent.click(button("Squash and Merge"));
    expect(pull.actions.merge).toHaveBeenCalledWith("squash", expect.anything(), { bypass: true, deleteAfter: false });
  });

  it("turns on merging when ready, with the message", async () => {
    const { pull } = box({ view: { status: "blocked", canMerge: false, canAutoMerge: true } });
    await userEvent.click(button("Enable Auto-Merge"));
    expect(pull.actions.autoMerge).toHaveBeenCalledWith("squash", {
      title: "Keep the promo code through checkout (#42)",
      body: "Fixes the promo code.",
    });
  });

  it("turns on merging when ready by rebasing, and shows it's under way", async () => {
    const { pull } = box({
      details: { mergeMethods: ["rebase"] },
      view: { status: "blocked", canMerge: false, canAutoMerge: true },
    });
    await userEvent.click(button("Enable Auto-Merge"));
    expect(pull.actions.autoMerge).toHaveBeenCalledWith("rebase", undefined);
  });

  it("shows auto-merge being turned on", () => {
    box({ view: { status: "blocked", canMerge: false, canAutoMerge: true }, pull: { busy: "auto" } });
    expect(button("Enable Auto-Merge").hasAttribute("disabled")).toBe(true);
  });

  it("turns off merging when ready, and uses the merge queue", async () => {
    const { pull } = box({
      view: { status: "auto", canMerge: false, canDisableAutoMerge: true, canEnqueue: true, canDequeue: true },
    });
    await userEvent.click(button("Disable Auto-Merge"));
    await userEvent.click(button("Add to Merge Queue"));
    await userEvent.click(button("Remove from Merge Queue"));
    expect(pull.actions.disableAutoMerge).toHaveBeenCalled();
    expect(pull.actions.enqueue).toHaveBeenCalled();
    expect(pull.actions.dequeue).toHaveBeenCalled();
  });

  it("shows the queue being joined", () => {
    box({ view: { status: "ready", canMerge: false, canEnqueue: true }, pull: { busy: "queue" } });
    expect(button("Add to Merge Queue").hasAttribute("disabled")).toBe(true);
  });

  it("updates the branch by merging or rebasing", async () => {
    const { pull } = box({ view: { status: "behind", canMerge: false, canUpdateBranch: true } });
    await userEvent.click(button("Update Branch"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Update with Merge Commit" }));
    await userEvent.click(button("Update Branch"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Update with Rebase" }));
    expect(pull.actions.updateBranch).toHaveBeenCalledWith("MERGE");
    expect(pull.actions.updateBranch).toHaveBeenCalledWith("REBASE");
  });

  it("shows the branch being updated", () => {
    box({ view: { status: "behind", canMerge: false, canUpdateBranch: true }, pull: { busy: "update" } });
    expect(button("Update Branch").hasAttribute("disabled")).toBe(true);
  });

  it("opens GitHub's page for resolving conflicts", async () => {
    const urls = opened();
    box({ view: { status: "conflicts", canMerge: false } });
    await userEvent.click(button("Resolve Conflicts"));
    expect(urls).toEqual(["https://github.com/acme/shop/pull/42/conflicts"]);
  });

  it("deletes the branch and reopens a closed one", async () => {
    const { pull } = box({ view: { status: "closed", canMerge: false }, details: { state: "CLOSED" } });
    await userEvent.click(button("Delete Branch"));
    await userEvent.click(button("Reopen Pull Request"));
    expect(pull.actions.deleteBranch).toHaveBeenCalled();
    expect(pull.actions.reopen).toHaveBeenCalled();
  });

  it("doesn't offer reopening to someone who can't", () => {
    box({
      view: { status: "closed", canMerge: false },
      details: { state: "CLOSED", viewerCanUpdate: false },
      pull: { busy: "branch" },
    });
    expect(noButton("Reopen Pull Request")).toBeNull();
    expect(button("Delete Branch").hasAttribute("disabled")).toBe(true);
  });

  it("shows a closed one reopening", () => {
    box({ view: { status: "closed", canMerge: false }, details: { state: "CLOSED" }, pull: { busy: "close" } });
    expect(button("Reopen Pull Request").hasAttribute("disabled")).toBe(true);
  });

  it("marks a draft ready, for someone who can", async () => {
    const { pull } = box({ view: { status: "draft", canMerge: false }, details: { isDraft: true } });
    await userEvent.click(button("Ready for Review"));
    expect(pull.actions.ready).toHaveBeenCalled();
  });

  it("shows a draft being marked ready, and offers it only while open and to who can", () => {
    box({ view: { status: "draft", canMerge: false }, details: { isDraft: true }, pull: { busy: "ready" } });
    expect(button("Ready for Review").hasAttribute("disabled")).toBe(true);
    box({ view: { status: "draft", canMerge: false }, details: { isDraft: true, viewerCanUpdate: false } });
    box({ view: { status: "draft", canMerge: false }, details: { isDraft: true, state: "CLOSED" } });
    expect(screen.getAllByRole("button", { name: "Ready for Review" })).toHaveLength(1);
  });

  it("offers nothing to do while nothing can be", () => {
    box({ view: { status: "blocked", canMerge: false } });
    const region = screen.getByRole("region", { name: "Merging is blocked" });
    expect(within(region).queryByRole("button")).toBeNull();
  });
});
