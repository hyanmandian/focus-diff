// The first-run setup window.
export const setup = {
  "step.github": "GitHub",
  "step.queues": "Queues",
  "step.notifications": "Notifications",
  "step.ai": "AI",
  "step.ready": "Ready",
  steps: "Steps",
  repoError: "Use owner/name, or owner/* for all of an owner's",
  loading: "Loading",
  githubTitle: "Your reviews, without opening GitHub",
  githubBody:
    "Focus Diff sits in your menu bar, tells you when a pull request needs you, and lets you read, review and merge it right there. First, connect GitHub.",
  connectedAs: "Connected as {login}",
  checkingGitHub: "Checking GitHub",
  tokenNote:
    "Your token stays in the system keychain (or with the GitHub CLI) and only ever goes to GitHub. Focus Diff has no server.",
  queuesTitle: "What should it watch?",
  queuesBody:
    "Each is a queue in the panel. Later, in Settings, you can narrow them down (teams, labels, files) or add searches of your own.",
  onlyRepos: "Only in these repositories (optional)",
  repositories: "Repositories",
  repoPlaceholder: "acme/web or acme/*",
  reposEmpty: "Empty: every repository you can see.",
  notifyTitle: "How should it tell you?",
  notifyBody:
    "A notification and the menu bar icon's animation when something new needs you: a review request, new commits or replies on what you reviewed, approvals and failing CI on yours. What each queue tells you about can be changed in Settings.",
  sound: "Play a sound",
  checkEvery: "Check GitHub every",
  checkEveryHint: "Only what changed is downloaded again.",
  aiTitle: "Want a second pair of eyes?",
  aiBody:
    "Optional. Summaries, problems worth a look and answers about a pull request, from the coding agent you already use, on your own plan. It runs on this computer and can't change anything.",
  ai: "AI",
  noAi: "No AI",
  noAiHint: "Everything works without it.",
  lookingForAgents: "Looking for coding agents",
  signedOutRun: "signed out: run",
  notInstalled: "not installed",
  getIt: "Get it",
  readyVersion: "Ready · {version}",
  doneTitle: "You're set",
  doneBodyMac:
    "Focus Diff lives in your menu bar. Click its icon for your queues; it'll light up when something needs you. Model, effort, your own prompts and buttons are in Settings.",
  doneBodyTray:
    "Focus Diff lives in your menu bar (the system tray). Click its icon for your queues; it'll light up when something needs you. Model, effort, your own prompts and buttons are in Settings.",
  laterAi: "You can turn it on later.",
  back: "Back",
  continue: "Continue",
  open: "Open Focus Diff",
} as const;
