# Contributing

Thanks for helping make reviews calmer. Bug reports, ideas and pull requests are all welcome; for anything bigger than a small fix, open an [issue](https://github.com/hyanmandian/focus-diff/issues/new/choose) first so we can agree on the approach.

By taking part, you agree to the [code of conduct](CODE_OF_CONDUCT.md).

## Development

This repository holds everything Focus Diff is, as npm workspaces:

```text
packages/
  extension/      the browser extension: WXT and TypeScript
  desktop/        the Mac app: Tauri 2 (Rust) with a React front end, built with Vite+
  site/           focus-diff.com, a static page
  core/           logic both apps share (filters, recipes, the review-time estimate): TypeScript, no dependencies
  design-system/  what makes them one product: tokens, the brand mark and the UI components both apps draw with
```

The apps import a shared package's files directly, as its `exports` name them (`@focus-diff/core/filters`), and bundle
them; `npm run check` in `packages/core` is Oxfmt, Oxlint (as strict as the apps'), types and Vitest at 100%.

`npm install` at the root installs everything. Run an app's commands from its folder (or with `--workspace`), and
`npm run check`, `npm test`, `npm run build` or `npm run e2e` at the root to run them in every app.

### The extension (`packages/extension`)

Focus Diff is built with [WXT](https://wxt.dev) and TypeScript, and has no runtime dependencies.

```sh
npm run dev         # Chrome with the extension loaded and hot reload (dev:firefox for Firefox)
npm run check       # types, Oxlint, Oxfmt, jscpd (no copy-paste), no runtime dependencies, the lockfile, Knip (unused code)
npm test            # unit tests with Vitest (test:coverage adds coverage, which must be 100%)
npm run e2e         # builds, then runs Playwright against the real extension, with axe accessibility checks
npm run fmt         # format everything
npm run zip         # store zips in .output/ (zip:firefox also packs the sources for review)
npm run build:demo  # the welcome page's live demo as one script for the site, in .output/demo/
npm run screenshots -- <pull request files URL>  # store and README images in store/screenshots/, then optimise them
```

```text
src/
  entrypoints/      what the browser loads: background, a content script per supported site, the popup, options,
                    welcome and offscreen pages; each only wires up a component or util
  components/       the UI: functions that build elements and return how to update them; panel/ lays the bar's
                    others out in a shadow root, mount-bar/ puts it on a review page, *-page/ are the extension's pages
  utils/            the logic: the review and its moves (review/, review-controller/, review-navigation/), one
                    <site>-provider/ per supported site with its page reading (github-page/), filters, storage,
                    inbox, review time, the background's work (background/, review-scheduler/)
  assets/           global.css: the extension pages' colours, reset and type
  locales/          English and Brazilian Portuguese messages
tests/              Playwright end-to-end tests, on a local copy of a pull request page
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

Its code follows one layout: `src/components/<name>/<name>.tsx`, `src/hooks/<name>/<name>.ts` and
`src/utils/<name>/<name>.ts`, each with its `<name>.test.tsx` beside it, kebab-case, imported directly (no index
files); `tests/` is only for end-to-end tests; `src-tauri/` is the Rust side.

The welcome page's demo (`components/demo/`) is the real bar on a sample pull request, built from the same components and the same review logic (`utils/review/review.ts`) as on a review site. `build:demo` packs it for any web page, reading the messages from the locales instead of the extension: add `<div data-focus-diff-demo data-settings="#install"></div>` and `<script type="module" src="focus-diff-demo.js"></script>`.

Its code follows the same layout as the Mac app's: `src/components/<name>/<name>.ts` (UI that builds elements) and `src/utils/<name>/<name>.ts` (logic), kebab-case, one folder per module even when it has a single file, each with its unit test (Vitest with WXT's fake browser) beside it as `<name>.test.ts`. Import the file itself, never an index. `src/entrypoints/` stays thin: WXT needs it, and its files only wire up a component or util.

The end-to-end tests serve a saved pull request page in place of github.com, so they don't depend on the network.

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

- Add no runtime dependency: the extension ships only its own code, and `npm run check` enforces it.
- Pin every action to a full commit SHA with its version in a comment (`uses: owner/action@<sha> # vX.Y.Z`), and give each job only the permissions it needs. Dependabot keeps both up to date.
- The Security workflow lints the workflows (actionlint, zizmor), scans the lockfile (OSV-Scanner) and the commits (TruffleHog), runs CodeQL and reviews new dependencies on pull requests, and runs OpenSSF Scorecard on `main`. Fix what it reports in the same pull request.
- Use the Node.js version in `.nvmrc`.

## Pull requests

- Keep each pull request to one change, and each commit to one step of it, with a [Conventional Commit](https://www.conventionalcommits.org) message: each `feat` and `fix` becomes a changelog entry.
- Add or update tests: unit tests for logic, end-to-end tests for anything on the page.
- Put new text in both `src/locales/en.json` and `src/locales/pt_BR.json`.
- Prefer selectors a site is unlikely to change: roles, ARIA attributes, ids and `data-` attributes, not generated class names.
- Check the panel in the site's light and dark themes, and with the keyboard.
