import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Avatar, AvatarFallback, AvatarImage, Face } from "@/components/avatar/avatar";

describe("Avatar", () => {
  it("shows the initials until a picture loads", () => {
    render(
      <Avatar>
        <AvatarImage src="https://example.com/bruno_mouse.png" alt="bruno_mouse" />
        <AvatarFallback>BR</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("BR")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("Face", () => {
  it("shows a picture, or initials", () => {
    render(
      <>
        <Face actor={null} />
        <Face actor={{ login: "bruno_mouse" }} />
      </>,
    );
    expect(screen.getByText("?")).toBeTruthy();
    expect(screen.getByText("BR")).toBeTruthy();
  });
});
