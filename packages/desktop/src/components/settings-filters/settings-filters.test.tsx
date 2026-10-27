import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { Filters } from "@/components/settings-filters/settings-filters";
import { defaultConfig, type Config, type DiffFilter } from "@/utils/config/config";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { exportFilters } from "@/utils/filters/filters";
import { setLanguage } from "@/utils/i18n/i18n";

const filter = (id: string, name: string, more: Partial<DiffFilter> = {}): DiffFilter => ({
  id,
  name,
  include: "",
  exclude: "",
  repos: [],
  ...more,
});

/** The pane over a config it keeps, as the settings window does; `changes` sees each one. */
function setup(filters: DiffFilter[], changes = vi.fn<(c: Config) => void>()) {
  function Harness() {
    const [config, setConfig] = useState<Config>({ ...defaultConfig(), filters });
    return (
      <Filters
        config={config}
        onChange={(c) => {
          changes(c);
          setConfig(c);
        }}
      />
    );
  }
  render(<Harness />);
  return { changes, last: () => changes.mock.lastCall![0].filters };
}

/** Answers the native "Remove?" alert. */
function confirmWith(answer: boolean) {
  const asked = vi.fn<(args: unknown) => void>();
  mockCommands((cmd, args) => {
    if (cmd === "confirm") {
      asked(args);
      return answer;
    }
    return null;
  });
  return asked;
}

