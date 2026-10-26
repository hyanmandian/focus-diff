// The options page: the Mac app's Settings window, with what a browser can't do left out.
import { expect, expectSoundPage, PAGE_VIEWS, test } from "./fixtures";
import { fakeGitHub, ME } from "./github";

test.describe("Settings", () => {
  test("shows who's signed in, and disconnects", async ({ context, openExtensionPage, signIn, background }) => {
    await fakeGitHub(context);
    const settings = await openExtensionPage("options.html");
    await signIn(settings);
    await settings.reload();
    const sidebar = settings.getByRole("tablist", { name: "Settings" });
    await sidebar.getByRole("tab", { name: new RegExp(ME, "u") }).click();
    await expect(settings.getByText(/Your token stays in this browser/u)).toBeVisible();
    await expect(settings.getByText("Attachments")).toHaveCount(0);
    await settings.getByRole("button", { name: /Disconnect/u }).click();
    await expect(sidebar.getByRole("tab", { name: /Not signed in/u })).toBeVisible();
    expect(await background.evaluate(() => chrome.storage.local.get("auth"))).toEqual({});
  });

  test("has no AI pane, names the version without an update check, and keeps a change", async ({
    openExtensionPage,
    background,
  }) => {
    const settings = await openExtensionPage("options.html");
    const sidebar = settings.getByRole("tablist", { name: "Settings" });
    await expect(sidebar.getByRole("tab", { name: /Queues/u })).toBeVisible();
    await expect(sidebar.getByRole("tab", { name: /AI/u })).toHaveCount(0);

    await sidebar.getByRole("tab", { name: /General/u }).click();
    await expect(settings.getByText("Your browser keeps it up to date from its extension store.")).toBeVisible();
    await expect(settings.getByRole("button", { name: /Check for Updates/u })).toHaveCount(0);
    await settings.getByRole("combobox", { name: "Appearance" }).click();
    await settings.getByRole("option", { name: "Dark" }).click();
    await expect(settings.locator("html")).toHaveClass(/dark/u);
    await expect
      .poll(async () => {
        const stored = await background.evaluate(() => chrome.storage.local.get("file.config"));
        const text = stored["file.config"];
        return typeof text === "string" ? (JSON.parse(text) as { theme?: string }).theme : null;
      })
      .toBe("dark");
  });

  test("offers no commands in an action's steps", async ({ openExtensionPage }) => {
    const settings = await openExtensionPage("options.html");
    await settings
      .getByRole("tablist", { name: "Settings" })
      .getByRole("tab", { name: /Actions/u })
      .click();
    await settings.getByRole("button", { name: "Add an action" }).click();
    await settings.getByRole("button", { name: "Add Step" }).click();
    await expect(settings.getByRole("menuitem", { name: /^Comment/u })).toBeVisible();
    await expect(settings.getByRole("menuitem", { name: /^Run a command/u })).toHaveCount(0);
  });

  for (const view of PAGE_VIEWS) {
    test(`passes an accessibility check (${view.join(", ")})`, async ({ openExtensionPage, pageErrors }) => {
      const settings = await openExtensionPage("options.html");
      await expectSoundPage(settings, view, settings.getByRole("tablist", { name: "Settings" }));
      expect(pageErrors).toEqual([]);
    });
  }
});
