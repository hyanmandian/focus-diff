<img src="store/logo/focus-diff-1024.png" width="96" alt="Focus Diff logo">

# Focus Diff

Review what matters. A browser extension for Chrome, Edge and Firefox that adds filter buttons to GitHub pull request diffs ("Files changed") and shows the real size of what you're reviewing.

- **All** is always there and shows every file.
- Each filter you create becomes a button. A file is shown when its path matches **Include** and doesn't match **Exclude** (JavaScript regex, case-insensitive, full path).
- Filters can apply to **every repository** or **only to specific repositories** (`owner/name` or `owner/*`). On a repo, you get the global buttons plus that repo's own.
- While a filter is on, the page's **Files changed** counter and the **+/−** totals show the filtered numbers, so you see what you actually have to review.
- Settings sync through your browser profile. Use **Copy my filters** / **Import filters** in the settings page to share a setup with your team.
- Available in English and Brazilian Portuguese, following the browser's language.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt` + `Shift` + `.` | Next filter |
| `Alt` + `Shift` + `,` | Previous filter |
| `Alt` + `Shift` + `0` | Show all files |

On a Mac, `Alt` is `Option`. Change them at `chrome://extensions/shortcuts` (or `about:addons` → gear → *Manage Extension Shortcuts* in Firefox). Inside the panel, the arrow keys, `Home` and `End` also move between filters.

## How it works

| File | Role |
|---|---|
| `src/shared.js` | Filter model: config shape, regex matching, storage |
| `src/github.js` | Reads GitHub's pull request page: diffs, file tree, counters |
| `src/panel.js` | The floating filter bar, in a shadow root that follows GitHub's theme |
| `src/content.js` | Connects the page, the panel and your saved filters |
| `src/options.*` | Settings page |
| `src/background.js` | Opens settings on install and from the toolbar button, forwards keyboard shortcuts |
| `src/_locales/` | English and Brazilian Portuguese text |

Supporting another code host means adding a sibling to `github.js` with the same functions.

## Install (unpacked, for testing)

- **Chrome / Edge:** open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and pick the `src` folder.
- **Firefox:** run `npm run build`, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `dist/firefox/manifest.json`.

The settings page opens with an example setup (Frontend, Backend, Docs).

## Development

```sh
npm install
npm test        # unit tests plus end-to-end tests in headless Chrome, including axe accessibility checks
npm run lint    # syntax check, build, and Firefox's add-on linter
npm run build   # dist/focus-diff-<version>-chrome.zip (also for Edge) and -firefox.zip
```

The end-to-end tests run the real content scripts on a local copy of a GitHub pull request page (`tests/e2e/fixtures`), so they don't depend on github.com.

## Releasing

1. Bump `version` in `src/manifest.json` and `package.json`.
2. Push a matching tag: `git tag v1.0.1 && git push --tags`.

The **Release** workflow tests and builds, attaches both zips to a GitHub release, and publishes to the stores when their secrets are set:

- Chrome Web Store: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` ([how to get them](https://github.com/fregante/chrome-webstore-upload-keys)).
- Firefox Add-ons: `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` (from [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/developers/addon/api/key/)).

The first upload to each store is done by hand, since the store needs the listing and privacy answers before the API can publish updates.

## License

[MIT](LICENSE) © Hyan Mandian
