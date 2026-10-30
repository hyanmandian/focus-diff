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

The desktop app's files are attested the same way (`gh attestation verify Focus-Diff.dmg --repo hyanmandian/focus-diff`), and its updater installs only files signed with the release key. Each desktop release, and `desktop-latest`, also carries a `SHA256SUMS` file listing the SHA-256 of every download (`shasum -a 256 -c SHA256SUMS --ignore-missing` on a Mac, `sha256sum -c SHA256SUMS --ignore-missing` on Linux). The updater key is used only by a release job that installs nothing from the repository: the builds and tests never see it.

### The install scripts

`install.sh` (Mac) and `install.ps1` (Windows) download the app from this repository's releases and check it before installing anything:

1. The download must match its line in the release's `SHA256SUMS`. If it doesn't, or `SHA256SUMS` can't be downloaded, the script stops.
2. When the GitHub CLI (`gh`) is installed and signed in, the script runs `gh attestation verify <file> --repo hyanmandian/focus-diff`, and stops if the build provenance doesn't check out. Without `gh`, it says so and goes on, checked by the checksum alone.
3. On a Mac, `codesign --verify` checks the app's ad hoc signature.

The Mac app isn't signed with an Apple Developer ID or notarized yet, so macOS would block it. **`install.sh` removes the app's quarantine flag (`xattr -dr com.apple.quarantine`), which bypasses Gatekeeper's check of it.** That's why there is nothing to approve, and why the checks above are what stand in for Apple's. If you'd rather Gatekeeper check it, install the `.dmg` and approve it in System Settings instead.

## How the project is kept safe

- **No runtime dependencies in the extension:** it ships only its own code, and its `npm run check` fails if a runtime dependency is added. The desktop app's dependencies, and every development dependency, are pinned by the lockfiles (`package-lock.json` and `Cargo.lock`), which are scanned with OSV-Scanner, and updated weekly by Dependabot a week after each version is published.
- **Workflows:** every action is pinned to a full commit SHA, each job gets only the permissions it needs, and the workflows are linted with actionlint and zizmor. CodeQL, TruffleHog and OpenSSF Scorecard run on every pull request or weekly. The dependency review allows one advisory, GHSA-wrw7-89jp-8q8g (unsoundness in `glib` 0.18), which only Tauri's Linux (GTK) build pulls in, in code the app doesn't call.
- **Store credentials:** CI holds none. A maintainer uploads each release to the Chrome Web Store and Firefox Add-ons by hand.
