import type { Locator, Page } from "@playwright/test";

/** The fixture pull request page with Focus Diff's bar (the app's filter bar) floating over it. */
export class PullRequestPage {
  readonly bar: Locator;
  readonly group: Locator;
  readonly chips: Locator;
  readonly pressed: Locator;
  readonly next: Locator;
  readonly breakdownToggle: Locator;
  readonly breakdown: Locator;

  constructor(readonly page: Page) {
    this.bar = page.locator("focus-diff-bar");
    this.group = this.bar.getByRole("group", { name: "Review one part" });
    this.chips = this.group.locator("button[aria-pressed]");
    this.pressed = this.group.locator('button[aria-pressed="true"]');
    this.next = this.group.locator('button[aria-keyshortcuts="Alt+Shift+J"]');
    this.breakdownToggle = this.group.getByRole("button", { name: "Breakdown by filter" });
    this.breakdown = this.bar.getByRole("dialog");
  }

  /** A filter's chip, by its name. */
  chip(name: string) {
    return this.chips.filter({ hasText: new RegExp(`^${name}\\d+$`, "u") });
  }

  /** The chips' names, or the pressed ones', without their counts. */
  names(chips: Locator = this.chips) {
    return chips.evaluateAll((all) => all.map((chip) => chip.firstChild?.textContent ?? ""));
  }

  /** Shows only `name`, or adds it to the chosen filters with `combine`. */
  async pick(name: string, { combine = false } = {}) {
    if (!combine && name !== "All") await this.chip("All").click();
    await this.chip(name).click();
  }

  /** What the bar says is left: files, lines and time, as read out. */
  stats() {
    return this.group.locator("[aria-label]:not(button)").evaluateAll((all) => all.map((each) => each.ariaLabel ?? ""));
  }

  visiblePaths() {
    return this.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[role="region"][id^="diff-"]:not([id$="-hunk"])')]
        .filter((region) => region.offsetParent !== null)
        .map((region) => {
          const label = region.getAttribute("aria-labelledby");
          return ((label ? document.querySelector(`#${CSS.escape(label)}`) : null)?.textContent ?? "").replaceAll(
            "‎",
            "",
          );
        }),
    );
  }

  visibleTreeFiles() {
    return this.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-expanded])')]
        .filter((item) => item.offsetParent !== null)
        .map((item) => (item.textContent ?? "").trim()),
    );
  }

  filesCounter() {
    return this.page.locator('[aria-current="page"] .Counter').locator("visible=true");
  }

  lineCounters() {
    const shown = this.page.locator(".summary span").locator("visible=true");
    return { additions: shown.first(), deletions: shown.last() };
  }

  viewedToggle(path: string) {
    return this.page.locator("[data-diff-header-wrapper]", { hasText: path }).getByRole("button", { name: "Viewed" });
  }

  /** Where a file's header is on screen. */
  top(path: string) {
    return this.page
      .locator("[data-diff-header-wrapper]", { hasText: path })
      .evaluate((header) => Math.round(header.getBoundingClientRect().top));
  }
}
