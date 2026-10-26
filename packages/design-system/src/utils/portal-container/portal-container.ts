// Where popups (tooltips, popovers) are drawn: the page's body, unless the components sit inside a
// shadow root on someone else's page (the extension's bar on github.com), which passes its own
// container so the popups get its styles. The desktop passes none.
import { createContext, useContext } from "react";

export const PortalContainer = createContext<HTMLElement | ShadowRoot | null>(null);

/** The container a popup portals into; undefined for the page's body. */
export const usePortalContainer = () => useContext(PortalContainer) ?? undefined;
