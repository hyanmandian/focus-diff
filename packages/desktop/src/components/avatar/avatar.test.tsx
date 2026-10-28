import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar/avatar";

describe("Avatar", () => {
  it("shows the initials until a picture loads", () => {
    render(
      <Avatar>
        <AvatarImage src="https://example.com/octocat.png" alt="octocat" />
        <AvatarFallback>OC</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("OC")).toBeTruthy();
    // A picture that hasn't loaded isn't shown.
    expect(screen.queryByRole("img")).toBeNull();
  });
});
