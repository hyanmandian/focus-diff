# Changelog

## [1.1.0](https://github.com/hyanmandian/focus-diff/compare/v1.0.0...v1.1.0) (2026-10-05)


### Features

* read each review site through a provider, and let readers restyle the bar ([75e9692](https://github.com/hyanmandian/focus-diff/commit/75e9692118d70e1b9b4814bb755e67fd98c0d773))
* redesign the settings and welcome pages in the site's identity ([754f088](https://github.com/hyanmandian/focus-diff/commit/754f088cd929c3d352ab371abd9b081c89948563))
* themes as colours to pick, named and shared like filters ([70d471b](https://github.com/hyanmandian/focus-diff/commit/70d471b47b3a76cb4d3d07b1d64f89f9784f7e74))


### Performance

* load the extension pages and the site faster ([04d38fa](https://github.com/hyanmandian/focus-diff/commit/04d38fa0a303a5c4f9f3b3cb178cac80632748b4))
* **site:** minify the page, its styles and scripts on deploy ([ba36b66](https://github.com/hyanmandian/focus-diff/commit/ba36b66ec95c72663c563afe3c8b28174cb88021))

## 1.0.0 (2026-10-04)

The first release of Focus Diff: a small bar on GitHub pull request "Files changed" pages that lets you review one part of a pull request at a time.

### Highlights

* **Filters from file patterns.** Make filters such as Frontend, Backend, Tests or Docs, start from ready-made examples, and keep them for every repository or just one. The diff shows only the files of the filter you pick.
* **What's left, counted again.** Files changed and the +/− lines are recounted for the filter, next to the files left to review and an estimate of the review time, with a breakdown of every filter side by side.
* **Done when it's done.** A Done badge, with confetti, when a filter is fully reviewed.
* **Faster moves.** Jump to the next file you haven't viewed (Alt+Shift+J), step through every conversation, and switch filters from the keyboard.
* **Private.** No account, no tracking and no network requests: nothing the extension reads leaves your browser.
* **For everyone.** Keyboard and screen reader friendly, GitHub's light and dark themes, English and Brazilian Portuguese.

Builds for Chromium browsers, Firefox and Safari are attached to this release.
