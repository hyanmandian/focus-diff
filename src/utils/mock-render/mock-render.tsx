// Tests only. The React Compiler keeps each part of a component until what it's made from changes;
// rendering again with the same props takes those kept parts, so a test that renders twice runs
// both ways (and shows nothing changed when nothing did). `make` builds the same element each
// time: its props must be values the test holds, not new ones made inline.

import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

export function renderTwice(make: () => ReactElement, options?: RenderOptions): RenderResult {
  const result = render(make(), options);
  result.rerender(make());
  return result;
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
