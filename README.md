<div align="center">
  <img src="store/logo/focus-diff-1024.png" width="112" alt="">
  <h1>Focus Diff</h1>
  <p><strong>Review what matters.</strong><br>Filter GitHub pull request diffs down to the files you need to review.</p>
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
- **Combine filters.** Turn on as many as you like, like _Frontend + Docs_. Turn them all off and you're back on **All**.
- **See where the changes are.** The breakdown shows, per filter, how many files you've marked as viewed, the lines changed and the time left.
- **Review time left.** An estimate next to the line totals, from about 1,000 changed lines per hour, that drops as you mark files as viewed.
- **Conversations.** Step through review threads one by one. Each shows its file and line, and whether it's waiting on you, answered or resolved.
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

Store listings are on the way. Meanwhile, every [release](https://github.com/hyanmandian/focus-diff/releases/latest) has builds you can load yourself:

- **Chrome, Edge, Brave, Arc and other Chromium browsers:** unzip `focus-diff-chromium.zip`, open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and pick the unzipped folder.
- **Firefox and browsers built on it:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `focus-diff-firefox.zip`. It stays until Firefox restarts.
- **Safari (Mac with Xcode):** unzip `focus-diff-safari.zip`, run `xcrun safari-web-extension-converter focus-diff-safari --app-name "Focus Diff" --macos-only` and click **Run** in Xcode. In Safari, turn on **Settings › Advanced › Show features for web developers**, then **Develop › Allow Unsigned Extensions**, and enable Focus Diff in **Settings › Extensions**.

To build from source instead, run `npm install` and `npm run build` (or `build:firefox`, `build:safari`); the builds land in `.output/`.

## Contributing

Bug reports, ideas and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to run it locally, test it and cut a release. Please report security issues [privately](SECURITY.md).

## License

[MIT](LICENSE) © Hyan Mandian
