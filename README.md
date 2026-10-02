<div align="center">
  <img src="store/logo/focus-diff-1024.png" width="112" alt="">
  <h1>Focus Diff</h1>
  <p><strong>Review what matters.</strong><br>Filter GitHub pull request diffs down to the files you actually need to review.</p>
  <p>
    <a href="https://github.com/hyanmandian/focus-diff/actions/workflows/ci.yml"><img src="https://github.com/hyanmandian/focus-diff/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
    <img src="https://img.shields.io/badge/Chrome%20%C2%B7%20Edge%20%C2%B7%20Firefox-supported-2ea043" alt="Works on Chrome, Edge and Firefox">
  </p>
</div>

<img src="store/screenshots/readme.png" alt="A GitHub pull request with 406 changed files, narrowed by the Focus Diff panel to the 123 frontend files, with Files changed showing 123/406 and +1,305 lines">

## Why

Large pull requests mix the code you need to read with tests, stories, generated files and docs. Focus Diff adds a small bar to the **Files changed** page: pick a filter and only the matching files stay on screen. The file tree, the **Files changed** counter and the **+/−** totals follow along, so you see the real size of your review before you start.

## Features

- **Your own filters.** Each filter is a button with an _Include_ regex and an optional _Exclude_ regex, tested against the full file path. **All** is always there.
- **Everywhere or per repository.** Keep filters for every pull request, and add extra ones for `owner/name` or a whole `owner/*`.
- **Real numbers.** Files changed and the line totals show only what the filter keeps, and update as GitHub loads more files.
- **Combine filters.** Shift-click to look at several filters at once, like _Frontend + Docs_.
- **See where the changes are.** The breakdown shows how much of the pull request falls under each filter before you start.
- **Review time.** A rough estimate next to the line totals, at about 400 changed lines per hour.
- **Keyboard friendly.** Arrow keys inside the bar, plus global shortcuts.
- **Made to share.** Copy your filters and send them to a teammate, who imports them in one step.
- **Feels like GitHub.** Follows your GitHub theme, checked against WCAG 2.1 AA, respects reduced motion, and speaks English and Portuguese.
- **Private.** No tracking and no network requests. Filters stay in your browser profile. See the [privacy policy](PRIVACY.md).

## Getting started

Focus Diff starts empty, so your filters fit the way you review. Right after installing, a welcome page explains how it works and offers examples you can add with one click:

- **Split frontend and backend**, without tests and stories in the way.
- **Focus on one part of the codebase**, like the folder your team owns.
- **Read the code before the tests**, or only the tests.
- **Skip generated files**: lockfiles, snapshots, minified files and build output.
- **Check infrastructure changes**: CI, Docker, Terraform, Kubernetes and YAML.
- **Watch database changes**: migrations, SQL and schemas.
- **Review docs and copy**.

They're regular filters, so you can rename or tweak them later. The welcome page is always one click away from the settings.

## Keyboard shortcuts

| Shortcut                                     | Action          |
| -------------------------------------------- | --------------- |
| <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>.</kbd> | Next filter     |
| <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>,</kbd> | Previous filter |
| <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>0</kbd> | Show all files  |

On a Mac, <kbd>Alt</kbd> is <kbd>Option</kbd>. Change them at `chrome://extensions/shortcuts`, or in Firefox under `about:addons` → gear → _Manage Extension Shortcuts_.

## Install

Store listings are on the way. Until then, load it from source:

- **Chrome or Edge:** open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and pick the `src` folder.
- **Firefox:** run `npm run build`, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `dist/firefox/manifest.json`.

## Development

Focus Diff uses [Vite+](https://viteplus.dev): Vitest for tests, Oxlint for linting and Oxfmt for formatting, all configured in `vite.config.js`. The extension itself has no runtime dependencies.

```sh
vp install      # or npm install
vp check        # format check and lint
vp test         # unit tests and end-to-end tests in headless Chrome, with axe accessibility checks
vp fmt          # format everything
vp run lint     # Oxlint, build and Firefox's add-on linter
vp run build    # zips for Chrome/Edge and Firefox in dist/
```

The end-to-end tests run the real content scripts on a local copy of a pull request page, so they don't depend on github.com.

## License

[MIT](LICENSE) © Hyan Mandian
