// What every extension page does first, as the desktop's entries do (packages/desktop/src/entries): plugs in the
// browser as the screens' platform, under the window's name, follows the language picked in Settings, and draws the
// screen.

import { TooltipProvider } from "@focus-diff/design-system/components/tooltip";
import { followLanguage } from "@focus-diff/desktop/utils/language";
import { setPlatform } from "@focus-diff/desktop/utils/platform";
import { StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { createWebPlatform } from "@/utils/web-platform/web-platform";

/** Plugs the page in as the app's window `name`, then draws `screen` in #root. */
export const startPage = (name: string, screen?: ReactNode): Root => {
  setPlatform(createWebPlatform(name));
  followLanguage();
  const root = createRoot(document.querySelector("#root")!);
  if (screen !== undefined) render(root, screen);
  return root;
};

/** Draws a screen with what every screen needs around it. */
export const render = (root: Root, screen: ReactNode) => {
  root.render(
    <StrictMode>
      <TooltipProvider>{screen}</TooltipProvider>
    </StrictMode>,
  );
};
