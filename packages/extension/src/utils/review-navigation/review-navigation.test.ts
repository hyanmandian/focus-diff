// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Panel } from "@/components/panel/panel";
import type { ConversationTarget, Provider } from "@/utils/provider/provider";
import type { FileInfo } from "@/utils/review-files/review-files";
import { flash, scrollToCenter, scrollToTop } from "@/utils/scroll/scroll";

import { createNavigation, goToFile } from "./review-navigation";

vi.mock(import("@/utils/scroll/scroll"), async (original) => ({
  ...(await original()),
  flash: vi.fn<() => void>(),
  scrollToCenter: vi.fn<() => void>(),
  scrollToTop: vi.fn<() => void>(),
}));

const info = (path: string, anchor = "", element?: HTMLElement): FileInfo => ({
  path,
  anchor,
  stats: null,
  viewed: false,
  threads: [],
  diff: element ? { element, container: element.parentElement ?? element } : null,
});

const drawnDiff = () => {
  const container = document.createElement("section");
  const element = document.createElement("div");
  container.append(element);
  document.body.append(container);
  return element;
};

let targets: ReturnType<typeof target>[] = [];
const provider = {
  coveredTop: vi.fn<Provider["coveredTop"]>(() => 60),
  reveal: vi.fn<Provider["reveal"]>(),
  diffAt: vi.fn<Provider["diffAt"]>((anchor) => (anchor === "drawn" ? document.body : null)),
  conversations: vi.fn<Provider["conversations"]>(() => targets),
};
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- navigation only uses these parts of the site.
const site = provider as unknown as Provider;
const panel = { accent: () => "teal", announceText: vi.fn<Panel["announceText"]>() };
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- navigation only uses these parts of the panel.
const bar = panel as unknown as Panel;

const target = (path: string, centre: number | null, found: HTMLElement | null = document.createElement("p")) => {
  const element = centre === null ? null : document.createElement("div");
  if (element) element.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: centre! - 10, width: 1, height: 20 });
  return {
    file: info(path),
    line: 3,
    state: "waiting" as const,
    element,
    open: vi.fn<ConversationTarget["open"]>(() => Promise.resolve(found)),
  };
};

beforeEach(() => {
  targets = [];
  document.body.replaceChildren();
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("scrollY", 0);
});

describe("goToFile", () => {
  it("brings a drawn file to the top, below what the site covers", async () => {
    const element = drawnDiff();
    await expect(goToFile(site, info("a.ts", "x", element))).resolves.toBe(element);
    expect(scrollToTop).toHaveBeenCalledWith(element.parentElement, expect.any(Function));
    const [, covered] = vi.mocked(scrollToTop).mock.calls.at(-1)!;
    expect(covered()).toBe(60);
  });

  it("asks the site to draw a file it hasn't, and waits for it", async () => {
    await expect(goToFile(site, info("a.ts", "drawn", document.createElement("div")))).resolves.toBe(document.body);
    expect(provider.reveal).toHaveBeenCalledWith("drawn");
  });

  it("can't go to a file the site has no anchor for", async () => {
    await expect(goToFile(site, info("a.ts"))).resolves.toBeNull();
    expect(provider.reveal).not.toHaveBeenCalled();
  });
});

