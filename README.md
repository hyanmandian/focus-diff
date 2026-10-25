# Focus Diff

Your pull request reviews from the menu bar (system tray on Windows and Linux): queues you set up, a notification and an animated tray icon when something happens, and the pull request itself — description, checks, conversation, diff, review — without opening GitHub. The paid sibling of [Focus Diff](https://focus-diff.com).

## What it does

- **Queues you set up.** Each queue is a recipe: pull requests where your review is requested (you or your teams), where you took part, that you opened, that were merged without you, or any GitHub search; in some repositories; changing some files (regular expressions, like Focus Diff's filters); leaving out drafts, bots, authors or labels. Starts with Review, Updates and My PRs.
- **It tells you.** A notification for what each queue cares about (a new review request, new commits, a reply, a mention, an approval, CI failing or passing again, a conflict), the tray icon's focus animation, and the cards that changed lighting up when you open the panel. Cards stay highlighted until you've clicked them.
- **Review without GitHub.** A pull request's description, reviewers, checks, conversation and files in the panel; approve, request changes, comment, mark ready, merge. The diff in its own window, with line comments, a pending review, replies, resolving and viewed files.
- **Optional AI, on your own plan.** A summary and what's worth a closer look, from the coding agent you already use — Claude Code, Codex or Cursor — run on your computer through its own CLI and your own login. Text only: it can't edit files or run commands. Off by default.

## Privacy and security

- GitHub's token stays in the system keychain (or with the GitHub CLI) and is only ever sent to `api.github.com`, by the app's Rust side. The web views never see it.
- Nothing goes anywhere but GitHub — and, when you ask for it, your own AI CLI on your computer.
- HTML from GitHub is sanitized with an allowlist on top of a strict Content-Security-Policy. Links open in your browser.
- Few dependencies, each well known: Tauri and its official plugins, serde, ureq and keyring in Rust; React, Base UI (through shadcn/ui), lucide and @pierre/diffs on the web side. `npm audit` is clean; of the Rust crates, the [OSV](https://osv.dev) database lists only "unmaintained" notices and one unsoundness in `glib` 0.18, all from Tauri's own Linux (GTK) stack and in code paths the app doesn't use.

## Developing

Needs Node 22+, Rust (stable) and, on Linux, Tauri's [system packages](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev       # the app, with the tray icon
npm run dev             # just the pages in a browser, with sample data (http://localhost:1420, /settings.html, /review.html?id=PR_1807&repo=acme/web&number=1807)
npm run check           # TypeScript and tests
npm run tauri build     # a release build
```

Signing in with GitHub (device flow) needs an OAuth app's client id at build time: `FOCUS_DIFF_GITHUB_CLIENT_ID=… npm run tauri build`. Without it, the app offers the GitHub CLI's login or a personal access token.

## Layout

- `src-tauri/src/` — Rust: the tray icon and panel window (`lib.rs`, `tray.rs`), GitHub access (`github.rs`), the AI adapters (`ai.rs`).
- `src/lib/` — the queue engine (`engine.ts`, with tests), config, store, GitHub details and review data, the sanitizer.
- `src/panel/`, `src/settings/`, `src/review/` — the three pages.
- `src/dev/mock.ts` — sample data for working on the pages in a browser; never part of a build.
