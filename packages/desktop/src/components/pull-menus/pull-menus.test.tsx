import { DropdownMenu, DropdownMenuContent } from "@focus-diff/design-system/components/dropdown-menu";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { MergeMenuItems, PullMenuItems } from "@/components/pull-menus/pull-menus";
import type { Pull } from "@/hooks/use-pull/use-pull";
import { fakeDetails, fakePull, fakeView } from "@/utils/mock-pull/mock-pull";

/** The items, in an open menu as the toolbar shows them. */
function Menu({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu open>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

const details = fakeDetails();
const nothing = () => {};
const allowed = (a: Pull["allowed"]) => fakePull({ allowed: a });
const item = (name: string) => screen.getByRole("menuitem", { name });
const items = () => screen.queryAllByRole("menuitem").map((i) => i.textContent);

describe("MergeMenuItems", () => {
  it("merges by each way the repository allows, asking first", async () => {
    const pull = fakePull();
    const twoWays = fakeDetails({ mergeMethods: ["squash", "rebase"] });
    const onDetails = vi.fn<() => void>();
    render(
      <Menu>
        <MergeMenuItems details={twoWays} pull={pull} onDetails={onDetails} />
      </Menu>,
    );
    expect(within(screen.getByRole("group", { name: "Merge Pull Request" })).getAllByRole("menuitem")).toHaveLength(2);
    expect(items()).toEqual(["Squash and Merge…", "Rebase and Merge…", "Merge Options…"]);
    await userEvent.click(item("Rebase and Merge…"));
    expect(pull.actions.merge).toHaveBeenCalledWith("rebase");
    await userEvent.click(item("Merge Options…"));
    expect(onDetails).toHaveBeenCalled();
  });

  it("offers merging when ready, and taking it back", async () => {
    const pull = fakePull({ view: fakeView({ canMerge: false, canAutoMerge: true, canDisableAutoMerge: true }) });
    render(
      <Menu>
        <MergeMenuItems details={details} pull={pull} onDetails={nothing} />
      </Menu>,
    );
    expect(screen.getByRole("group", { name: "Merge When Ready" })).toBeTruthy();
    await userEvent.click(item("Create Merge Commit"));
    expect(pull.actions.autoMerge).toHaveBeenCalledWith("merge");
    await userEvent.click(item("Disable Auto-Merge"));
    expect(pull.actions.disableAutoMerge).toHaveBeenCalled();
  });

  it("adds to the merge queue and takes it out", async () => {
    const pull = fakePull({ view: fakeView({ canMerge: false, canEnqueue: true, canDequeue: true }) });
    render(
      <Menu>
        <MergeMenuItems details={details} pull={pull} onDetails={nothing} />
      </Menu>,
    );
    await userEvent.click(item("Add to Merge Queue"));
    await userEvent.click(item("Remove from Merge Queue"));
    expect(pull.actions.enqueue).toHaveBeenCalled();
    expect(pull.actions.dequeue).toHaveBeenCalled();
  });

  it("lets an admin bypass the rules when it can't be merged otherwise", async () => {
    const pull = fakePull({ view: fakeView({ canMerge: false, canBypass: true }) });
    render(
      <Menu>
        <MergeMenuItems details={details} pull={pull} onDetails={nothing} />
      </Menu>,
    );
    expect(screen.getByRole("group", { name: "Bypass Rules" })).toBeTruthy();
    await userEvent.click(item("Squash and Merge…"));
    expect(pull.actions.merge).toHaveBeenCalledWith("squash", undefined, { bypass: true });
  });

  it("doesn't offer bypassing when it can be merged anyway", () => {
    const both = fakePull({ view: fakeView({ canBypass: true }) });
    render(
      <Menu>
        <MergeMenuItems details={details} pull={both} onDetails={nothing} />
      </Menu>,
    );
    expect(screen.queryByRole("group", { name: "Bypass Rules" })).toBeNull();
  });

  it("updates the branch by merging or rebasing", async () => {
    const pull = fakePull({ view: fakeView({ canMerge: false, canUpdateBranch: true }) });
    render(
      <Menu>
        <MergeMenuItems details={details} pull={pull} onDetails={nothing} />
      </Menu>,
    );
    await userEvent.click(item("Update with Merge Commit"));
    await userEvent.click(item("Update with Rebase"));
    expect(vi.mocked(pull.actions.updateBranch).mock.calls).toEqual([["MERGE"], ["REBASE"]]);
  });

  it("shows nothing before it knows where the pull request stands", () => {
    const unknown = fakePull({ view: null });
    render(
      <Menu>
        <MergeMenuItems details={details} pull={unknown} onDetails={nothing} />
      </Menu>,
    );
    expect(items()).toEqual([]);
  });
});

describe("PullMenuItems", () => {
  it("offers what may be done now", async () => {
    const pull = allowed({ ready: true, draft: true, close: true, reopen: true, "delete-branch": true });
    render(
      <Menu>
        <PullMenuItems pull={pull} details={details} />
      </Menu>,
    );
    expect(items()).toEqual([
      "Ready for Review",
      "Convert to Draft",
      "Close Pull Request",
      "Reopen Pull Request",
      "Delete Branch…",
    ]);
    await userEvent.click(item("Ready for Review"));
    await userEvent.click(item("Convert to Draft"));
    await userEvent.click(item("Close Pull Request"));
    await userEvent.click(item("Reopen Pull Request"));
    await userEvent.click(item("Delete Branch…"));
    const { actions } = pull;
    for (const action of [actions.ready, actions.draft, actions.close, actions.reopen, actions.deleteBranch])
      expect(action).toHaveBeenCalledTimes(1);
  });

  it("offers only what's allowed", () => {
    const closing = allowed({ close: true });
    const reopening = allowed({ reopen: true });
    const first = render(
      <Menu>
        <PullMenuItems pull={closing} details={details} />
      </Menu>,
    );
    expect(items()).toEqual(["Close Pull Request"]);
    first.unmount();
    render(
      <Menu>
        <PullMenuItems pull={reopening} details={details} />
      </Menu>,
    );
    expect(items()).toEqual(["Reopen Pull Request"]);
  });

  it("shows nothing when nothing may be done, or before the details arrive", () => {
    const rerun = allowed({ "rerun-failed": true });
    const closing = allowed({ close: true });
    const { container } = render(<PullMenuItems pull={rerun} details={details} />);
    render(<PullMenuItems pull={closing} details={null} />, { container });
    expect(container.innerHTML).toBe("");
  });
});
