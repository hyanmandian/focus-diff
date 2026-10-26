# @focus-diff/design-system

What makes Focus Diff's apps look like one product: the Mac look (macOS HIG type scale, control sizes, radii,
colours light and dark, materials, motion) as design tokens and base styles, and the React components both apps
draw with (shadcn on [Base UI](https://base-ui.com), styled with Tailwind v4). Nothing here talks to Tauri, the
browser extension's APIs or an app's state: an app passes in what's specific to it (text in its language, data).

## What's in it

```text
src/
  styles/
    tokens.css      the tokens (--type-*, --control-h*, --radius-*, colours, shadows, --duration*) and the Tailwind
                    theme on them (text-body, bg-popover, rounded-lg, text-muted-foreground...); dark is `.dark` on <html>
    utilities.css   shadcn's state variants (data-open:...) and keyframes, focus-ring, scroll-fade, shimmer, no-scrollbar,
                    .mac-menu and .mac-popover (the menu material)
    base.css        a page's base: borders, background and text colour, 13pt body type, chrome that can't be selected
                    (.selectable for what can), the text selection
    styles.css      all three, tw-animate-css, and the components' class names for Tailwind (@source)
    tailwind.css    `@import "tailwindcss"` and styles.css: a new app's setup in one import
  components/       avatar, badge, button, button-group, checkbox, collapsible, context-menu, dialog, dropdown-menu,
                    file-icon, input, kbd, label, mark, popover, progress, scroll-area, select, separator, skeleton,
                    sliding-pill, switch, tabs, textarea, toggle, toggle-group, tooltip
  utils/cn/         class merging (clsx + tailwind-merge) that knows the type scale
```

Each component is `src/components/<name>/<name>.tsx` with its test beside it, imported by its own path (no index
files): `@focus-diff/design-system/components/<name>`. The mark is also there as a plain SVG,
`@focus-diff/design-system/mark.svg`.

## Using it in an app

The package ships its source (TypeScript, TSX, CSS); the app's own bundler (Vite, WXT...) builds it. The app needs
React 19 and Tailwind v4 (with `@tailwindcss/vite`), and adds the package as a workspace dependency:

```json
"dependencies": { "@focus-diff/design-system": "*" }
```

**Stylesheet.** The app's stylesheet imports Tailwind and then the design system, then adds its own:

```css
@import "tailwindcss";
@import "@focus-diff/design-system/styles.css";

/* the app's own styles */
```

(`@import "@focus-diff/design-system/tailwind.css";` does both lines.) `styles.css` tells Tailwind to scan the
components (`@source "../components"`), since Tailwind skips `node_modules` and other packages: nothing to configure.
Where the components sit on someone else's page (the extension's bar on github.com), leave out Tailwind's preflight
and the base styles: import `tailwindcss/theme.css` and `tailwindcss/utilities.css`, then
`@focus-diff/design-system/styles/tokens.css` and `.../styles/utilities.css` (and `tw-animate-css`), and add an
`@source` pointing at the package's `src/components` folder (a path relative to that stylesheet). The tokens are set
on `:root` and `.dark`, so in a shadow root they need the same declarations on `:host`.

**Components.**

```tsx
import { Button } from "@focus-diff/design-system/components/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@focus-diff/design-system/components/tooltip";
import { cn } from "@focus-diff/design-system/utils/cn";
```

Tooltips need a `TooltipProvider` around the page. Text the components draw themselves comes in as props (for
example `DialogContent`'s `closeLabel`), so the app passes it in its language.

**The page.** Dark mode is the `dark` class on `<html>`. `<html data-platform="macos">` turns on the Mac's live
system colours in a web view that has them (Safari, WKWebView); elsewhere the tokens' own values apply.
`<html data-window-inactive>` grays selections, as an inactive Mac window does. The screens set both in
`packages/app/src/utils/os`.

## Working on it

```sh
npm run check   # Oxfmt, Oxlint (strict, type-aware, the desktop's rules), types, Vitest at 100% coverage
npm test        # the unit tests (Vitest with Testing Library, on happy-dom)
npm run fmt     # format everything
```

A change here changes both apps: run the desktop's checks and end-to-end tests too.
