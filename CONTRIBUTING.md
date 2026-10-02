# Contributing

Thanks for helping make reviews calmer. Bug reports, ideas and pull requests are all welcome; for anything bigger than a small fix, open an [issue](https://github.com/hyanmandian/focus-diff/issues/new/choose) first so we can agree on the approach.

By taking part, you agree to the [code of conduct](CODE_OF_CONDUCT.md).

## Development

Focus Diff is built with [WXT](https://wxt.dev) and TypeScript, and has no runtime dependencies.

```sh
npm install         # also generates WXT's types
npm run dev         # Chrome with the extension loaded and hot reload (dev:firefox for Firefox)
npm run check       # types, Oxlint and Oxfmt
npm test            # unit tests with Vitest
npm run e2e         # builds, then runs Playwright against the real extension, with axe accessibility checks
npm run fmt         # format everything
npm run zip         # store zips in .output/ (zip:firefox also packs the sources for review)
```

```text
src/
  entrypoints/      background, the GitHub content script, options and welcome pages
  components/       the UI: functions that build elements and return how to update them. A component with
                    its own CSS gets a folder; panel/ lays the others out in a shadow root
  utils/            filters, storage, the GitHub page adapter, formatting
  locales/          English and Brazilian Portuguese messages
tests/
  unit/             Vitest with WXT's fake browser
  e2e/              Playwright, on a local copy of a pull request page
```

The end-to-end tests serve a saved pull request page in place of github.com, so they don't depend on the network.

## Releasing

Pull requests are squash-merged, and their titles follow [Conventional Commits](https://www.conventionalcommits.org) (`feat: …`, `fix: …`), which a check enforces. Every merge to `main` updates a release pull request with the next version and its changelog. Merging it tags the release, attaches the Chrome and Firefox builds, and publishes them to the stores when their credentials are set as repository secrets.

## Pull requests

- Keep each pull request to one change, and its title a [Conventional Commit](https://www.conventionalcommits.org): it becomes the changelog entry.
- Add or update tests: unit tests for logic, end-to-end tests for anything on the page.
- Put new text in both `src/locales/en.json` and `src/locales/pt_BR.json`.
- Prefer selectors GitHub is unlikely to change: roles, ARIA attributes, ids and `data-` attributes, not generated class names.
- Check the panel in GitHub's light and dark themes, and with the keyboard.
