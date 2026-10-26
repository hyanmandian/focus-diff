import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { openViewer, Viewer } from "./viewer";

const SRC = "https://github.com/user-attachments/assets/screenshot.png";

function open(alt = "The new settings pane") {
  act(() => {
    openViewer({ src: SRC, alt });
  });
  return screen.getByRole("dialog");
}
const scale = () => screen.getByText(/%$/u).textContent;
const picture = () => screen.getByRole<HTMLImageElement>("img");

describe("Viewer", () => {
  it("shows nothing until a picture is opened", () => {
    render(<Viewer />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the picture large, named by its description, and Close puts focus back", async () => {
    render(
      <>
        <button type="button">Opener</button>
        <Viewer />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    const dialog = open();
    expect(dialog.getAttribute("aria-label")).toBe("The new settings pane");
    expect(picture().getAttribute("src")).toBe(SRC);
    expect(screen.getByText("The new settings pane").tagName).toBe("P");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("puts focus back on a drawing that opened it, and copes with nothing focused", () => {
    render(
      <>
        <svg data-testid="chart" />
        <Viewer />
      </>,
    );
    const chart = screen.getByTestId("chart");
    chart.focus();
    open();
    act(() => {
      screen.getByRole("button", { name: "Close" }).click();
    });
    expect(document.activeElement).toBe(chart);
    const nothing = vi.spyOn(document, "activeElement", "get").mockReturnValue(null);
    open();
    nothing.mockRestore();
    act(() => {
      screen.getByRole("button", { name: "Close" }).click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is called a picture when it has no description", () => {
    render(<Viewer />);
    expect(open("").getAttribute("aria-label")).toBe("Picture");
    act(() => {
      screen.getByRole("button", { name: "Close" }).click();
    });
  });

  it("zooms with the buttons, within limits, and back to actual size", async () => {
    render(<Viewer />);
    open();
    expect(scale()).toBe("100%");
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(scale()).toBe("125%");
    // No further than 800%.
    await userEvent.keyboard("+".repeat(12));
    expect(scale()).toBe("800%");
    await userEvent.click(screen.getByRole("button", { name: "Actual size" }));
    expect(scale()).toBe("100%");
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(scale()).toBe("80%");
    // No smaller than 50%.
    await userEvent.keyboard("-".repeat(5));
    expect(scale()).toBe("50%");
    await userEvent.keyboard("{Escape}");
  });

  it("zooms with the keys and closes with Esc", async () => {
    render(<Viewer />);
    open();
    await userEvent.keyboard("+");
    expect(scale()).toBe("125%");
    await userEvent.keyboard("=");
    expect(scale()).toBe("156%");
    await userEvent.keyboard("-");
    expect(scale()).toBe("125%");
    await userEvent.keyboard("0");
    expect(scale()).toBe("100%");
    await userEvent.keyboard("x");
    expect(scale()).toBe("100%");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zooms with the wheel or a pinch, and in and back with a double click", async () => {
    render(<Viewer />);
    const dialog = open();
    fireEvent.wheel(dialog, { deltaY: -10 });
    expect(scale()).toBe("110%");
    fireEvent.wheel(dialog, { deltaY: 10, ctrlKey: true });
    expect(scale()).toBe("99%");
    await userEvent.click(screen.getByRole("button", { name: "Actual size" }));
    await userEvent.dblClick(picture());
    expect(scale()).toBe("200%");
    await userEvent.dblClick(picture());
    expect(scale()).toBe("100%");
    await userEvent.keyboard("{Escape}");
  });

  it("moves the picture with a drag", () => {
    render(<Viewer />);
    open();
    const stage = picture().parentElement!;
    stage.setPointerCapture = () => {};
    fireEvent.pointerMove(stage, { clientX: 50, clientY: 50 });
    expect(picture().style.transform).toBe("translate(0px, 0px) scale(1)");
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 40, clientY: 10 });
    expect(picture().style.transform).toBe("translate(30px, -10px) scale(1)");
    fireEvent.pointerUp(stage);
    fireEvent.pointerMove(stage, { clientX: 100, clientY: 100 });
    expect(picture().style.transform).toBe("translate(30px, -10px) scale(1)");
    act(() => {
      screen.getByRole("button", { name: "Close" }).click();
    });
  });

  it("closes with a click outside the picture, not on it", async () => {
    render(<Viewer />);
    const dialog = open();
    await userEvent.click(picture());
    await userEvent.click(screen.getByText("The new settings pane"));
    expect(screen.getByRole("dialog")).toBe(dialog);
    await userEvent.click(picture().parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    await userEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
