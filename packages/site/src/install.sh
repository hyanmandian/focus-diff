#!/bin/sh
set -eu

if [ "$(uname -s)" != Darwin ]; then
  echo "This installs the Mac app. For Windows and Linux, see https://focus-diff.com/desktop.html" >&2
  exit 1
fi

latest=https://github.com/hyanmandian/focus-diff/releases/download/desktop-latest/latest.json
url=$(curl -fsSL "$latest" | grep -o 'https://github.com/hyanmandian/focus-diff/releases/download/desktop-v[0-9.]*/Focus-Diff\.app\.tar\.gz' | head -n 1)
if [ -z "$url" ]; then
  echo "Couldn't find the newest Focus Diff. Try again in a minute." >&2
  exit 1
fi

dir=/Applications
if [ ! -w "$dir" ]; then
  dir="$HOME/Applications"
  mkdir -p "$dir"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading Focus Diff..."
curl -fL --progress-bar -o "$tmp/focus-diff.tar.gz" "$url"
tar -xzf "$tmp/focus-diff.tar.gz" -C "$tmp"
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
