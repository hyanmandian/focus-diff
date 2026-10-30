import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState, type ComponentProps, type ReactNode } from "react";
import { expect, vi } from "vite-plus/test";

import type { ThreadView } from "@/components/thread/thread";

export function later() {
  const settle: Array<() => void> = [];
  const promise = new Promise<void>((resolve) => {
    settle.push(resolve);
  });
  return {
    promise,
    settle: () => {
      settle[0]!();
    },
  };
}

const nothing = () => {};

export function deferred<T = void>() {
  let resolve: (value: T) => void = nothing;
  let reject: (reason: unknown) => void = nothing;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function renderEditing<T>(
  initial: T,
  draw: (value: T, onChange: (next: T) => void) => ReactNode,
  { strict = false, changes = vi.fn<(next: T) => void>() } = {},
) {
  function Harness() {
    const [value, setValue] = useState(initial);
    return draw(value, (next) => {
      changes(next);
      setValue(next);
    });
  }
  render(<Harness />, strict ? { wrapper: StrictMode } : {});
  const last = () => changes.mock.lastCall![0];
  return { user: userEvent.setup(), changes, last };
}

export function ThreadStub({ thread, moved, onReply, onResolve }: ComponentProps<typeof ThreadView>) {
  return (
    <div>
      <p>
        Conversation {thread.id}
        {moved ? " (moved)" : ""}
      </p>
      <button type="button" onClick={() => void onReply("Agreed")}>
        Reply to {thread.id}
      </button>
      <button type="button" onClick={() => void onResolve(true)}>
        Resolve {thread.id}
      </button>
    </div>
  );
}

const denied = () => {
  throw new Error("denied");
};

export function refuseStorage() {
  return {
    get: vi.spyOn(localStorage, "getItem").mockImplementation(denied),
    set: vi.spyOn(localStorage, "setItem").mockImplementation(denied),
  };
}

export async function typeRepository(user: ReturnType<typeof userEvent.setup>, repo: string) {
  const repos = screen.getByRole("textbox", { name: "Repositories" });
  await user.type(repos, "nope{Enter}");
  expect(screen.getByRole("alert").textContent).toContain("Use owner/name");
  await user.clear(repos);
  await user.type(repos, `${repo}{Enter}`);
}
