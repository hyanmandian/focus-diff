import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "./avatar";

describe("Avatar", () => {
  it("shows the initials until a picture loads, with a badge and a group count", () => {
    render(
      <AvatarGroup aria-label="Reviewers">
        <Avatar size="sm">
          <AvatarImage src="https://example.com/octocat.png" alt="octocat" />
          <AvatarFallback>OC</AvatarFallback>
          <AvatarBadge aria-label="Approved" />
        </Avatar>
        <Avatar>
          <AvatarFallback>MM</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+3</AvatarGroupCount>
      </AvatarGroup>,
    );
    expect(screen.getByText("OC")).toBeTruthy();
    expect(screen.getByText("MM")).toBeTruthy();
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByLabelText("Approved")).toBeTruthy();
    // A picture that hasn't loaded isn't shown.
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is drawn at the size asked for", () => {
    render(
      <Avatar size="lg" data-testid="avatar">
        <AvatarFallback>LG</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByTestId("avatar").dataset.size).toBe("lg");
  });
});
