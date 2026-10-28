import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { OpenLink, openLink } from "@/components/open-link/open-link";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { i18n } from "@/utils/i18n/i18n";

function github(data: unknown) {
  mockCommands((cmd) => {
    if (cmd !== "github") return null;
    if (data instanceof Error) throw data;
    return { status: 200, body: JSON.stringify({ data }) };
  });
}

describe("openLink", () => {
  it("says why a link couldn't be opened", async () => {
    const t = i18n();
    expect(await openLink("nope", t)).toBe("That isn't a pull request's link on GitHub.");
    github({ repository: null });
    expect(await openLink("https://github.com/acme/web/pull/1", t)).toBe(
      "GitHub has no pull request there, or none you can see.",
    );
    github(new Error("offline"));
    expect(await openLink("https://github.com/acme/web/pull/1", t)).toContain("offline");
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- as the app's commands refuse
    mockCommands((cmd) => (cmd === "github" ? Promise.reject("down") : null));
    expect(await openLink("https://github.com/acme/web/pull/1", t)).toContain("down");
  });
});

describe("OpenLink", () => {
  it("shows a link that couldn't be opened and why, and lets it be fixed", async () => {
    github({ repository: { pullRequest: { id: "PR_1", number: 1, title: "One", author: null } } });
    const onClose = vi.fn<() => void>();
    render(<OpenLink onClose={onClose} initial={{ text: "github.com/acme/web/pulls", error: "Not one" }} />);
    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Pull request link" });
    expect(field.value).toBe("github.com/acme/web/pulls");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Not one");
    await userEvent.clear(field);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Open" }).disabled).toBe(true);
    await userEvent.type(field, "github.com/acme/web/pull/1");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
