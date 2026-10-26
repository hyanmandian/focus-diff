# Contributing

Thanks for helping make reviews calmer. Bug reports, ideas and pull requests are all welcome; for anything bigger than a small fix, open an [issue](https://github.com/hyanmandian/focus-diff/issues/new/choose) first so we can agree on the approach.

By taking part, you agree to the [code of conduct](CODE_OF_CONDUCT.md).

## Development

This repository holds everything Focus Diff is, as npm workspaces:

```text
packages/
  extension/      the browser extension: WXT, running the app's screens in a browser
  desktop/        the Mac app: Tauri 2 (Rust) with a React front end, built with Vite+
  app/            the screens both apps run and their logic, on a pluggable platform (see its README)
  site/           focus-diff.com, a static page
  core/           logic both apps share (filters, recipes, the review-time estimate): TypeScript, no dependencies
  design-system/  what makes them one product: the Mac look's tokens, styles and React components (see its README)
```

The apps import a shared package's files directly, as its `exports` name them (`@focus-diff/core/filters`), and bundle
them; `npm run check` in `packages/core`, `packages/design-system` and `packages/app` is Oxfmt, Oxlint (as strict as the apps'), types
and Vitest at 100%.

`npm install` at the root installs everything. Run an app's commands from its folder (or with `--workspace`), and
`npm run check`, `npm test`, `npm run build` or `npm run e2e` at the root to run them in every app.

### The extension (`packages/extension`)

Built with [WXT](https://wxt.dev), it runs the Mac app's screens (`packages/app`) on the design system, as the desktop
does: React with the React Compiler, Tailwind v4. Its runtime dependencies are the workspace packages, React and
`@pierre/diffs` (the review's syntax colouring); `npm run check` allows exactly those.

```sh
npm run dev         # Chrome with the extension loaded and hot reload (dev:firefox for Firefox)
npm run check       # types, Oxlint, Oxfmt, jscpd (no copy-paste), the allowed runtime dependencies, the lockfile, Knip
npm test            # unit tests with Vitest (test:coverage adds coverage, which must be 100%)
npm run e2e         # builds, then runs Playwright against the real extension, with axe accessibility checks
npm run fmt         # format everything
npm run zip         # store zips in .output/ (zip:firefox also packs the sources for review)
npm run screenshots -- <pull request files URL>  # store and README images in store/screenshots/, then optimise them
```

Set `FOCUS_DIFF_GITHUB_CLIENT_ID` when building to offer signing in with a code (GitHub's device flow), as the
desktop's build does; without it, setup offers a personal access token.

How it fits together: each page (the popup is the panel, the options page Settings, `setup.html` first-run setup,
`review.html` a pull request's review) plugs in a `Platform` (`utils/web-platform`) that sends the app's commands, by
the desktop's names, over a port named for its window to the background (`utils/command-server`), and hears its events
(`snapshot`, `file-changed`, `drafts`, `review-open`) the same way. The background is what the desktop's Rust is: it
keeps the token and calls GitHub (`utils/github-api`, with the ETag cache), runs core's queue engine on an alarm with
notifications and the toolbar badge (`utils/queue-service`), sends pending review comments and viewed marks until GitHub
takes them (`utils/drafts`, `utils/viewed-outbox`), keeps the app's files and the last copy of each review in local
storage (`utils/app-files`, `utils/kept`), and opens the review tabs (`utils/windows`). What a browser can't do (quit,
update itself, the AI tools, running commands, attaching files as github.com does) the platform says in
`Platform.features`, and the screens leave it out. `utils/migration` moves an earlier version's settings over on update.

```text
src/
  entrypoints/      what the browser loads: the background, the popup, options, setup and review pages, and the
                    content scripts for github.com; each only wires up a component or util
  components/       the review tab and the bar on github.com (React, in a shadow root with the design system's tokens)
  utils/            the background's work, the pages' platform, and the bar's page reading (github-page/,
                    github-provider/) and filtering
  assets/           pages.css: Tailwind, the design system and the screens' styles for the extension's pages
  locales/          the manifest's English and Brazilian Portuguese messages (the screens' are packages/app's)
tests/              Playwright end-to-end tests: the popup, Settings, setup, a review on sample data, the bar on saved
                    pull request pages, and moving an earlier version's settings over
```

### The Mac app (`packages/desktop`)

```sh
npm run tauri dev   # the app, with the menu bar icon, hot reload for the pages and Rust rebuilt on change
npx vp dev          # the pages alone in a browser, on sample data (no Rust, no GitHub)
npx vp check        # Oxfmt, Oxlint (strict, type-aware) and types
npx vp test --coverage   # unit tests, at 100% coverage
npm run e2e         # Playwright on the pages, in Chromium and WebKit
npm run tauri build # a signed .app in src-tauri/target/release/bundle (needs the updater key, see Releasing)
```

Its screens live in `packages/app`; the desktop keeps what makes it a Tauri app: `src/entries/` (a page each, which
plugs in the Tauri platform and draws a screen), `src/utils/tauri-platform/`, `src-tauri/` (the Rust side) and
`tests/` (end-to-end tests of the pages, on the sample data). Both follow one layout: `src/components/<name>/<name>.tsx`,
`src/hooks/<name>/<name>.ts` and `src/utils/<name>/<name>.ts`, each with its `<name>.test.tsx` beside it, kebab-case,
imported directly (no index files).

The extension's code follows the same layout as the Mac app's: `src/components/<name>/<name>.tsx` and `src/utils/<name>/<name>.ts`, kebab-case, one folder per module even when it has a single file, each with its unit test (Vitest with WXT's fake browser) beside it. Import the file itself, never an index. `src/entrypoints/` stays thin: WXT needs it, and its files only wire up a component or util.

The extension's end-to-end tests serve saved pull request pages in place of github.com and answer GitHub's API from sample data, so they don't depend on the network.

## Adding a site

The bar, its numbers and its moves are the same on every site. What differs is where a site keeps a review's files, counters, file tree and conversations, and that's a provider's job. To add a site, say GitLab:

1. `src/utils/gitlab-provider/gitlab-provider.ts` exports a `Provider` (see `src/utils/provider/provider.ts`) that reads its merge request pages. Keep the reading of the page in a module of its own, with unit tests next to it, like `utils/github-page/github-page.ts`.
2. `src/components/gitlab-theme/gitlab-theme.css` sets the bar's `--fd-*` properties from the site's own design tokens, with the site's light and dark values as fallbacks, like `components/github-theme/github-theme.css` (and `components/mount-bar/mount-bar.ts` leaves it out of the bar's own styles).
3. `src/utils/providers/providers.ts` lists it, with its name and its theme, which loads only when it's needed.
4. `src/entrypoints/gitlab.content.ts` runs the bar there, like `github.content.ts`: each site's content script carries only its own provider.
5. A saved page in `tests/fixtures/` and end-to-end tests on it, like the GitHub ones.
6. The places that name the supported sites by hand: the manifest description in the locales, `PRIVACY.md` (where it runs), `SECURITY.md`, the README and the store listings.

## Releasing

Pull requests are merged with all their commits, so every commit message follows [Conventional Commits](https://www.conventionalcommits.org) (`feat: …`, `fix: …`), which a check enforces. Every merge to `main` updates a release pull request with the next version and its changelog. Merging it tags the release as a draft. The Release workflow then checks and tests the tagged commit, zips the Chromium, Firefox and Safari builds and the sources, signs their build provenance, attaches it all and publishes the release. A maintainer then uploads the zips to the Chrome Web Store and Firefox Add-ons by hand.

The Mac app has its own release pull request (tagged `desktop-v…`). Merging it builds the app on macOS (one universal build for Apple Silicon and Intel), attaches `Focus-Diff.dmg` and the updater's archive, publishes the release without making it the latest (the site's download links follow the extension's), and puts `latest.json`, where installed apps look for updates, on the `desktop-latest` release. The updater's key goes in the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Supply chain

- Add no runtime dependency beyond the extension's allowed ones (the workspace packages, React, `@pierre/diffs`): `npm run check` enforces it.
- Pin every action to a full commit SHA with its version in a comment (`uses: owner/action@<sha> # vX.Y.Z`), and give each job only the permissions it needs. Dependabot keeps both up to date.
- The Security workflow lints the workflows (actionlint, zizmor), scans the lockfile (OSV-Scanner) and the commits (TruffleHog), runs CodeQL and reviews new dependencies on pull requests, and runs OpenSSF Scorecard on `main`. Fix what it reports in the same pull request.
- Use the Node.js version in `.nvmrc`.

## Pull requests

- Keep each pull request to one change, and each commit to one step of it, with a [Conventional Commit](https://www.conventionalcommits.org) message: each `feat` and `fix` becomes a changelog entry.
- Add or update tests: unit tests for logic, end-to-end tests for anything on the page.
- Put new text in both languages: the screens' in `packages/app/src/locales`, the manifest's in `packages/extension/src/locales`.
- Prefer selectors a site is unlikely to change: roles, ARIA attributes, ids and `data-` attributes, not generated class names.
- Check the screens and the bar in light and dark, and with the keyboard.
