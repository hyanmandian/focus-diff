// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { createConversations, type Conversation } from "./conversations";

const LIST: Conversation[] = [
  { path: "src/app/main.ts", line: 1200, state: "waiting" },
  { path: "README.md", line: null, state: "resolved" },
  { path: "docs/guide.md", line: 3, state: "answered" },
];

const mount = () => {
  const host = document.createElement("div");
  const fallback = document.createElement("button");
  const onStep = vi.fn<(direction: 1 | -1) => void>();
  const onOpen = vi.fn<() => void>();
  const conversations = createConversations(
    {
      host,
      signal: new AbortController().signal,
      focused: () => (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    },
    { onStep, onOpen, fallback },
  );
  host.append(conversations.element, fallback);
  document.body.replaceChildren(host);
  const { popover } = conversations;
  const toggle = conversations.element.querySelector<HTMLButtonElement>(".comments")!;
  const text = (selector: string) => popover.querySelector(selector)?.textContent;
  const button = (selector: string) => popover.querySelector<HTMLButtonElement>(selector)!;
  return { ...conversations, host, fallback, onStep, onOpen, toggle, text, button };
};

describe("createConversations", () => {
  it("counts the conversations on its toggle, sized for the most there are", () => {
    const { render, toggle } = mount();
    render({ list: LIST, current: 0 }, 12);
    expect(toggle.querySelector(".option-count")?.textContent).toBe("3");
    expect(toggle.querySelector<HTMLElement>(".option-count")?.style.minWidth).toBe("calc(2ch + 12px)");
    expect(toggle.getAttribute("aria-label")).toBe("Conversations, 3 conversations");
    expect(toggle.dataset.tip).toBe("Conversations");
    expect(toggle.getAttribute("aria-disabled")).toBe("false");
    render({ list: LIST, current: 0 });
    expect(toggle.querySelector<HTMLElement>(".option-count")?.style.minWidth).toBe("calc(1ch + 12px)");
  });

  it("stays in place, disabled, without conversations", () => {
    const { render, toggle, isOpen, onOpen } = mount();
    render({ list: [], current: 0 });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.dataset.tip).toBe("No conversations in these files yet");
    expect(toggle.getAttribute("aria-label")).toBe("Conversations, No conversations in these files yet");
    toggle.click();
    expect(isOpen()).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("jumps to the first conversation as it opens, and shows where the reader is", () => {
    const { render, toggle, popover, onStep, onOpen, isOpen, text } = mount();
    render({ list: LIST, current: 0 });
    toggle.click();
    expect(isOpen()).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onStep).toHaveBeenCalledWith(1);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(text(".conversation-name")).toBe("main.ts");
    expect(text(".conversation-line")).toBe(":1,200");
    expect(popover.querySelector<HTMLElement>(".conversation-file")?.dataset.tip).toBe("src/app/main.ts");
    expect(text(".conversation-state")).toBe("Waiting on you");
    expect(popover.dataset.state).toBe("waiting");
    expect(text(".conversation-position")).toBe("1/3");
    render({ list: LIST, current: 2 });
    expect(text(".conversation-name")).toBe("README.md");
    expect(popover.querySelector(".conversation-line")).toBeNull();
    expect(text(".conversation-state")).toBe("Resolved");
    expect(text(".conversation-position")).toBe("2/3");
    render({ list: LIST, current: 3 });
    expect(text(".conversation-state")).toBe("Answered");
    const icon = popover.querySelector(".conversation-icon svg");
    render({ list: [...LIST, { path: "b.ts", line: 9, state: "answered" }], current: 3 });
    expect(popover.querySelector(".conversation-icon svg")).toBe(icon);
    toggle.click();
    expect(isOpen()).toBe(false);
  });

  it("doesn't jump again when reopened after a jump", () => {
    const { render, setOpen, onStep } = mount();
    render({ list: LIST, current: 2 });
    setOpen(true);
    setOpen(true);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("steps back and forth, or only goes to a single conversation", () => {
    const { render, setOpen, onStep, popover, button, fallback } = mount();
    render({ list: LIST, current: 1 });
    setOpen(true);
    expect(popover.hasAttribute("data-single")).toBe(false);
    button(".step:first-child").click();
    expect(onStep).toHaveBeenLastCalledWith(-1);
    button(".step:nth-child(2)").click();
    expect(onStep).toHaveBeenLastCalledWith(1);
    button(".step:nth-child(2)").focus();
    render({ list: LIST.slice(0, 1), current: 1 });
    expect(popover.hasAttribute("data-single")).toBe(true);
    expect(document.activeElement).toBe(button(".go-to"));
    button(".go-to").click();
    expect(onStep).toHaveBeenLastCalledWith(1);
    render({ list: LIST, current: 1 });
    expect(document.activeElement).toBe(button(".step:nth-child(2)"));
    fallback.focus();
    render({ list: LIST.slice(0, 1), current: 1 });
    expect(document.activeElement).toBe(fallback);
    render({ list: LIST, current: 1 });
    expect(popover.hasAttribute("data-single")).toBe(false);
  });

  it("closes when the conversations run out, giving focus back", () => {
    const { render, setOpen, isOpen, toggle, fallback, button } = mount();
    render({ list: LIST, current: 1 });
    setOpen(true);
    button(".step").focus();
    render({ list: [], current: 0 });
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle);
    render({ list: LIST, current: 1 });
    setOpen(true);
    button(".step").focus();
    toggle.hidden = true;
    setOpen(false);
    expect(document.activeElement).toBe(fallback);
  });

  it("opens empty without anything to show", () => {
    const { setOpen, text, onStep } = mount();
    setOpen(true);
    expect(onStep).toHaveBeenCalledWith(1);
    expect(text(".conversation-position")).toBe("");
  });
});
