import { Button } from "@focus-diff/design-system/components/button";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { Picker, type Choice } from "./picker";

const choices: Choice[] = [
  { id: "ana", label: "Ana Lima", detail: "octocat", selected: false, leading: <span>A</span> },
  { id: "bruno", label: "Bruno Costa", detail: "defunkt", selected: true },
  { id: "carla", label: "Carla Dias", detail: null, selected: false },
];

// The words inside come from the Picker's children.
const trigger = <Button />;
const nothing = () => {};

type Extra = Partial<Parameters<typeof Picker>[0]>;

function picker(extra: Extra = {}) {
  const onPick = vi.fn<(choice: Choice) => void>();
  const props = {
    title: "Reviewers",
    placeholder: "Filter people",
    empty: "Nobody",
    choices,
    onPick,
    trigger,
    ...extra,
  };
  const result = render(<Picker {...props}>Reviewers</Picker>);
  return { onPick, ...result };
}

const open = () => userEvent.click(screen.getByRole("button", { name: "Reviewers" }));
const rows = () => screen.getAllByRole("option").map((o) => o.textContent);
const field = () => screen.getByRole("combobox", { name: "Filter people" });

describe("Picker", () => {
  it("opens with what's chosen first, checked, and the search field focused", async () => {
    picker();
    await open();
    expect(screen.getByRole("listbox", { name: "Reviewers" })).toBeTruthy();
    expect(rows()).toEqual(["Bruno Costadefunkt", "AAna Limaoctocat", "Carla Dias"]);
    expect(screen.getByRole("option", { name: /Bruno/u }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(field());
  });

  it("narrows by name or detail, and tells whoever loads more", async () => {
    const onQuery = vi.fn<(query: string) => void>();
    picker({ onQuery });
    await open();
    await userEvent.type(field(), "OCTO ");
    expect(rows()).toEqual(["AAna Limaoctocat"]);
    expect(onQuery).toHaveBeenLastCalledWith("OCTO");
    await userEvent.clear(field());
    await userEvent.type(field(), "carla");
    expect(rows()).toEqual(["Carla Dias"]);
  });

  it("says when nothing matches, or that more is on its way", async () => {
    picker();
    await open();
    await userEvent.type(field(), "zed");
    expect(screen.getByRole("listbox").textContent).toBe("Nobody");
  });

  it("shows it's loading", async () => {
    picker({ loading: true, choices: [] });
    await open();
    expect(screen.getByRole("listbox").textContent).toBe("…");
  });

  it("moves with the arrows, picks with Return, and stays within the list", async () => {
    const { onPick } = picker();
    await open();
    await userEvent.keyboard("{ArrowUp}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(field().getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: /Carla/u }).id);
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(onPick).toHaveBeenCalledWith(choices[0]);
    await userEvent.keyboard("a");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Return when nothing matches", async () => {
    const { onPick } = picker();
    await open();
    await userEvent.type(field(), "zed{Enter}");
    expect(field().hasAttribute("aria-activedescendant")).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("follows the pointer and picks what's clicked", async () => {
    const { onPick } = picker();
    await open();
    const carla = screen.getByRole("option", { name: /Carla/u });
    await userEvent.hover(carla);
    expect(field().getAttribute("aria-activedescendant")).toBe(carla.id);
    await userEvent.click(carla);
    expect(onPick).toHaveBeenCalledWith(choices[2]);
  });

  it("can be opened and closed from outside", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const labels = (shown: boolean) => (
      <Picker
        title="Labels"
        placeholder="Filter labels"
        empty="None"
        choices={choices}
        onPick={nothing}
        trigger={trigger}
        open={shown}
        onOpenChange={onOpenChange}
      >
        Labels
      </Picker>
    );
    const { rerender } = render(labels(true));
    expect(screen.getByRole("listbox", { name: "Labels" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(labels(false));
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
    await userEvent.click(screen.getByRole("button", { name: "Labels" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("closes on its own when no one holds it", async () => {
    picker();
    await open();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
    await open();
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(3);
  });
});
