import { platform } from "@focus-diff/desktop/utils/platform";
import { screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { startCommandServer } from "@/utils/command-server/command-server";
import { fakePorts } from "@/utils/fake-ports/fake-ports";

import { render, startPage } from "./start-page";

describe("an extension page", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    fakePorts();
    startCommandServer({ read_file: () => null });
  });

  it("plugs the browser in under its window's name, then draws its screen", async () => {
    await act(async () => {
      startPage("settings", <p>Settings</p>);
      await Promise.resolve();
    });
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(platform().features?.ai).toBe(false);
  });

  it("can draw later, as a review does once it knows what to show", async () => {
    const root = startPage("review-1");
    expect(document.querySelector("#root")!.childElementCount).toBe(0);
    await act(async () => {
      render(root, <p>Review</p>);
      await Promise.resolve();
    });
    expect(screen.getByText("Review")).toBeTruthy();
  });
});
