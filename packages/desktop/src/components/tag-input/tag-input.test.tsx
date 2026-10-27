import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";

import { TagInput } from "@/components/tag-input/tag-input";

const NONE: string[] = [];
const ownerAndName = (v: string) => (v.includes("/") ? null : "Use owner/name");

function Repos({ initial = NONE, validate }: { initial?: string[]; validate?: (value: string) => string | null }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <TagInput value={value} onChange={setValue} label="Repositories" placeholder="owner/name" validate={validate} />
      <output>{value.join("|")}</output>
    </>
  );
}

const field = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Repositories" });
const values = () => screen.getByRole("status").textContent;

describe("TagInput", () => {
  it("adds a value on Enter and on a comma", async () => {
    render(<Repos />);
    expect(field().getAttribute("placeholder")).toBe("owner/name");
    await userEvent.type(field(), "acme/api{Enter}");
    await userEvent.type(field(), "acme/web,");
    expect(values()).toBe("acme/api|acme/web");
    expect(field().value).toBe("");
    // With values, the placeholder goes.
    expect(field().getAttribute("placeholder")).toBe("");
  });

  it("adds what's typed when it loses focus, and ignores blanks", async () => {
    render(<Repos />);
    await userEvent.type(field(), "   {Enter}");
    expect(values()).toBe("");
    await userEvent.type(field(), "acme/api");
    await userEvent.tab();
    expect(values()).toBe("acme/api");
  });

  it("says why a value can't be added, until the field changes", async () => {
    render(<Repos initial={["acme/api"]} validate={ownerAndName} />);
    await userEvent.type(field(), "acme{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("Use owner/name");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    await userEvent.type(field(), "x");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field().getAttribute("aria-describedby")).toBeNull();
  });

  it("won't add one twice", async () => {
    render(<Repos initial={["acme/api"]} />);
    await userEvent.type(field(), "acme/api{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("Already added");
    expect(values()).toBe("acme/api");
  });

  it("removes one with its button, and the last with Backspace in an empty field", async () => {
    render(<Repos initial={["acme/api", "acme/web", "acme/docs"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove acme/web" }));
    expect(values()).toBe("acme/api|acme/docs");
    await userEvent.type(field(), "a{Backspace}{Backspace}");
    expect(values()).toBe("acme/api");
  });

  it("leaves the values alone on Backspace with nothing to remove", async () => {
    render(<Repos />);
    await userEvent.type(field(), "{Backspace}");
    expect(values()).toBe("");
  });
});
