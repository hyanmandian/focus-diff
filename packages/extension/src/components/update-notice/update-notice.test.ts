// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { createUpdateNotice } from "./update-notice";

const mount = () => {
  const host = document.createElement("div");
  const fallback = document.createElement("button");
  const onSeen = vi.fn<() => void>();
  const notice = createUpdateNotice(
    {
      host,
      signal: new AbortController().signal,
      focused: () => (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    },
    { onSeen, fallback },
  );
  document.body.append(notice.element, fallback);
  const link = notice.element.querySelector<HTMLAnchorElement>(".update-link")!;
  const dismiss = notice.element.querySelector<HTMLButtonElement>(".update-dismiss")!;
  return { ...notice, fallback, onSeen, link, dismiss };
};

describe("createUpdateNotice", () => {
  it("is hidden until there's a version to show", () => {
    const { element } = mount();
    expect(element.hidden).toBe(true);
  });

  it("names the minor version and links to its release notes", () => {
    const { element, show, link } = mount();
    show("1.2.3");
    expect(element.hidden).toBe(false);
    expect(link.textContent).toBe("New in 1.2");
    expect(link.href).toBe("https://github.com/hyanmandian/focus-diff/releases/tag/v1.2.3");
  });

  it("is seen once opened or dismissed", () => {
    const { show, link, dismiss, onSeen } = mount();
    show("1.2.0");
    link.addEventListener("click", (event) => {
      event.preventDefault();
    });
    link.click();
    dismiss.click();
    expect(onSeen).toHaveBeenCalledTimes(2);
  });

  it("hides again, sending focus inside it to the fallback", () => {
    const { element, show, dismiss, fallback } = mount();
    show("1.2.0");
    dismiss.focus();
    show(null);
    expect(element.hidden).toBe(true);
    expect(document.activeElement).toBe(fallback);
  });

  it("leaves focus elsewhere where it is", () => {
    const { show } = mount();
    const other = document.createElement("button");
    document.body.append(other);
    show("1.2.0");
    other.focus();
    show(null);
    expect(document.activeElement).toBe(other);
  });
});
