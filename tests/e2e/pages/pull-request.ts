import type { Locator, Page } from '@playwright/test';

/** The fixture pull request page with the Focus Diff panel on top of it. */
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
    this.panel = page.locator('focus-diff-panel');
    this.options = this.panel.locator('.option');
    this.pressed = this.panel.locator('.option[aria-pressed="true"]');
    this.stats = this.panel.locator('.stats');
    this.status = this.panel.locator('[role="status"]');
    this.settings = this.panel.locator('.settings');
    this.breakdownToggle = this.panel.locator('.breakdown-toggle');
    this.breakdownRows = this.panel.locator('.row');
  }

  option(name: string) {
    return this.panel.locator('.option', { hasText: new RegExp(`^${name}$`) });
  }

  async pick(name: string, { combine = false } = {}) {
    await this.option(name).click({ modifiers: combine ? ['Shift'] : [] });
  }

  async statsText() {
    return this.stats.evaluate((element) => {
      const copy = element.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.ghost').forEach((ghost) => ghost.remove());
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    });
  }

  visiblePaths() {
    return this.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[role="region"][id^="diff-"]:not([id$="-hunk"])')]
        .filter((region) => region.offsetParent !== null)
        .map((region) => (document.getElementById(region.getAttribute('aria-labelledby') ?? '')?.textContent ?? '').replace(/‎/g, '')),
    );
  }

  visibleTreeFiles() {
    return this.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-expanded])')]
        .filter((item) => item.offsetParent !== null)
        .map((item) => (item.textContent ?? '').trim()),
    );
  }

  filesCounter() {
    return this.page.locator('[aria-current="page"] .Counter');
  }

  lineCounters() {
    return { additions: this.page.locator('.summary span').first(), deletions: this.page.locator('.summary span').last() };
  }
}
