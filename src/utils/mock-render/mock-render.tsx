// Tests only. The React Compiler keeps each part of a component until what it's made from changes;
// rendering again with the same props takes those kept parts, so a test that renders twice runs
// both ways (and shows nothing changed when nothing did). `make` builds the same element each
// time: its props must be values the test holds, not new ones made inline. `again` renders it once
// more, for what shows only after something arrives.

import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

export function renderTwice(make: () => ReactElement, options?: RenderOptions): RenderResult & { again: () => void } {
  const result = render(make(), options);
  result.rerender(make());
  return {
    ...result,
    again: () => {
      result.rerender(make());
    },
  };
}

/** A promise that settles when the test says, for what's shown while something's under way. */
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

/** The same value, as a new array, object or function where it's one (a function's copy calls it). */
function copy(value: unknown): unknown {
  if (Array.isArray(value)) return Array.from<unknown>(value);
  if (typeof value === "function") return (...args: unknown[]): unknown => Reflect.apply(value, undefined, args);
  if (value && typeof value === "object") return { ...value };
  return value;
}

/** Renders `make` again once per prop, each time with one more prop swapped for a copy of itself:
 *  the kept parts that don't depend on it are used, the rest made again. What shows should never
 *  change; the HTML after each step comes back for the test to check that. */
export function rerenderCopies<P extends object>(
  result: Pick<RenderResult, "rerender" | "container">,
  make: (props: P) => ReactElement,
  props: P,
): string[] {
  const current = new Map<string, unknown>(Object.entries(props));
  const shown: string[] = [];
  for (const [key, value] of current) {
    current.set(key, copy(value));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the same props, each a copy of what it was.
    result.rerender(make(Object.fromEntries(current) as P));
    shown.push(result.container.innerHTML);
  }
  return shown;
}
