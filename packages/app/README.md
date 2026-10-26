# @focus-diff/app

Focus Diff's screens and the logic behind them, for any app to run: the panel with your queues, a pull request's
review (overview, conversation, diff, the filter bar, your pending review), Settings, first-run setup. The Mac app
(`packages/desktop`) runs them in Tauri's web views; the browser extension will run the same ones. Nothing here
talks to Tauri or a browser's extension APIs: the screens reach the app they run in through a small `Platform`, which
the app plugs in.

## What's in it

```text
src/
  components/   the screens and their parts: panel, pull-row, pull-menus, panel-review-time, review, overview,
                timeline, thread, writer, diffs, file-tree, filter-bar, sidebar, merge-box, checks, commits,
                settings and its panes (settings-*), setup, connect, viewer...
  hooks/        use-pull, use-conversation, use-pending, use-new-changes, use-next-in-queue, use-active-time, use-seconds
  utils/        the logic: bridge (the app's commands, by name), store (the panel's queues), config, filters, review,
                conversation, i18n, theme, os (which system, for shortcut glyphs and data-platform)...
                platform        the Platform interface, setPlatform() and platform()
                mock, mock-*    sample data as a Platform, for working on the screens in a browser (development only)
                fake-platform   the platform the unit tests run on
                test-setup      what runs before each unit test file
  locales/      English and Brazilian Portuguese messages
  styles/       styles.css (the screens' own styles), tailwind.css (Tailwind, the design system and styles.css)
```

Each module is `src/<kind>/<name>/<name>.ts(x)` with its test beside it, kebab-case, imported by its own path (no
index files): `@focus-diff/app/components/panel`, `@focus-diff/app/utils/platform`. The Settings window's own
stylesheet is `@focus-diff/app/components/settings.css`.

## The platform

```ts
interface Platform {
  invoke<T>(command: string, args?: Args, options?: InvokeOptions): Promise<T>; // one of the app's commands
  listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten>; // an event from the app or any window
  listenToWindow<T>(event: string, handler: (payload: T) => void): Promise<Unlisten>; // this window's own
  emitTo(window: string, event: string, payload?: unknown): Promise<void>; // an event to another window
  version(): Promise<string>;
  closeWindow(): Promise<void>;
  mediaUrl?(kind: "avatar" | "media", url: string): string; // where GitHub's pictures load from, if the app keeps them
}
```

The commands and events are the desktop's, by name and payload (`utils/bridge` lists them, `src-tauri/src/lib.rs`
answers them): `snapshot`, `refresh`, `github` (a REST or GraphQL call; the screens never hold the token),
`read_file`/`write_file`, `open_review`, the `snapshot` and `drafts` events, and so on. Another app answers the same
ones its own way. A command rejects with its error as it is (not always an `Error`), as Tauri's do.

## Plugging an app in

The app's entry for each page sets the platform before anything else, then draws a screen:

```tsx
import { Panel } from "@focus-diff/app/components/panel";
import { followLanguage } from "@focus-diff/app/utils/language";
import { setPlatform } from "@focus-diff/app/utils/platform";
import { start } from "@focus-diff/app/utils/store";

setPlatform(myPlatform);
followLanguage();
createRoot(root).render(
  <TooltipProvider>
    <Panel />
  </TooltipProvider>,
);
void start();
```

The desktop's is `packages/desktop/src/utils/tauri-platform` and its entries are `packages/desktop/src/entries/`. In
a plain browser during development, `setPlatform((await import("@focus-diff/app/utils/mock")).mockPlatform)` runs
the screens on sample data.

The package ships its source; the app's bundler builds it. The app needs React 19 and Tailwind v4, adds
`"@focus-diff/app": "*"` (and `@focus-diff/design-system`) to its dependencies, and imports the screens' styles after
the design system's (or `@focus-diff/app/tailwind.css` for all three):

```css
@import "tailwindcss";
@import "@focus-diff/design-system/styles.css";
@import "@focus-diff/app/styles.css";
```

`styles.css` tells Tailwind where the screens' classes are (`@source`), so there's nothing to configure. For the
React Compiler, run it over this package's files too (the desktop's `@rolldown/plugin-babel` with
`reactCompilerPreset()` does, as they resolve outside `node_modules`). The review's syntax colouring wants a
`@pierre/diffs` worker pool from the page (see the desktop's `entries/review.tsx`).

## Working on it

```sh
npm run check   # Oxfmt, Oxlint (strict, type-aware, the desktop's rules), types, Vitest at 100% coverage
npm test        # the unit tests (Vitest with Testing Library, on happy-dom, on the fake platform)
npm run fmt     # format everything
```

A test answers commands with `mockCommands((command, args) => ...)` and sends events with `emit(event, payload)`
(`utils/fake-platform`); the platform's other requests reach the same handler as `VERSION`, `CLOSE_WINDOW` and
`EMIT_TO`. To see the screens, run `npx vp dev` in `packages/desktop` (sample data, no Rust), and run the desktop's
end-to-end tests (`npm run e2e` there) after a change here.
