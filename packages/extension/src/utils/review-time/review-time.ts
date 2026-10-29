import { LINES_PER_HOUR } from "@focus-diff/core/estimate";

export const PACES = { careful: LINES_PER_HOUR / 2, steady: LINES_PER_HOUR, quick: LINES_PER_HOUR * 2 } as const;
export type Pace = keyof typeof PACES;
