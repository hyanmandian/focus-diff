import { LINES_PER_HOUR } from "@focus-diff/core/estimate";

/** How fast the reader reads a diff, in lines an hour, as they pick it in settings' Review time. */
export const PACES = { careful: LINES_PER_HOUR / 2, steady: LINES_PER_HOUR, quick: LINES_PER_HOUR * 2 } as const;
export type Pace = keyof typeof PACES;
