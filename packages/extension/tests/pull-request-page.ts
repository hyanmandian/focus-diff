import type { Locator, Page } from "@playwright/test";

export class PullRequestPage {
  readonly panel: Locator;
  readonly options: Locator;
  readonly pressed: Locator;
  readonly stats: Locator;
  readonly status: Locator;
  readonly settings: Locator;
  readonly breakdownToggle: Locator;
  readonly breakdownRows: Locator;

  constructor(readonly page: Page) {
    this.panel = page.locator("focus-diff-panel");
    this.options = this.panel.locator(".option .option-name");
    this.pressed = this.panel.locator('.option[aria-pressed="true"] .option-name');
    this.stats = this.panel.locator(".stats");
    this.status = this.panel.locator('[role="status"]');
    this.settings = this.panel.locator(".settings");
    this.breakdownToggle = this.panel.locator(".breakdown-toggle");
    this.breakdownRows = this.panel.locator(".row");
  }

  option(name: string) {
    return this.panel.locator(`.option:has(.option-name:text-is("${name}"))`);
  }

  async pick(name: string, { combine = false } = {}) {
    if (!combine && name !== "All") await this.option("All").click();
    await this.option(name).click();
  }

  statsText() {
    return this.stats.evaluate((element) => {
      const hidden = [...element.querySelectorAll("*")].map((child) => {
        const style = getComputedStyle(child);
        return (
          style.display === "none" || style.visibility === "hidden" || child.getAttribute("aria-hidden") === "true"
        );
      });
      const copy = element.cloneNode(true) as HTMLElement;
      [...copy.querySelectorAll("*")].forEach((child, index) => {
        if (hidden[index]) child.remove();
      });
      return (copy.textContent ?? "").replaceAll(/\s+/gu, " ").trim();
    });
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
}
