# Focus Diff

Your pull request reviews from the menu bar (system tray on Windows and Linux): queues you set up, a notification and an animated tray icon when something happens, and the pull request itself — description, checks, conversation, diff, review — without opening GitHub. Free, like the [Focus Diff](https://focus-diff.com) browser extension it grew out of.

## What it does

- **Queues you set up.** Each queue is a recipe: pull requests where your review is requested (you or your teams), where you took part, that you opened, that were merged without you, or any GitHub search; in some repositories; changing some files; leaving out drafts, bots, authors or labels. The panel shows them like Focus Diff's popup: a tab per queue, repository chips, rows grouped by repository, and how long a review has been waiting on you.
- **It tells you.** A notification for what each queue cares about (a new review request, new commits, a reply, a mention, an approval, CI failing or passing again, a conflict), the tray icon's animation, and the rows that changed lighting up when you open the panel.
- **Review without GitHub.** A click opens the pull request's review window: the diff with line comments, a pending review, replies, resolving and viewed files; the description, reviewers, checks and conversation beside it; approve, request changes, merge, mark ready, leave the review.
- **Review one part at a time.** Diff filters like Focus Diff's (frontend, backend, code then tests, no generated files…), as chips over the diff: combine several, keep some for one repository, see what each holds and the time left, go to the next file to review (⌥⇧J; ⌥⇧. ⌥⇧, ⌥⇧0 for the filters). The time left starts at about 1,000 changed lines an hour and learns your pace. Filters copy and import as the same text as Focus Diff's, both ways.
- **Viewed, everywhere.** Files you mark as viewed are marked on github.com too, and the other way round.
- **Your own buttons.** Actions that comment, request or drop reviewers, label, open a link or run a script (asked for once, in a native dialog).
- **Optional AI, on your own plan.** Claude Code or Cursor, through their own CLIs and your login, read-only. It can read the pull request's whole project, to see where the changed code is used and what it could break, with the repository's own rules. Your prompts as buttons, any question, and an AI review whose comments land on the diff's lines for you to add to your review or dismiss.
- **A minute to set up**, and updates you choose when to install.

## Privacy and security

- GitHub's token stays in the system keychain (or with the GitHub CLI) and is only ever sent to `api.github.com`, by the app's Rust side. The web views never see it.
- Nothing goes anywhere but GitHub — and, when you ask for it, your own AI CLI on your computer. For the AI to read a project, the pull request's code is fetched into the app's cache folder with git, without your git config (no credential helpers or hooks), and the agent settings in it that would run things (hooks, MCP servers) are deleted first. Checkouts unused for two weeks are removed.
- Updates are signed: the app installs only what the release key signed, and only when you say so.
- HTML from GitHub is sanitized with an allowlist on top of a strict Content-Security-Policy. Links open in your browser.
- Few dependencies, each well known: Tauri and its official plugins (notifications, opener, dialog, updater), serde, regex, ureq and keyring in Rust; React, Base UI (through shadcn/ui), lucide and @pierre/diffs on the web side. `npm audit` is clean; of the Rust crates, the [OSV](https://osv.dev) database lists only "unmaintained" notices and one unsoundness in `glib` 0.18, all from Tauri's own Linux (GTK) stack and in code paths the app doesn't use.

## Fast and light

- The queues live in Rust (`src-tauri/src/engine.rs`, `watch.rs`): no web view is needed to check GitHub, notify or update the tray. The panel's web view is created on click and closed three minutes after it hides; idle, the app is a single ~30 MB process.
- Each refresh is a light search per queue (ids and last update; CI and mergeability only for your own pull requests), and only the pull requests that changed are fetched in full. A full pass every 20 minutes catches what GitHub doesn't count as an update.
- What GitHub said is cached between launches, so the panel shows your queues the moment it opens. REST calls revalidate with ETags (a 304 is free against the rate limit) over one kept-alive connection.

## Developing

Needs Node 22+, Rust (stable) and, on Linux, Tauri's [system packages](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev       # the app, with the tray icon
npm run dev             # just the pages in a browser, with sample data (http://localhost:1420, /settings.html, /setup.html, /review.html?id=PR_1807&repo=acme/web&number=1807)
npm run check           # TypeScript and tests
npm run tauri build     # a release build
```

Signing in with GitHub (device flow) needs an OAuth app's client id at build time: `FOCUS_DIFF_GITHUB_CLIENT_ID=… npm run tauri build`. Without it, the app offers the GitHub CLI's login or a personal access token.

## Releasing

Merging the desktop's release pull request (tagged `desktop-v…`, see the root `CONTRIBUTING.md`) builds one universal Mac app for Apple Silicon and Intel, attaches `Focus-Diff.dmg` and the updater's archive, and puts `latest.json` on the `desktop-latest` release, where the updater looks (`https://github.com/hyanmandian/focus-diff/releases/download/desktop-latest/latest.json`). The app isn't signed with an Apple Developer ID: the release is downloaded and installed by hand. The updater's key, made with `tauri signer generate` and kept outside the repository, goes in the secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Layout

- `src-tauri/src/` — Rust: windows and commands (`lib.rs`), the queue engine and its cache (`engine.rs`, with tests), the refresh loop, notifications and seen state (`watch.rs`), the tray icon (`tray.rs`), GitHub access (`github.rs`), the AI adapters (`ai.rs`) and the project checkouts they read (`checkout.rs`), custom actions' commands (`actions.rs`), updates (`update.rs`).
- `src/entries/` — the four pages (panel, settings, setup, review): each plugs in the Tauri platform (`src/utils/tauri-platform/`) and draws a screen.
- `src/components/`, `src/hooks/`, `src/utils/` — the screens and their logic: config, the panel's store (follows Rust's snapshots), GitHub details and review data, AI prompts, actions, the sanitizer, and the sample data (`src/utils/mock/`) for working on the pages in a browser, never part of a build. The screens reach Rust only through a small platform (`src/utils/platform/`): the Tauri one in the app, the sample data's in a browser, and a fake one in unit tests (`src/utils/fake-platform/`: `mockCommands((command, args) => ...)` answers commands, `emit(event, payload)` sends events). `src/locales/` holds their English and Brazilian Portuguese messages.
- The UI kit, in the same tree: shadcn's components on Base UI (button, tooltip, dialog, sliding-pill, file-icon, mark…) in `src/components/`, `cn` (`src/utils/cn/`), and in `src/styles/` the Mac look's tokens (`tokens.css`), shadcn's variants and the materials (`utilities.css`), a window's base styles (`base.css`) and the screens' styles (`styles.css`). `src/index.css` brings them together; `components.json` is shadcn's config.
- `tests/` — end-to-end tests of the pages in Chromium and WebKit, on the sample data.
