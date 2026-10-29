# Privacy policy

Focus Diff does not collect, sell, or share any data. Neither the browser extension nor the desktop app has an
account, analytics or a server of its own: they send nothing to their developer, and talk to GitHub with your own
sign-in. The desktop app's AI is the one exception you choose: when you ask it something, it runs the Claude Code or
Cursor command line you installed and signed in to yourself.

## The browser extension

- **What it stores:** the filters you create, the bar's theme and the themes you make, the filter you last picked on each repository, your notification, popup and review time settings, and the pull requests you mark done or ignore in the popup. Filters, themes, those settings and marks are kept in the browser's synced storage, so they follow your profile across devices. The last-picked filter, your pull request lists as last read, what notifications it already showed or kept for review time, the files of the pull requests it estimated, the branches of the pull requests it put together in stacks, when pull requests left your review queue (to spot requests to review them again), and your review pace as it learns it stay in local storage on the device.
- **Where it runs:** only on `https://github.com/*`, where it reads file paths and line counts already shown on pull request pages to hide files and update the counters. Nothing it reads there leaves your browser.
- **What it asks GitHub:** when you open its toolbar popup, it reads your pull request lists (waiting for your review, and your own, and the Updates and Merged lists if you add them) from `https://github.com`, the branches of the pull requests that could be in a stack together, from each one's small hovercard once per push, and the authors' pictures from GitHub's `https://avatars.githubusercontent.com`. With notifications on, it also reads them, your notifications inbox, and the pages of pull requests with new activity, as often as you pick. To show how long each pull request waiting for your review takes, it reads their lists of changed files after reading your lists, once per push, unless you turn that off; at a review time, or when you start one, it reads the lists again to see which files you marked viewed. It reads them with the GitHub session already in your browser, like opening those pages yourself, and sends the requests only to GitHub. With notifications and review time off and the popup closed, it makes no requests.
- **Your review pace:** with learning on, on a pull request's files it counts the time you're active on each file until you mark it viewed, and keeps only running totals per kind of file (code, tests, docs and so on) on the device. It never records which files or pull requests, and it sends nothing.
- **Permissions:** `storage`, to keep your settings; `alarms`, to check GitHub as often as you pick while notifications are on, and to keep your review times; `offscreen` (Chrome only), to play the notification sound you pick, since Chrome's background has no audio; and `notifications`, asked for only when you turn notifications or review time on.
- **Third parties:** none. GitHub is the only site it talks to.

## The desktop app

- **How it signs in:** with the GitHub CLI (`gh`) when it is installed and signed in, asking it for your token once
  per launch and keeping it in memory, or with a personal access token you paste, kept in your system's keychain. You can also sign in to github.com
  in its own window for what GitHub's API doesn't offer; that session is kept in the keychain too.
- **What it stores, on your computer only:** your settings (queues, filters, actions, AI and notification choices),
  the comments you are still writing, what it last read of your pull requests and their pictures so they open fast,
  what notifications it already showed, and your review pace. When you ask the AI with the whole project as context,
  it keeps a checkout of that repository in its cache folder and removes it after 14 days unused.
- **What it asks GitHub:** your pull requests and their files, comments, checks and reviews, from `api.github.com`
  and `github.com`; pictures and attachments from GitHub's `githubusercontent.com` hosts; the logs of checks you open,
  which GitHub serves from its storage on `blob.core.windows.net`; and the images you attach to a comment go to the
  upload address GitHub gives for them. It sends only what you do: comments, reviews, viewed files, merges and the like.
- **AI, only when you ask:** it runs the Claude Code or Cursor command line on your computer, signed in to your own
  account. What you ask about (the pull request's description and changes, your question, and the checkout when you
  pick the whole project) goes to that provider under your agreement with them. Focus Diff sends it nowhere else.
- **Actions you set up:** a command you add runs on your computer, as you, with the pull request's number, title,
  link, repository and author, and your GitHub login. It asks before running a command the first time.
- **Updates:** it checks `github.com/hyanmandian/focus-diff` releases for a newer version and installs it only if its
  signature matches.
- **Third parties:** none but GitHub, and the AI provider you pick when you use the AI. On Windows, the installer may
  download Microsoft's WebView2 runtime if the system doesn't have it.

Questions: email focus-diff@hyan.com.br or open an issue at https://github.com/hyanmandian/focus-diff/issues.
