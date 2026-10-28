// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import page from "@/entrypoints/options/index.html?raw";
import { normalizePopup } from "@/utils/inbox/inbox";
import { pageBody } from "@/utils/page-body/page-body";

import type { createPopupSettings as CreatePopupSettings } from "./options-popup-settings";

let createPopupSettings: typeof CreatePopupSettings;

const type = (input: HTMLInputElement, text: string) => {
  input.value = text;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
};

describe("createPopupSettings", () => {
  beforeEach(async () => {
    ({ createPopupSettings } = await import("./options-popup-settings"));
    document.body.innerHTML = pageBody(page);
  });

  it("shows the saved repositories, switches and lists, and gives back what the reader changed", () => {
    const onChange = vi.fn<() => void>();
    const popup = createPopupSettings({ onChange });
    popup.render(normalizePopup({ repos: ["acme/web"], excludeRepos: [], teams: false, merged: true }));
    const toggle = (id: string) => document.querySelector<HTMLInputElement>(`#popup-${id}`)!;
    expect([toggle("teams").checked, toggle("updates").checked, toggle("merged").checked]).toEqual([
      false,
      false,
      true,
    ]);
    expect(document.querySelector("#popup-repos")?.textContent).toContain("acme/web");

    for (const id of ["teams", "updates", "merged"]) {
      toggle(id).checked = !toggle(id).checked;
      toggle(id).dispatchEvent(new Event("change"));
    }
    type(document.querySelector<HTMLInputElement>("#popup-repos-only")!, "acme/api");
    type(document.querySelector<HTMLInputElement>("#popup-repos-never-list")!, "acme/old");

    expect(onChange).toHaveBeenCalledTimes(5);
    expect(popup.value()).toEqual({
      repos: ["acme/web", "acme/api"],
      excludeRepos: ["acme/old"],
      teams: true,
      updates: true,
      merged: false,
    });
    expect(popup.check()).toBe(true);
  });

  it("won't pass a repository that isn't one", () => {
    const popup = createPopupSettings({ onChange: vi.fn<() => void>() });
    popup.render(normalizePopup({}));
    document.querySelector<HTMLInputElement>("#popup-repos-only")!.value = "not a repo/";
    expect(popup.check()).toBe(false);
  });
});
