// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  bellIcon,
  breakdownIcon,
  checkIcon,
  chevronIcon,
  clockIcon,
  closeIcon,
  commentIcon,
  diffIcon,
  doneIcon,
  externalIcon,
  fileIcon,
  infoIcon,
  moreIcon,
  nextFileIcon,
  playIcon,
  pullRequestIcon,
  settingsIcon,
  targetIcon,
  threadStateIcons,
  undoIcon,
} from "./icons";

describe("icons", () => {
  it("draws every icon as a hidden SVG", () => {
    const drawn = [
      settingsIcon(),
      breakdownIcon(),
      infoIcon(),
      doneIcon(),
      fileIcon(),
      diffIcon(),
      clockIcon(),
      checkIcon(),
      bellIcon(),
      externalIcon(),
      pullRequestIcon(),
      playIcon(),
      undoIcon(),
      commentIcon(),
      targetIcon(),
      nextFileIcon(),
      closeIcon(),
      moreIcon(),
      ...Object.values(threadStateIcons).map((draw) => draw()),
    ];
    for (const svg of drawn) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.children.length).toBeGreaterThan(0);
    }
  });

  it("points a chevron either way", () => {
    const path = (svg: SVGSVGElement) => svg.querySelector("path")?.getAttribute("d");
    expect(path(chevronIcon("left"))).toBe("M10 4.5 6.5 8 10 11.5");
    expect(path(chevronIcon("right"))).toBe("M6 4.5 9.5 8 6 11.5");
  });
});
