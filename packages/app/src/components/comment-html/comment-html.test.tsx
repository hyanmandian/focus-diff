import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MouseEvent } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { mockCommands } from "../../utils/fake-platform/fake-platform";
import type { Args } from "../../utils/platform/platform";
import { Viewer } from "../viewer/viewer";
import { CommentHtml, openClicked } from "./comment-html";

const PICTURE = "https://user-images.githubusercontent.com/1/shot.png";

/** A command's named argument, as the page sent it. */
const arg = (args: Args | undefined, key: string): unknown => new Map(Object.entries(args ?? {})).get(key);

/** Records what's sent to Rust's open_url. */
function opened() {
  const urls: unknown[] = [];
  mockCommands((cmd, args) => {
    if (cmd === "open_url") urls.push(arg(args, "url"));
  });
  return urls;
}

describe("CommentHtml", () => {
  it("shows GitHub's HTML cleaned of anything unsafe", () => {
    const { container } = render(
      <CommentHtml html="<p>Looks <b>good</b></p><script>alert(1)</script>" className="extra" />,
    );
    expect(screen.getByText("good").tagName).toBe("B");
    expect(container.querySelector("script")).toBeNull();
    expect(container.firstElementChild).toHaveProperty("className", expect.stringContaining("extra"));
  });

  it("opens a link in the browser", async () => {
    const urls = opened();
    render(<CommentHtml html='<p>See <a href="https://github.com/acme/app/pull/1">the PR</a></p>' />);
    await userEvent.click(screen.getByText("the PR"));
    expect(urls).toEqual(["https://github.com/acme/app/pull/1"]);
  });

  it("opens a picture in the viewer, even one linked to itself", async () => {
    const urls = opened();
    render(
      <>
        <CommentHtml html={`<a href="${PICTURE}"><img src="${PICTURE}" alt="Screenshot"></a>`} />
        <Viewer />
      </>,
    );
    await userEvent.click(screen.getByRole("img", { name: "Screenshot" }));
    expect(screen.getByRole("dialog", { name: "Screenshot" })).toBeTruthy();
    expect(urls).toEqual([]);
  });

  it("follows a picture's link when it leads to a page", async () => {
    const urls = opened();
    render(<CommentHtml html={`<a href="https://example.com/docs"><img src="${PICTURE}" alt="Badge"></a>`} />);
    await userEvent.click(screen.getByRole("img", { name: "Badge" }));
    expect(urls).toEqual(["https://example.com/docs"]);
  });

  it("does nothing for a click on plain text", async () => {
    const urls = opened();
    render(<CommentHtml html="<p>Just words</p>" />);
    await userEvent.click(screen.getByText("Just words"));
    expect(urls).toEqual([]);
  });
});

describe("openClicked", () => {
  it("ignores a click whose target isn't an element", () => {
    const preventDefault = vi.fn<() => void>();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the two fields it reads.
    openClicked({ target: document, preventDefault } as unknown as MouseEvent);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
