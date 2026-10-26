// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Provider } from "@/utils/provider/provider";
import type { FileInfo } from "@/utils/review-files/review-files";
import { scrollToTop } from "@/utils/scroll/scroll";

import { goToFile } from "./review-navigation";

vi.mock(import("@/utils/scroll/scroll"), async (original) => ({
  ...(await original()),
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

const provider = {
  coveredTop: vi.fn<Provider["coveredTop"]>(() => 60),
  reveal: vi.fn<Provider["reveal"]>(),
  diffAt: vi.fn<Provider["diffAt"]>((anchor) => (anchor === "drawn" ? document.body : null)),
};
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- navigation only uses these parts of the site.
const site = provider as unknown as Provider;
beforeEach(() => {
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