describe("createNavigation", () => {
  it("does nothing without conversations", async () => {
    const schedule = vi.fn<() => void>();
    const navigation = createNavigation(site, bar, schedule);
    await navigation.comment([], true, 1);
    await navigation.comment([], false, -1);
    expect(schedule).not.toHaveBeenCalled();
    expect(navigation.position([], true)).toEqual({ current: 0, list: [] });
  });

  it("steps through the site's conversations in order, centring and lighting up each, and reads out where it is", async () => {
    const found = document.createElement("p");
    targets = [target("a.ts", 100, found), target("b.ts", 200)];
    const schedule = vi.fn<() => void>();
    const navigation = createNavigation(site, bar, schedule);
    await navigation.comment([], true, 1);
    expect(targets[0]!.open).toHaveBeenCalledOnce();
    expect(scrollToCenter).toHaveBeenCalledWith(found, expect.any(Function));
    const [, covered] = vi.mocked(scrollToCenter).mock.calls.at(-1)!;
    expect(covered()).toBe(60);
    expect(provider.coveredTop).toHaveBeenLastCalledWith(found);
    expect(flash).toHaveBeenCalledWith(found, "teal");
    expect(panel.announceText).toHaveBeenLastCalledWith("Conversation 1 of 2, in a.ts.");
    expect(schedule).toHaveBeenCalledOnce();
    expect(navigation.position([], true)).toEqual({
      current: 1,
      list: [
        { path: "a.ts", line: 3, state: "waiting" },
        { path: "b.ts", line: 3, state: "waiting" },
      ],
    });
    expect(navigation.count([], true)).toBe(2);

    await navigation.comment([], true, 1);
    await navigation.comment([], true, 1);
    expect(panel.announceText).toHaveBeenLastCalledWith("Conversation 1 of 2, in a.ts.");
    navigation.reset();
    await navigation.comment([], true, -1);
    expect(panel.announceText).toHaveBeenLastCalledWith("Conversation 2 of 2, in b.ts.");
  });

  it("opens files for conversations through the site", async () => {
    targets = [target("a.ts", null)];
    await createNavigation(site, bar, vi.fn<() => void>()).comment([], true, 1);
    const [{ goToFile: open }] = targets[0]!.open.mock.calls[0]!;
    await expect(open(info("c.ts"))).resolves.toBeNull();
  });

  it("still reads out a conversation it couldn't bring into view", async () => {
    vi.mocked(scrollToCenter).mockClear();
    targets = [target("a.ts", null, null)];
    await createNavigation(site, bar, vi.fn<() => void>()).comment([], true, 1);
    expect(scrollToCenter).not.toHaveBeenCalled();
    expect(panel.announceText).toHaveBeenLastCalledWith("Conversation 1 of 1, in a.ts.");
  });

  it("lets a jump still waiting on the site give way to a newer selection", async () => {
    let land = (_found: HTMLElement | null) => {};
    const slow = target("a.ts", null);
    slow.open.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    targets = [slow];
    const schedule = vi.fn<() => void>();
    const navigation = createNavigation(site, bar, schedule);
    const jumping = navigation.comment([], true, 1);
    const [{ stale }] = slow.open.mock.calls[0]!;
    expect(stale()).toBe(false);
    navigation.reset();
    expect(stale()).toBe(true);
    land(document.createElement("p"));
    await jumping;
    expect(schedule).not.toHaveBeenCalled();
  });

  it("starts over when the list gets shorter than where it was", async () => {
    targets = [target("a.ts", 100), target("b.ts", 200)];
    const navigation = createNavigation(site, bar, vi.fn<() => void>());
    await navigation.comment([], true, -1);
    targets = [target("a.ts", 100)];
    expect(navigation.position([], true).current).toBe(0);
  });

  it("from the page, starts at either end at the top, and later goes from the middle of the screen", async () => {
    targets = [target("a.ts", 100), target("b.ts", 400), target("c.ts", 700), target("d.ts", null)];
    const navigation = createNavigation(site, bar, vi.fn<() => void>());
    await navigation.comment([], false, -1);
    expect(panel.announceText).toHaveBeenLastCalledWith("Conversation 4 of 4, in d.ts.");
    navigation.reset();
    await navigation.comment([], false, 1);
    expect(panel.announceText).toHaveBeenLastCalledWith("Conversation 1 of 4, in a.ts.");

    vi.stubGlobal("scrollY", 500);
    await navigation.comment([], false, 1);
    expect(panel.announceText).toHaveBeenLastCalledWith("Conversation 3 of 4, in c.ts.");
    await navigation.comment([], false, -1);
    expect(panel.announceText).toHaveBeenLastCalledWith("Conversation 4 of 4, in d.ts.");

    targets = [target("a.ts", 400)];
    await navigation.comment([], false, 1);
    expect(panel.announceText).toHaveBeenLastCalledWith("Conversation 1 of 1, in a.ts.");
    await navigation.comment([], false, -1);
    expect(panel.announceText).toHaveBeenLastCalledWith("Conversation 1 of 1, in a.ts.");
  });
});
