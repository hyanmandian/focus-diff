/** The bar's keyboard shortcuts, as the manifest names them. The background sends the one pressed to the tab. */
export const COMMANDS = ["next-filter", "previous-filter", "show-all", "next-unviewed"] as const;
type Command = (typeof COMMANDS)[number];

export type Message = { type: "command"; command: Command };
