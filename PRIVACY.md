# Privacy policy

Focus Diff does not collect, sell, or share any data. It has no servers of its own.

- **What it stores:** the filters you create and the filter you last picked on each repository. Filters are kept in your browser's synced storage, so they follow your profile across devices. Everything else stays in local storage on the device: the last-picked filter, review guides you created, the repositories you approved for guides, and, if you set up guided review, your AI provider, model and API key. The API key is never synced.
- **Where it runs:** only on `https://github.com/*`, where it reads file paths and line counts already shown on pull request pages to hide files and update the counters.
- **Guided review (optional, off by default):** only when you ask for a guide, and after you confirm, Focus Diff downloads the pull request's diff from GitHub with your browser session and sends the pull request's title, description and diff straight to the AI provider you configured, using your own key. The provider's own privacy policy applies to that request. Nothing is sent when guided review isn't set up, and nothing is sent in the background.
- **Permissions:** `storage`, to keep your filters. When you set up guided review, Focus Diff asks for access to your provider's address and to GitHub's diff download addresses (`github.com` and `patch-diff.githubusercontent.com`). Removing the key gives the provider access back.
- **Third parties:** only the AI provider you choose, and only for guides you ask for.

Questions: email contact@hyan.com.br or open an issue at https://github.com/hyanmandian/focus-diff/issues.
