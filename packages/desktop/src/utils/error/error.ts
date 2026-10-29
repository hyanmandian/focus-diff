export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
