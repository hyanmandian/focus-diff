# Contributing

Thanks for helping make reviews calmer. Bug reports, ideas and pull requests are all welcome; for anything bigger than a small fix, open an [issue](https://github.com/hyanmandian/focus-diff/issues/new/choose) first so we can agree on the approach.

By taking part, you agree to the [code of conduct](CODE_OF_CONDUCT.md).

## Development

Focus Diff is built with [WXT](https://wxt.dev) and TypeScript, and has no runtime dependencies.

```sh
npm install         # also generates WXT's types
npm run dev         # Chrome with the extension loaded and hot reload (dev:firefox for Firefox)
npm run check       # types, Oxlint, Oxfmt, jscpd (no copy-paste), no runtime dependencies, the lockfile, Knip (unused code)
npm test            # unit tests with Vitest (test:coverage adds coverage, with a floor it can't drop below)
npm run e2e         # builds, then runs Playwright against the real extension, with axe accessibility checks
npm run fmt         # format everything
npm run zip         # store zips in .output/ (zip:firefox also packs the sources for review)
npm run build:demo  # the welcome page's live demo as one script for the site, in .output/demo/
npm run screenshots -- <pull request files URL>  # store and README images in store/screenshots/, then optimise them
```

```text
src/
  entrypoints/      what the browser loads: background, a content script per supported site, options and welcome pages
  content/          the content script's logic, the same on every site: filtering the page, moving between files
                    and conversations
  providers/        one folder per supported site: how to read its pages, and its theme; providers.ts lists them
  components/       the UI: functions that build elements and return how to update them; panel/ lays the
                    others out in a shadow root
  assets/           global.css: the extension pages' colours, reset and type
  utils/            filters, storage, the bar's appearance, formatting
  locales/          English and Brazilian Portuguese messages
tests/              Playwright end-to-end tests, on a local copy of a pull request page
```

The welcome page's demo (`components/demo/`) is the real bar on a sample pull request, built from the same components and the same review logic (`content/review.ts`) as on a review site. `build:demo` packs it for any web page, reading the messages from the locales instead of the extension: add `<div data-focus-diff-demo data-settings="#install"></div>` and `<script type="module" src="focus-diff-demo.js"></script>`.

Unit tests (Vitest with WXT's fake browser) sit next to the file they cover, as `<name>.test.ts`. A module gets a folder named after it only when it has more than one file, like its test or its CSS (`utils/format/format.ts` and `format.test.ts`); a module of one file stays flat. Import the file itself, never an index.

The end-to-end tests serve a saved pull request page in place of github.com, so they don't depend on the network.

## Adding a site

The bar, its numbers and its moves are the same on every site. What differs is where a site keeps a review's files, counters, file tree and conversations, and that's a provider's job. To add a site, say GitLab:

1. `src/providers/gitlab/gitlab.ts` exports a `Provider` (see `src/providers/provider.ts`) that reads its merge request pages. Keep the reading of the page in a module of its own, with unit tests next to it, like `providers/github/page.ts`.
2. `src/providers/gitlab/theme.css` sets the bar's `--fd-*` properties from the site's own design tokens, with the site's light and dark values as fallbacks, like `providers/github/theme.css`.
3. `src/providers/providers.ts` lists it, with its name and its theme, which loads only when it's needed.
4. `src/entrypoints/gitlab.content.ts` runs the bar there, like `github.content.ts`: each site's content script carries only its own provider.
5. A saved page in `tests/fixtures/` and end-to-end tests on it, like the GitHub ones.
6. The places that name the supported sites by hand: the manifest description in the locales, `PRIVACY.md` (where it runs), `SECURITY.md`, the README and the store listings.

## Releasing

Pull requests are merged with all their commits, so every commit message follows [Conventional Commits](https://www.conventionalcommits.org) (`feat: …`, `fix: …`), which a check enforces. Every merge to `main` updates a release pull request with the next version and its changelog. Merging it tags the release as a draft. The Release workflow then checks and tests the tagged commit, zips the Chromium, Firefox and Safari builds and the sources, signs their build provenance, attaches it all and publishes the release. Last, it sends the zips to the Chrome Web Store and Firefox Add-ons, once a maintainer approves the `stores` environment that holds their credentials.

The README's installs badge adds up the Chrome Web Store's users, Firefox Add-ons' daily users and the release zips' downloads (`scripts/installs.ts`). The site's deploy works it out every day into `focus-diff.com/badges/installs.json`. Firefox Add-ons is found by the extension's id; once the Chrome Web Store listing is live, set its id as the `CHROME_EXTENSION_ID` repository variable (Settings → Secrets and variables → Actions → Variables).

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
