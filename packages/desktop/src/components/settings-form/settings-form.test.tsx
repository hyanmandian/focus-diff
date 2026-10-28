import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  Group,
  Intro,
  LinkRow,
  Pane,
  Row,
  SwitchRow,
  radioKeys,
  useDetail,
} from "@/components/settings-form/settings-form";

const noop = () => {};

describe("Pane", () => {
  it("shows its title in the strip, with no hairline until the content scrolls", () => {
    const { container } = render(
      <Pane title="Filters">
        <p>Body</p>
      </Pane>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Filters" })).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    const header = container.querySelector("header")!;
    expect(header.classList.contains("border-transparent")).toBe(true);

    const column = header.nextElementSibling!;
    fireEvent.scroll(column, { target: { scrollTop: 10 } });
    expect(header.classList.contains("border-separator")).toBe(true);
  });

  it("opens a top-level pane on its tile and gives the strip its name only once that scrolls away", () => {
    const { container } = render(
      <Pane title="Queues" hero="queues">
        <p>Body</p>
      </Pane>,
    );
    // The strip's copy is hidden from assistive tech while the big one shows.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("What's waiting on you, in the panel's tabs")).toBeTruthy();
    const header = container.querySelector("header")!;
    const strip = header.querySelector("h1")!;
    expect(strip.classList.contains("opacity-0")).toBe(true);

    const column = header.nextElementSibling!;
    fireEvent.scroll(column, { target: { scrollTop: 60 } });
    expect(header.classList.contains("border-transparent")).toBe(true);
    fireEvent.scroll(column, { target: { scrollTop: 200 } });
    expect(header.classList.contains("border-separator")).toBe(true);
    expect(strip.classList.contains("opacity-0")).toBe(false);
  });

  it("goes back from a detail and shows the detail's tools", async () => {
    const onBack = vi.fn<() => void>();
    render(
      <Pane title="Review" back={{ label: "Queues", onBack }} tools={<button type="button">Delete</button>}>
        <p>Body</p>
      </Pane>,
    );
    const back = screen.getByRole("button", { name: "Back to Queues" });
    expect(back.getAttribute("title")).toBe("Back to Queues (⌘[)");
    await userEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});

describe("Group and Row", () => {
  it("draws a section with its heading, accessory and footnote", () => {
    render(
      <Group title="Share" accessory={<button type="button">Add</button>} footer="Shared as text.">
        <Row label="Name" description="What it's called" htmlFor="name">
          <input id="name" />
        </Row>
      </Group>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Share" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByText("Shared as text.")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByText("What it's called")).toBeTruthy();
  });

  it("puts an accessory alone on the heading line, and nothing above a bare group", () => {
    const { rerender } = render(
      <Group accessory={<button type="button">Add</button>}>
        <Row>
          <span>Only a control</span>
        </Row>
      </Group>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByText("Only a control")).toBeTruthy();

    rerender(
      <Group title="Heading alone">
        <Row label="Plain label" />
      </Group>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Heading alone" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Plain label")).toBeTruthy();
  });

  it("draws a bare group with nothing above it", () => {
    render(
      <Group>
        <Row label="Alone" />
      </Group>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Alone")).toBeTruthy();
  });

  it("stacks a wide control under its label", () => {
    render(
      <Row stacked label="Only in" htmlFor="repos">
        <textarea id="repos" />
      </Row>,
    );
    expect(screen.getByLabelText("Only in")).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("shows a description alone, stacked or not", () => {
    const { rerender } = render(<Row description="Nothing here yet." />);
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    rerender(<Row stacked />);
    expect(screen.queryByText("Nothing here yet.")).toBeNull();
  });

  it("writes a pane's lead-in", () => {
    render(<Intro>What this pane is for.</Intro>);
    expect(screen.getByText("What this pane is for.")).toBeTruthy();
  });
});

describe("SwitchRow", () => {
  it("turns its setting on and off by its label", async () => {
    const onChange = vi.fn<(v: boolean) => void>();
    render(<SwitchRow checked={false} onChange={onChange} label="Sound" hint="On new pull requests" />);
    const toggle = screen.getByRole("switch", { name: "Sound" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("On new pull requests")).toBeTruthy();
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true, expect.anything());
  });
});

describe("LinkRow", () => {
  it("opens its detail from the whole row and keeps its control apart", async () => {
    const onOpen = vi.fn<() => void>();
    const control = vi.fn<() => void>();
    render(
      <LinkRow
        leading={<span>•</span>}
        label="Needs review"
        description="Open, asked of you"
        muted
        control={
          <button type="button" onClick={control}>
            Toggle
          </button>
        }
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Needs review/u }));
    expect(onOpen).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(control).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByText("Open, asked of you")).toBeTruthy();
  });

  it("is just a label and a chevron without the extras", () => {
    render(<LinkRow label="Plain" onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Plain" })).toBeTruthy();
  });
});

function Detail() {
  const { openId, open, close, backRef, rowRef } = useDetail();
  if (openId)
    return (
      <Pane title={openId} back={{ label: "List", onBack: close, ref: backRef }}>
        <p>Detail of {openId}</p>
      </Pane>
    );
  return (
    <div>
      {["a", "b"].map((id) => (
        <LinkRow
          key={id}
          ref={rowRef(id)}
          label={`Row ${id}`}
          onOpen={() => {
            open(id);
          }}
        />
      ))}
    </div>
  );
}

describe("useDetail", () => {
  it("moves focus to the way back on the way in and to the row on the way out", async () => {
    const { rerender } = render(<Detail />);
    await userEvent.click(screen.getByRole("button", { name: "Row b" }));
    expect(screen.getByText("Detail of b")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to List" }));

    // Rendered again, it stays where it is.
    rerender(<Detail />);
    expect(screen.getByText("Detail of b")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Back to List" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Row b" }));
  });

  it("goes back with ⌘[ and only then", () => {
    render(<Detail />);
    // Nothing open: the shortcut does nothing.
    const idle = new KeyboardEvent("keydown", { key: "[", metaKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(idle);
    });
    expect(idle.defaultPrevented).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Row a" }));
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.getByText("Detail of a")).toBeTruthy();

    const back = new KeyboardEvent("keydown", { key: "[", metaKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(back);
    });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Row a" }));
  });
});

function Radios({ onPick }: { onPick: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Order" tabIndex={-1} onKeyDown={radioKeys}>
      {["one", "two", "three"].map((v) => (
        <button
          key={v}
          type="button"
          // radioKeys is for the hand-drawn radios (buttons with role="radio"), so that's what it's tested on.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="radio"
          aria-checked={false}
          onClick={() => {
            onPick(v);
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

describe("radioKeys", () => {
  it("moves to the next or previous choice with the arrows, wrapping round, and picks it", () => {
    const onPick = vi.fn<(v: string) => void>();
    render(<Radios onPick={onPick} />);
    const [one, two, three] = screen.getAllByRole("radio");
    one!.focus();
    fireEvent.keyDown(one!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(two);
    expect(onPick).toHaveBeenLastCalledWith("two");
    fireEvent.keyDown(two!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(three);
    fireEvent.keyDown(three!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(one);
    fireEvent.keyDown(one!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(three);
    fireEvent.keyDown(three!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(two);
    expect(onPick).toHaveBeenCalledTimes(5);
  });

  it("leaves other keys, and keys from outside the choices, alone", () => {
    const onPick = vi.fn<(v: string) => void>();
    render(<Radios onPick={onPick} />);
    const group = screen.getByRole("radiogroup");
    const [one] = screen.getAllByRole("radio");
    one!.focus();
    fireEvent.keyDown(one!, { key: "Enter" });
    group.focus();
    fireEvent.keyDown(group, { key: "ArrowDown" });
    expect(onPick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(group);
  });
});

describe("re-rendering", () => {
  // The React Compiler keeps each part of a component until what it's made from changes: rendered
  // again with the same props, a pane shows exactly what it did.
  it("keeps showing the same thing when rendered again with the same props", () => {
    const back = { label: "Queues", onBack: () => {} };
    const leading = <span>•</span>;
    const control = <span>control</span>;
    const field = <input id="x" />;
    const stackedField = <input aria-label="stacked field" />;
    const tools = <span>tools</span>;
    const rows = () => (
      <>
        <Row label="Label" description="About it" htmlFor="x">
          {field}
        </Row>
        <Row stacked label="Stacked" className="extra">
          {stackedField}
        </Row>
        <SwitchRow checked onChange={noop} label="Switch" />
        <LinkRow leading={leading} label="Link" description="More" control={control} onOpen={noop} muted />
      </>
    );
    const same = rows();
    const group = (way: typeof back, inner: React.ReactNode) => (
      <Pane title="Detail" back={way} tools={tools} hero="filters">
        <Intro>Lead-in</Intro>
        <Group title="Group" footer="Footnote">
          {inner}
        </Group>
      </Pane>
    );
    const { rerender, container } = render(group(back, same));
    const before = container.innerHTML;
    rerender(group(back, same));
    rerender(group({ ...back }, rows()));
    expect(container.innerHTML).toBe(before);
  });
});
