<img src="store/logo/focus-diff-1024.png" width="96" alt="Focus Diff logo">

# Focus Diff

Review what matters. A Chrome extension that adds filter buttons to GitHub pull request diffs ("Files changed") and shows the real size of what you're reviewing.

- **All** is always there and shows every file.
- Each filter you create becomes a button. A file is shown when its path matches **Include** and doesn't match **Exclude** (JavaScript regex, case-insensitive, full path).
- Filters can apply to **every repository** or **only to specific repositories** (`owner/name` or `owner/*`). On a repo, you get the global buttons plus that repo's own.
- While a filter is on, the page's **Files changed** counter and the **+/−** totals show the filtered numbers, so you see what you actually have to review.
- Settings sync through your Chrome profile. Use **Copy my setup** / **Import** in the settings page to share a setup with your team.

## How it works

| File | Role |
|---|---|
| `src/shared.js` | Filter model: config shape, regex matching, storage |
| `src/github.js` | Reads GitHub's pull request page: diffs, file tree, counters |
| `src/panel.js` | The floating filter bar, in a shadow root that follows GitHub's theme |
| `src/content.js` | Connects the page, the panel and your saved filters |
| `src/options.*` | Settings page |
| `src/background.js` | Opens settings on install and from the toolbar button |

Supporting another code host means adding a sibling to `github.js` with the same functions.

## Install (unpacked, for testing)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `src` folder.
3. The settings page opens with an example setup (Frontend, Backend, Docs).

## License

[MIT](LICENSE) © Hyan Mandian
