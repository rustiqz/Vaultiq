#!/usr/bin/env bash
#
# Component versions.
#
# The product version — the git tag — moves on any releasable change anywhere
# in the repo. Each component carries its own version, which moves only when
# that component's shipped artifact changes. Both come from the same commit
# history and the same tags; a component's version is that history filtered by
# path.
#
#   scripts/component-versions.sh            print a markdown table
#   scripts/component-versions.sh --write    also write the versions into files
#
# Run by the release job before it tags, so the tagged tree states the truth.

set -euo pipefail

cd "$(dirname "$0")/.."

write=false
[ "${1:-}" = "--write" ] && write=true

# A component's paths must cover everything that ends up in its artifact, not
# merely its own directory. The extension bundles the crypto core as wasm, so
# a core-only change alters the shipped extension and must move its version —
# otherwise two different builds would claim to be the same version.
if ! git cliff --version >/dev/null 2>&1; then
  echo "component-versions: git-cliff is not installed or not on PATH." >&2
  exit 1
fi

has_tags=$(git tag --list | head -n1)

# Resolves one component's version, or fails.
#
# An empty result is only legitimate in a repo with no tags at all. Anywhere
# else it means git-cliff failed, and quietly substituting 0.0.0 would stamp
# that into a release — so this refuses instead.
resolve() {
  local version
  version=$(git cliff --bumped-version "$@" 2>/dev/null || true)

  if [ -n "$version" ]; then
    printf '%s' "$version"
  elif [ -z "$has_tags" ]; then
    printf 'v0.0.0'
  else
    echo "component-versions: no version resolved for $*" >&2
    return 1
  fi
}

core_version=$(resolve --include-path 'pw-crypto-core/**')
extension_version=$(resolve \
  --include-path 'extension/**' \
  --include-path 'pw-crypto-core/**')

# Manifest versions are plain dotted numbers; the tag stream carries a v.
core_plain=${core_version#v}
extension_plain=${extension_version#v}

if $write; then
  python3 - "$core_plain" "$extension_plain" <<'PY'
import json, re, sys

core, extension = sys.argv[1], sys.argv[2]

# Only the version inside [package] — a blind substitution would rewrite every
# pinned dependency in the file.
path = "pw-crypto-core/Cargo.toml"
text = open(path).read()
package = re.search(r"(?ms)^\[package\].*?(?=^\[)", text)
if package is None:
    raise SystemExit(f"no [package] section in {path}")
block = package.group(0)
# subn, not comparing text: a component whose version has not moved rewrites
# the same value, and treating that no-op as "key missing" would fail every
# release that leaves this component untouched — which is most of them.
updated, replaced = re.subn(
    r'(?m)^version = ".*"$', f'version = "{core}"', block, count=1
)
if replaced == 0:
    raise SystemExit(f"no version key in the [package] section of {path}")
open(path, "w").write(text.replace(block, updated, 1))

path = "extension/package.json"
manifest = json.load(open(path))
manifest["version"] = extension
open(path, "w").write(json.dumps(manifest, indent=2) + "\n")
PY
  echo "wrote pw-crypto-core=$core_plain extension=$extension_plain" >&2
fi

cat <<TABLE
| Component | Version |
| --- | --- |
| \`pw-crypto-core\` | $core_version |
| \`extension\` | $extension_version |
TABLE
