import type { Locator, Page } from '@playwright/test';

/** The guided review in the Focus Diff panel: the bar's chapter navigation and the card above it. */
export class GuidePanel {
  readonly panel: Locator;
  readonly start: Locator;
  readonly card: Locator;
  readonly heading: Locator;
  readonly title: Locator;
  readonly primary: Locator;
  readonly doneDots: Locator;
  readonly exit: Locator;

  constructor(readonly page: Page) {
    this.panel = page.locator('focus-diff-panel');
    this.start = this.panel.locator('.guide-start');
    this.card = this.panel.locator('.guide-card');
    this.heading = this.card.locator('h2');
    this.title = this.panel.locator('.guide-title');
    this.primary = this.card.locator('.actions .primary');
    this.doneDots = this.panel.locator('.dot.done');
    this.exit = this.panel.getByRole('button', { name: 'Leave the guided review' });
  }

  text() {
    return this.card.evaluate((element) => (element as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
  }

  chapterItem(title: string) {
    return this.card.locator('.chapter-row', { hasText: title });
  }

  note(text: string) {
    return this.card.locator('.note', { hasText: text });
  }

  reviewedCheckbox() {
    return this.card.getByRole('checkbox', { name: 'Reviewed' });
  }
}
