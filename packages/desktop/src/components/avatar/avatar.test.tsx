import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Avatar, AvatarFallback, AvatarImage, Face } from "@/components/avatar/avatar";

describe("Avatar", () => {
  it("shows the initials until a picture loads", () => {
    render(
      <Avatar>
        <AvatarImage src="https://example.com/octocat.png" alt="octocat" />
        <AvatarFallback>OC</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("OC")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("Face", () => {
  it("shows a picture, or initials", () => {
    render(
      <>
        <Face actor={null} />
        <Face actor={{ login: "octocat" }} />
      </>,
    );
    expect(screen.getByText("?")).toBeTruthy();
    expect(screen.getByText("OC")).toBeTruthy();
  });
});
