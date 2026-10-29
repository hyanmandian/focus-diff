# Security policy

Focus Diff runs on github.com pages and, as a desktop app, holds a GitHub token, so security reports are taken seriously.

## Reporting a vulnerability

Please report it privately through [GitHub's vulnerability reporting](https://github.com/hyanmandian/focus-diff/security/advisories/new), not in a public issue. Include what an attacker could do and the steps to reproduce it. You'll get a reply within a week, and credit in the release notes if you'd like it.

## Supported versions

Only the latest release of each app gets fixes. Store builds update on their own, and the desktop app offers each new version with its Update button.

## Verifying a release

Each release's zips are built by the Release workflow from the tagged commit, and their build provenance is signed with [GitHub artifact attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations). To check that a zip came from this repository's workflow, unchanged:

```sh
gh attestation verify focus-diff-chromium.zip --repo hyanmandian/focus-diff
```

The release also carries the same provenance as `focus-diff.sigstore.json` and `focus-diff.intoto.jsonl`.

The desktop app's files are attested the same way (`gh attestation verify Focus-Diff.dmg --repo hyanmandian/focus-diff`), and its updater installs only files signed with the release key.

## How the project is kept safe

- **No runtime dependencies in the extension:** it ships only its own code, and its `npm run check` fails if a runtime dependency is added. The desktop app's dependencies, and every development dependency, are pinned by the lockfiles (`package-lock.json` and `Cargo.lock`), which are scanned with OSV-Scanner, and updated weekly by Dependabot a week after each version is published.
- **Workflows:** every action is pinned to a full commit SHA, each job gets only the permissions it needs, and the workflows are linted with actionlint and zizmor. CodeQL, TruffleHog and OpenSSF Scorecard run on every pull request or weekly. The dependency review allows one advisory, GHSA-wrw7-89jp-8q8g (unsoundness in `glib` 0.18), which only Tauri's Linux (GTK) build pulls in, in code the app doesn't call.
- **Store credentials:** CI holds none. A maintainer uploads each release to the Chrome Web Store and Firefox Add-ons by hand.
