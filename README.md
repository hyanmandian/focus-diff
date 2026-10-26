<div align="center">
  <img src="packages/extension/store/logo/focus-diff-1024.png" width="112" alt="">
  <h1>Focus Diff</h1>
  <p><strong>Review what matters.</strong><br>Your pull request reviews in one place: queues, a review page, and filters on GitHub's diffs.</p>
  <p>
    <a href="https://github.com/hyanmandian/focus-diff/releases/latest"><img src="https://img.shields.io/github/v/release/hyanmandian/focus-diff?label=version&color=2ea043" alt="Latest version"></a>
    <a href="https://chromewebstore.google.com/detail/focus-diff/nnocnopcbjipboglgbnmocfaplhlkfil"><img src="https://img.shields.io/chrome-web-store/v/nnocnopcbjipboglgbnmocfaplhlkfil?label=Chrome%20Web%20Store&color=2ea043" alt="Focus Diff on the Chrome Web Store"></a>
    <a href="https://addons.mozilla.org/firefox/addon/focus-diff/"><img src="https://img.shields.io/amo/v/focus-diff?label=Firefox%20Add-ons&color=2ea043" alt="Focus Diff on Firefox Add-ons"></a>
    <a href="https://focus-diff.com"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Ffocus-diff.com%2Fbadges%2Finstalls.json" alt="Installs: Chrome Web Store and Firefox Add-ons users plus release downloads"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/hyanmandian/focus-diff" alt="MIT license"></a>
    <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript">
    <img src="https://img.shields.io/badge/Chrome%20%C2%B7%20Edge%20%C2%B7%20Firefox%20%C2%B7%20Safari-supported-2ea043" alt="Works on Chrome, Edge, Firefox and Safari">
    <br>
    <a href="https://github.com/hyanmandian/focus-diff/actions/workflows/ci.yml"><img src="https://github.com/hyanmandian/focus-diff/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
    <a href="https://github.com/hyanmandian/focus-diff/actions/workflows/security.yml"><img src="https://github.com/hyanmandian/focus-diff/actions/workflows/security.yml/badge.svg" alt="Security checks"></a>
    <a href="https://scorecard.dev/viewer/?uri=github.com/hyanmandian/focus-diff"><img src="https://api.scorecard.dev/projects/github.com/hyanmandian/focus-diff/badge" alt="OpenSSF Scorecard"></a>
  </p>
</div>

<img src="packages/extension/store/screenshots/readme.png" alt="A GitHub pull request with 83 changed files, narrowed by the Focus Diff bar to its 56 frontend files: Files changed shows 56/83, and the bar shows 56 files to review, +2,010 and −545 lines, and about 2 hours 20 minutes of review">

## Why

Large pull requests mix the code you need to read with tests, stories, generated files and docs, and the reviews waiting on you are spread across GitHub. Focus Diff brings them together: your review queues a click away in the toolbar, each pull request in a review page of its own, and a small bar on GitHub's **Files changed** page that narrows the diff to the files you pick. The browser extension runs the same screens as Focus Diff for Mac, with the same look.

## Features

- **Your queues at a glance.** The toolbar button shows what waits for your review, what you're involved in and your own pull requests, what's new since you last looked first. Pick several to mark done or open, and undo.
- **A review page.** Each pull request opens in a tab of its own: its overview, the diff with its file tree, conversations, checks and their logs, commits, merging, and your pending review, written in place and sent to GitHub as you go.
- **Your own filters.** Each filter has an _Include_ regex and an optional _Exclude_ one, tested against the full file path, for every repository or for `owner/name` and `owner/*`. Turn on as many as you like; none is **All**.
- **The bar on GitHub.** On a pull request's **Files changed** page, the bar keeps only the files your filters pick. The file tree, the **Files changed** counter and the **+/−** totals follow along, and the breakdown shows each filter's files, lines and time left.
- **Review time left.** An estimate from about 1,000 changed lines per hour that learns your pace from the files you mark as viewed, and drops as you go.
- **Notifications.** New review requests, drafts made ready, comments, replies, mentions, approvals, requested changes, CI and conflicts, per queue and per repository, leaving out what you don't need, like drafts or bots.
- **Review time.** Set aside time to review, like weekdays at 15:00 for half an hour. When it comes, Focus Diff picks the pull requests that fit and tells you; notifications can wait for it, and the toolbar icon counts the time down.
- **Your own buttons.** Actions on a pull request: comment, ask for reviews, take yourself off a review, add labels, open a link.
- **Keyboard friendly.** Global shortcuts for the bar, and the Mac app's shortcuts on the review page.
- **Private.** No tracking, and nothing sent anywhere but GitHub. You connect GitHub once; the token stays on your device. See the [privacy policy](packages/extension/PRIVACY.md).

## Getting started

Right after installing, setup asks you to connect GitHub (with a code you enter on github.com, or a personal access token), pick the queues to watch and how to be told. Updating from an earlier version keeps your filters, notification and review time settings and your learned pace; you only connect GitHub once. Settings is always one click away from the toolbar button's menu.

## Keyboard shortcuts

| Shortcut                                     | Action              |
| -------------------------------------------- | ------------------- |
| <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>.</kbd> | Next filter         |
| <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>,</kbd> | Previous filter     |
| <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>0</kbd> | Show all files      |
| <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>J</kbd> | Next file to review |

These work on GitHub's **Files changed** page.

On a Mac, <kbd>Alt</kbd> is <kbd>Option</kbd>. Change them at `chrome://extensions/shortcuts`, or in Firefox under `about:addons` → gear → _Manage Extension Shortcuts_.

## Install

**Chrome, Edge, Brave, Arc and other Chromium browsers:** add it from the [Chrome Web Store](https://chromewebstore.google.com/detail/focus-diff/nnocnopcbjipboglgbnmocfaplhlkfil).

**Firefox, Zen, LibreWolf and other browsers built on Firefox:** add it from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/focus-diff/).

Every [release](https://github.com/hyanmandian/focus-diff/releases/latest) also has builds you can load yourself:

- **Firefox and browsers built on it:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `focus-diff-firefox.zip`. It stays until Firefox restarts.
- **Safari (Mac with Xcode):** unzip `focus-diff-safari.zip`, run `xcrun safari-web-extension-converter focus-diff-safari --app-name "Focus Diff" --macos-only` and click **Run** in Xcode. In Safari, turn on **Settings › Advanced › Show features for web developers**, then **Develop › Allow Unsigned Extensions**, and enable Focus Diff in **Settings › Extensions**.
- **Chromium, without the store:** unzip `focus-diff-chromium.zip`, open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and pick the unzipped folder. It won't update itself.

To build from source instead, run `npm install`, then `npm run build` (or `build:firefox`, `build:safari`) in `packages/extension`; the builds land in `packages/extension/.output/`.

## Focus Diff for Mac

The desktop app lives in the menu bar: your review queues at a glance, and every pull request opens in its own window to review it whole (overview, diff, conversations, checks, merging), without github.com. Download `Focus-Diff.dmg` from the newest [`desktop-v` release](https://github.com/hyanmandian/focus-diff/releases), drag it to Applications and open it. It isn't signed with an Apple Developer ID yet, so the first time macOS asks you to confirm: right-click it and choose **Open** (or **System Settings › Privacy & Security › Open Anyway**). After that it updates itself.

## Contributing

Bug reports, ideas and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to run it locally, test it and cut a release. Please report security issues [privately](SECURITY.md).

## License

[MIT](LICENSE) © Hyan Mandian
