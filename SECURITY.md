# Security policy

Focus Diff runs on github.com pages and has access to what they show, so security reports are taken seriously.

## Reporting a vulnerability

Please report it privately through [GitHub's vulnerability reporting](https://github.com/hyanmandian/focus-diff/security/advisories/new), not in a public issue. Include what an attacker could do and the steps to reproduce it. You'll get a reply within a week, and credit in the release notes if you'd like it.

## Supported versions

Only the latest release gets fixes. Store builds update on their own.

## Verifying a release

Each release's zips are built by the Release workflow from the tagged commit, and their build provenance is signed with [GitHub artifact attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations). To check that a zip came from this repository's workflow, unchanged:

```sh
gh attestation verify focus-diff-chromium.zip --repo hyanmandian/focus-diff
```

The release also carries the same provenance as `focus-diff.sigstore.json` and `focus-diff.intoto.jsonl`.

## How the project is kept safe

- **No runtime dependencies:** the extension ships only its own code, and `npm run check` fails if a runtime dependency is added. Development dependencies are pinned by the lockfile, which is linted, scanned with OSV-Scanner, and updated weekly by Dependabot a week after each version is published.
- **Workflows:** every action is pinned to a full commit SHA, each job gets only the permissions it needs, and the workflows are linted with actionlint and zizmor. CodeQL, TruffleHog and OpenSSF Scorecard run on every pull request or weekly.
- **Store credentials:** the Chrome Web Store and Firefox Add-ons credentials live only in the `stores` environment, which needs a maintainer's approval before a job can use them. They are never repository secrets, and no other job can read them.
