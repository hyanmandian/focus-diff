// The Settings window, on the sample configuration (src/utils/mock/mock.ts): four queues, two actions.

import { expect, test, type Page } from "@playwright/test";

import { recordCalls, savedConfig } from "./ipc";

/** Opens a pane from the sidebar and checks it's the one showing. */
async function showPane(page: Page, name: string) {
  const tab = page.getByRole("tablist", { name: "Settings" }).getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name }).getByRole("heading", { level: 1 })).toHaveText(name);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/settings.html");
  await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible();
  await recordCalls(page);
});

test("opens on Queues and moves between the panes", async ({ page }) => {
  await expect(page.getByRole("tab", { name: "Queues" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Queues" }).getByRole("heading", { level: 1 })).toHaveText("Queues");

  await showPane(page, "Review time");
  await showPane(page, "Filters");
  await showPane(page, "Actions");
  await showPane(page, "AI");
  await showPane(page, "General");
  await showPane(page, "Queues");
});

test("edits a queue: what it takes in, where you come in and its search terms", async ({ page }) => {
  await page.getByRole("button", { name: /^Updates/u }).click();
  await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();

  const prs = page.getByRole("group", { name: "Pull requests" });
  await expect(prs.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
  // Merged ones ask how far back, and leave out the kinds that only fit open ones.
  await prs.getByRole("button", { name: "Merged lately" }).click();
  await expect(prs.getByRole("button", { name: "Merged lately" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Days" })).toBeVisible();
  await page.getByRole("combobox", { name: "Where I come in" }).click();
  await expect(page.getByRole("option", { name: "I opened them" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await prs.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("combobox", { name: "Days" })).toBeHidden();
  await page.getByRole("combobox", { name: "Where I come in" }).click();
  await page.getByRole("option", { name: "I opened them" }).click();
  await expect(page.getByRole("combobox", { name: "Where I come in" })).toHaveText(/I opened them/u);

  await page.getByRole("textbox", { name: "GitHub search terms" }).fill("label:urgent");

  await expect
    .poll(() => savedConfig(page))
    .toMatchObject({
      queues: [
        { id: "review" },
        { id: "updates", kind: "authored", query: "label:urgent" },
        { id: "mine" },
        { id: "merged" },
      ],
    });

  await page.getByRole("button", { name: "Back to Queues" }).click();
  await expect(page.getByRole("button", { name: "Updates My open pull requests · label:urgent" })).toBeVisible();
});

test("switches a queue off the panel from the list", async ({ page }) => {
  const show = page.getByRole("switch", { name: "Show Merged in the panel" });
  await expect(show).toBeChecked();
  await show.click();
  await expect(show).not.toBeChecked();
  await expect
    .poll(() => savedConfig(page))
    .toMatchObject({ queues: [{ id: "review" }, { id: "updates" }, { id: "mine" }, { id: "merged", enabled: false }] });
});

test("adds an action as a menu with choices, each with its steps", async ({ page }) => {
  await page.getByRole("tab", { name: "Actions" }).click();
  await page.getByRole("button", { name: "Add an action" }).click();

  await page.getByRole("textbox", { name: "Button" }).fill("Delegate");
  await expect(page.getByRole("heading", { name: "Delegate", level: 1 })).toBeVisible();
  const showsAs = page.getByRole("group", { name: "Shows as" });
  await showsAs.getByRole("button", { name: "Menu" }).click();
  await expect(showsAs.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-pressed", "true");

  // The first choice, named, with a comment after the command it starts with.
  await page.getByRole("textbox", { name: "Name" }).fill("Dana");
  await expect(page.getByRole("heading", { name: "Dana", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Add Step" }).click();
  const steps = page.getByRole("menu", { name: "Add Step" });
  await steps.getByRole("menuitem", { name: /^Comment/u }).click();
  await page.getByRole("textbox", { name: "Comment" }).fill("@dana could you take this one?");
  await expect(page.getByRole("button", { name: "Remove step 2" })).toBeVisible();

  // A second choice.
  await page.getByRole("button", { name: "Add Choice" }).click();
  await expect(page.getByRole("heading", { name: "Choice 2", level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Back to Actions" }).click();
  await expect(page.getByRole("button", { name: "Delegate Menu: Dana, Choice 2" })).toBeVisible();

  await expect
    .poll(() => savedConfig(page))
    .toMatchObject({
      actions: [
        { name: "Hand off to Dana" },
        { name: "Ask the team" },
        {
          name: "Delegate",
          choices: [
            { name: "Dana", steps: [{ kind: "run" }, { kind: "comment", body: "@dana could you take this one?" }] },
            { name: "Choice 2" },
          ],
        },
      ],
    });
});

test("asks before removing an action, and keeps it when told no", async ({ page }) => {
  await page.getByRole("tab", { name: "Actions" }).click();
  await page.getByRole("button", { name: /^Ask the team/u }).click();

  // The sample's confirm is the browser's own.
  const asked: string[] = [];
  page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByRole("button", { name: "Delete Ask the team" }).click();
  await expect.poll(() => asked).toEqual([expect.stringContaining("Remove the “Ask the team” action?")]);
  await expect(page.getByRole("heading", { name: "Ask the team", level: 1 })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete Ask the team" }).click();
  await expect(page.getByRole("heading", { name: "Actions", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Ask the team/u })).toBeHidden();
  await expect(page.getByRole("button", { name: /^Hand off to Dana/u })).toBeVisible();
});

test("asks before removing a queue", async ({ page }) => {
  await page.getByRole("button", { name: /^Merged/u }).click();
  const asked: string[] = [];
  page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Delete Merged" }).click();
  await expect.poll(() => asked).toHaveLength(1);
  await expect(page.getByRole("heading", { name: "Queues", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Merged/u })).toBeHidden();
});
