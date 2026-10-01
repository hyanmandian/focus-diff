#!/bin/sh
set -e
cd "$(dirname "$0")"
version=$(node -p "require('./src/manifest.json').version")
mkdir -p dist
rm -f "dist/focus-diff-$version.zip"
(cd src && zip -qr "../dist/focus-diff-$version.zip" . -x '.*')
echo "dist/focus-diff-$version.zip"
