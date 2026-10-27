import type { Target } from "@focus-diff/desktop/components/review";
import { DIRECTION } from "@focus-diff/desktop/hooks/use-next-in-queue";
import { screen } from "@testing-library/react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startCommandServer, type CommandServer } from "@/utils/command-server/command-server";
import { fakePorts } from "@/utils/fake-ports/fake-ports";
import { startPage } from "@/utils/start-page/start-page";

import { searchOf, startReview, targetOf } from "./review-page";

vi.mock("@focus-diff/desktop/components/review", () => ({
  Review: ({ target }: { target: Target }) => (
    <h1>
      {target.repo}#{target.number} {target.teams.join(" ")} {target.queue ?? "no queue"}
    </h1>
  ),
}));
vi.mock("@focus-diff/desktop/components/viewer", () => ({ Viewer: () => null }));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- no workers in a test: the review is a stand-in
const pool = null as never;
const settle = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      }),
  );

describe("a review in a tab", () => {
  let server: CommandServer;
  let root: Root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    fakePorts();
    server = startCommandServer({ read_file: () => null });
    history.replaceState(null, "", "/review.html");
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
  });

  const open = async (search = "") => {
    history.replaceState(null, "", `/review.html${search}`);
    root = startPage("review-1");
    await act(async () => {
      startReview(root, pool);
      await Promise.resolve();
    });
  };

  it("shows the pull request in its address, titled", async () => {
    await open("?id=PR_1&repo=acme%2Fweb&number=12&teams=acme%2Fa%2Cacme%2Fb&queue=q1&title=%2312+%C2%B7+Fix");
    expect(screen.getByRole("heading").textContent).toBe("acme/web#12 acme/a acme/b q1");
    expect(document.title).toBe("#12 · Fix");
  });

  it("reads an address with only an id, and none without one", () => {
    expect(targetOf("?id=PR_1")).toEqual({ id: "PR_1", repo: "", number: 0, teams: [], queue: null, title: "" });
    expect(targetOf("")).toBeNull();
    expect(searchOf({ id: "PR_1", repo: "acme/web", number: 1, teams: [] })).toBe(
      "?id=PR_1&repo=acme%2Fweb&number=1&teams=&queue=&title=",
    );
  });

  it("moves on to the pull request the background sends, keeping it in the address", async () => {
    await open();
    expect(screen.queryByRole("heading")).toBeNull();
    server.emitTo("review-1", "review-open", { id: "PR_2", repo: "acme/api", number: 3, teams: [], queue: null });
    await settle();
    expect(screen.getByRole("heading").textContent).toBe("acme/api#3  no queue");
    expect(location.search).toBe("?id=PR_2&repo=acme%2Fapi&number=3&teams=&queue=&title=");
  });

  it("slides the way it went through the queue, where the browser can", async () => {
    await open();
    const finished = Promise.withResolvers<null>();
    const transition = vi.fn<(update: () => void) => { finished: Promise<null> }>((update) => {
      update();
      return { finished: finished.promise };
    });
    Object.assign(document, { startViewTransition: transition });
    sessionStorage.setItem(DIRECTION, "forward");
    server.emitTo("review-1", "review-open", { id: "PR_2", repo: "acme/api", number: 3, teams: [], queue: "q" });
    await settle();
    expect(transition).toHaveBeenCalled();
    expect(document.documentElement.dataset.direction).toBe("forward");
    expect(screen.getByRole("heading").textContent).toBe("acme/api#3  q");
    finished.resolve(null);
    await settle();
    expect(document.documentElement.dataset.direction).toBeUndefined();
    // With Reduce Motion, it just shows.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the browser's answer, with only what's read
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    sessionStorage.setItem(DIRECTION, "back");
    server.emitTo("review-1", "review-open", { id: "PR_3", repo: "acme/api", number: 4, teams: [], queue: "q" });
    await settle();
    expect(transition).toHaveBeenCalledOnce();
    Reflect.deleteProperty(document, "startViewTransition");
  });
});
