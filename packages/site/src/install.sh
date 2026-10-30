#!/bin/sh
set -eu

repo=hyanmandian/focus-diff

fail() {
  echo "$1" >&2
  exit 1
}

verify_checksum() {
  file=$1
  name=$2
  sums=$3
  expected=$(awk -v name="$name" '$2 == name || $2 == "*" name { print $1 }' "$sums" | head -n 1)
  if [ -z "$expected" ]; then
    fail "SHA256SUMS doesn't list $name, so it can't be checked. Nothing was installed."
  fi
  actual=$(shasum -a 256 "$file" | awk '{ print $1 }')
  if [ "$actual" != "$expected" ]; then
    fail "$name doesn't match its SHA256SUMS entry. Nothing was installed."
  fi
}

verify_attestation() {
  file=$1
  if ! command -v gh > /dev/null 2>&1; then
    echo "Notice: the GitHub CLI (gh) isn't installed, so the build provenance wasn't checked. The checksum was."
    return
  fi
  if ! gh auth status > /dev/null 2>&1; then
    echo "Notice: the GitHub CLI (gh) isn't signed in, so the build provenance wasn't checked. The checksum was."
    return
  fi
  if ! gh attestation verify "$file" --repo "$repo" > /dev/null; then
    fail "The download's build provenance doesn't check out. Nothing was installed."
  fi
  echo "Checked the build provenance with the GitHub CLI."
}

main() {
  if [ "$(uname -s)" != Darwin ]; then
    fail "This installs the Mac app. For Windows and Linux, see https://focus-diff.com/desktop.html"
  fi

  latest="https://github.com/$repo/releases/download/desktop-latest/latest.json"
  url=$(curl -fsSL "$latest" | grep -o "https://github.com/$repo/releases/download/desktop-v[0-9.]*/Focus-Diff\.app\.tar\.gz" | head -n 1)
  if [ -z "$url" ]; then
    fail "Couldn't find the newest Focus Diff. Try again in a minute."
  fi

  dir=/Applications
  if [ ! -w "$dir" ]; then
    dir="$HOME/Applications"
    mkdir -p "$dir"
  fi

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  echo "Downloading Focus Diff..."
  curl -fL --progress-bar -o "$tmp/Focus-Diff.app.tar.gz" "$url"
  if ! curl -fsSL -o "$tmp/SHA256SUMS" "${url%/*}/SHA256SUMS"; then
    fail "Couldn't download SHA256SUMS to check the download. Nothing was installed. Try again in a minute."
  fi
  verify_checksum "$tmp/Focus-Diff.app.tar.gz" Focus-Diff.app.tar.gz "$tmp/SHA256SUMS"
  verify_attestation "$tmp/Focus-Diff.app.tar.gz"

  tar -xzf "$tmp/Focus-Diff.app.tar.gz" -C "$tmp"
  codesign --verify --deep --strict "$tmp/Focus Diff.app"

  osascript -e 'quit app id "com.focusdiff.app"' > /dev/null 2>&1 || true
  tries=0
  while pgrep -qf "Focus Diff.app/Contents/MacOS/" && [ "$tries" -lt 20 ]; do
    sleep 0.5
    tries=$((tries + 1))
  done
  if [ -d "$dir/Focus Diff.app" ]; then
    rm -rf "$dir/Focus Diff.app"
  fi
  mv "$tmp/Focus Diff.app" "$dir/"
  xattr -dr com.apple.quarantine "$dir/Focus Diff.app" 2> /dev/null || true

  echo "Installed in $dir. Opening it..."
  open "$dir/Focus Diff.app"
}

main "$@"
