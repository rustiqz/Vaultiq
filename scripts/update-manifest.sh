#!/usr/bin/env bash
# Print the Firefox update manifest (updates.json) for one signed .xpi.
#
#   scripts/update-manifest.sh <manifest.json> <signed.xpi> <vX.Y.Z>
#
# The extension's manifest `update_url` points at this file on the latest
# release. `version` must be the version inside the .xpi's manifest (the
# extension component's own version, which can differ from the product tag),
# or Firefox will see an "update" that never matches what it installs.
set -euo pipefail

manifest="$1"
xpi="$2"
tag="$3"

repo="${GITHUB_REPOSITORY:-rustiqz/Vaultiq}"
id=$(jq -er '.browser_specific_settings.gecko.id' "$manifest")
version=$(jq -er '.version' "$manifest")
hash=$(sha256sum "$xpi" | cut -d' ' -f1)
link="https://github.com/${repo}/releases/download/${tag}/$(basename "$xpi")"

jq -n --arg id "$id" --arg version "$version" --arg link "$link" --arg hash "sha256:$hash" \
  '{addons: {($id): {updates: [{version: $version, update_link: $link, update_hash: $hash}]}}}'
