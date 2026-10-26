// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import { $, reveal, templateElement, translate, translateDocument } from "./extension-page";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("$", () => {
  it("finds an element, in the document or under a root", () => {
    document.body.innerHTML = `<main><p class="note">Hi</p></main><aside><p class="note">There</p></aside>`;
    expect($(".note").textContent).toBe("Hi");
    expect($(".note", $("aside")).textContent).toBe("There");
  });

  it("says which element is missing", () => {
    expect(() => $("#nothing")).toThrow("Missing element: #nothing");
  });
});

describe("templateElement", () => {
  it("copies the element its template holds, each time anew", () => {
    document.body.innerHTML = `<template id="row"><li class="row"><span>File</span></li></template>`;
    const first = templateElement<HTMLLIElement>("row");
    const second = templateElement<HTMLLIElement>("row");
    expect(first.outerHTML).toBe(`<li class="row"><span>File</span></li>`);
    expect(first).not.toBe(second);
  });
});

describe("translate", () => {
  it("fills text, rich text, placeholders and labels in the reader's language, keeping unknown keys", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <h1 data-i18n="extensionName">x</h1>
      <p data-i18n="noSuchMessage">x</p>
      <p class="rich" data-i18n-html="helpTestFolders">x</p>
      <p class="bold" data-i18n-html="helpAll">x</p>
      <input data-i18n-placeholder="commandNext">
      <button data-i18n-label="actionTitle"></button>
      <p data-i18n="" class="empty">x</p>`;
    expect(translate(root)).toBe(root);
    expect($("h1", root).textContent).toBe("Focus Diff");
    expect($("[data-i18n=noSuchMessage]", root).textContent).toBe("noSuchMessage");
    expect($(".rich", root).innerHTML).toBe("any <code>test/</code> or <code>tests/</code> folder");
    expect($(".bold", root).innerHTML).toBe("<b>All</b> is always available and shows every file.");
    expect($<HTMLInputElement>("input", root).placeholder).toBe("Next filter");
    expect($("button", root).getAttribute("aria-label")).toBe("Focus Diff: your pull requests");
    expect($(".empty", root).textContent).toBe("");
  });
});

describe("translateDocument", () => {
  it("sets the page's language and title, and translates its body", () => {
    document.body.innerHTML = `<h1 data-i18n="extensionName"></h1>`;
    translateDocument("Settings");
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.title).toBe("Settings");
    expect($("h1").textContent).toBe("Focus Diff");
  });
});

describe("reveal", () => {
  it("shows a page held back until its first render", () => {
    document.documentElement.classList.add("pending");
    reveal();
    expect(document.documentElement.classList.contains("pending")).toBe(false);
  });
});
