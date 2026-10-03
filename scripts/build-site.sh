#!/usr/bin/env bash
# Assemble the public site into _site/: the landing page (site/) at the root and
# the mdBook user guide (guide/) under /docs/. Used by CI and for local preview:
#
#   scripts/build-site.sh && python3 -m http.server -d _site 8000
#
# Needs mdbook on PATH (pinned to 0.5.4 in .github/workflows/pages.yml).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/_site"

rm -rf "$out" "$root/guide/book"
mdbook build "$root/guide"

mkdir -p "$out/docs"
cp -R "$root/site/." "$out/"
cp -R "$root/guide/book/." "$out/docs/"

echo "built $out"