describe("Filters", () => {
  it("renames a filter and edits its patterns, saying when one isn't a valid expression", async () => {
    const { last } = setup([filter("a", "Code"), filter("b", "Docs")]);
    const [name] = screen.getAllByRole("textbox", { name: "Filter name" });
    await userEvent.type(name!, "s");
    expect(last().map((f) => f.name)).toEqual(["Codes", "Docs"]);

    const [include] = screen.getAllByLabelText("Include");
    fireEvent.change(include!, { target: { value: "\\.tsx?$" } });
    expect(last()[0]!.include).toBe("\\.tsx?$");
    expect(screen.queryByText("Not a valid regular expression.")).toBeNull();

    const [leaveOut] = screen.getAllByLabelText("Leave out");
    fireEvent.change(leaveOut!, { target: { value: "(" } });
    expect(last()[0]!.exclude).toBe("(");
    expect(screen.getByText("Not a valid regular expression.")).toBeTruthy();
    expect(leaveOut!.getAttribute("aria-invalid")).toBe("true");
  });

  it("offers a filter only in the repositories added to it, refusing what isn't one", async () => {
    const { last } = setup([filter("a", "Code")]);
    expect(screen.getByText(/Every repository\./u)).toBeTruthy();
    const repos = screen.getByRole("textbox", { name: "Repositories for Code" });

    await userEvent.type(repos, "nonsense{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("Use owner/name, or owner/* for all of an owner's repositories");

    await userEvent.clear(repos);
    await userEvent.type(repos, "acme/web{Enter}");
    expect(last()[0]!.repos).toEqual(["acme/web"]);
    expect(screen.queryByText(/Every repository\./u)).toBeNull();
  });

  it("moves filters up and down, the ends staying put", async () => {
    const { last } = setup([filter("a", "One"), filter("b", "Two")]);
    expect(screen.getByRole("button", { name: "Move One up" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Move Two down" }).hasAttribute("disabled")).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Move One down" }));
    expect(last().map((f) => f.name)).toEqual(["Two", "One"]);
    await userEvent.click(screen.getByRole("button", { name: "Move One up" }));
    expect(last().map((f) => f.name)).toEqual(["One", "Two"]);
  });

  it("removes a filter only once the alert is answered with Remove", async () => {
    const asked = confirmWith(false);
    const { changes, last } = setup([filter("a", "One"), filter("b", "Two")]);
    await userEvent.click(screen.getByRole("button", { name: "Remove One" }));
    await waitFor(() => {
      expect(asked).toHaveBeenCalledOnce();
    });
    expect(asked.mock.lastCall![0]).toMatchObject({ title: "Remove the “One” filter?" });
    expect(changes).not.toHaveBeenCalled();

    confirmWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Remove One" }));
    await waitFor(() => {
      expect(last().map((f) => f.name)).toEqual(["Two"]);
    });
  });

  it("adds a recipe's filters, or a blank one, up to twelve", async () => {
    const { last } = setup([]);
    await userEvent.click(screen.getByRole("button", { name: "Add Filter" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Code, then tests/u }));
    expect(last().length).toBeGreaterThan(0);
    expect(last().map((f) => f.repos)).toEqual(last().map(() => []));
    expect(new Set(last().map((f) => f.id)).size).toBe(last().length);

    await userEvent.click(screen.getByRole("button", { name: "Add Filter" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Blank" }));
    expect(last().at(-1)).toMatchObject({ name: "New filter", include: "", exclude: "", repos: [] });
  });

  it("can't add a thirteenth filter", () => {
    setup(Array.from({ length: 12 }, (_, i) => filter(`f${i}`, `F${i}`)));
    expect(screen.getByRole("button", { name: "Add Filter" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps a recipe's extra filters out once there are twelve", async () => {
    const { last } = setup(Array.from({ length: 11 }, (_, i) => filter(`f${i}`, `F${i}`)));
    await userEvent.click(screen.getByRole("button", { name: "Add Filter" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Code, then tests/u }));
    expect(last()).toHaveLength(12);
  });
});

describe("Sharing filters", () => {
  it("copies the filters as text and says so until the button loses focus", async () => {
    const filters = [filter("a", "Code", { include: "\\.ts$" })];
    setup(filters);
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const copy = screen.getByRole("button", { name: /Copy Filters/u });
    await userEvent.click(copy);
    expect(write).toHaveBeenCalledWith(exportFilters(filters));
    expect(await screen.findByRole("button", { name: /Copied/u })).toBe(copy);

    fireEvent.blur(copy);
    expect(copy.textContent).toContain("Copy Filters");
  });

  it("says when the clipboard can't be reached", async () => {
    setup([filter("a", "Code")]);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await userEvent.click(screen.getByRole("button", { name: /Copy Filters/u }));
    expect((await screen.findByRole("status")).textContent).toBe("Couldn't reach the clipboard.");
  });

  it("has nothing to copy with no filters", () => {
    setup([]);
    expect(screen.getByRole("button", { name: /Copy Filters/u }).hasAttribute("disabled")).toBe(true);
  });

  it("imports a teammate's filters, skipping the ones already there", async () => {
    const own = [filter("a", "Code", { include: "\\.ts$" })];
    const theirs = exportFilters([own[0]!, filter("b", "Docs", { include: "\\.md$" })]);
    const { last } = setup(own);
    const field = screen.getByRole("textbox", { name: "Import filters" });
    const button = screen.getByRole("button", { name: "Import" });
    expect(button.hasAttribute("disabled")).toBe(true);

    fireEvent.change(field, { target: { value: theirs } });
    await userEvent.click(button);
    expect(last().map((f) => f.name)).toEqual(["Code", "Docs"]);
    expect(screen.getByRole("status").textContent).toBe("Added 1 filter.");
    expect(field).toHaveProperty("value", "");

    // The same again: nothing new.
    fireEvent.change(field, { target: { value: theirs } });
    expect(screen.queryByRole("status")).toBeNull();
    await userEvent.click(button);
    expect(screen.getByRole("status").textContent).toBe("You already have all of them.");
  });

  it("says how many didn't fit, and when there's no room at all", async () => {
    const own = Array.from({ length: 11 }, (_, i) => filter(`f${i}`, `F${i}`));
    const theirs = exportFilters([filter("x", "X"), filter("y", "Y")]);
    setup(own);
    const field = screen.getByRole("textbox", { name: "Import filters" });
    fireEvent.change(field, { target: { value: theirs } });
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByRole("status").textContent).toBe("Added 1 filter. 1 filter didn't fit: the app keeps 12.");

    fireEvent.change(field, { target: { value: exportFilters([filter("z", "Z")]) } });
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByRole("status").textContent).toBe("No room: the app keeps 12 filters.");
  });

  it("explains text that isn't filters, or holds none, until it's edited", async () => {
    setup([]);
    const field = screen.getByRole("textbox", { name: "Import filters" });
    fireEvent.change(field, { target: { value: "hello" } });
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "That isn't a copied set of filters. Paste exactly what Copy Filters gave.",
    );
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);

    fireEvent.change(field, { target: { value: '{"global": []}' } });
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "That text has no filters in it. Ask for them to be copied again.",
    );
  });
});

describe("re-rendering", () => {
  // The React Compiler keeps each part until what it's made from changes; rendered again, or in
  // another language and back, the pane shows what it did.
  it("shows the same pane when rendered again, and after a trip through another language", () => {
    const config = { ...defaultConfig(), filters: [filter("a", "Code", { repos: ["acme/web"] }), filter("b", "Docs")] };
    const onChange = vi.fn<(c: Config) => void>();
    const { container, rerender } = render(<Filters config={config} onChange={onChange} />);
    const before = container.innerHTML;
    rerender(<Filters config={config} onChange={onChange} />);
    act(() => {
      setLanguage("pt-BR");
    });
    expect(screen.getByRole("button", { name: /Copiar filtros/iu })).toBeTruthy();
    act(() => {
      setLanguage("en");
    });
    expect(container.innerHTML).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
  });
});
