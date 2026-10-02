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
#   scripts/component-versions.sh            print a four-component markdown table
#   scripts/component-versions.sh --write    also write manifest and Android versions
#
# Run by the release job before it tags, so the tagged tree states the truth.

set -euo pipefail

cd "$(dirname "$0")/.."

write=false
[ "${1:-}" = "--write" ] && write=true

if ! git cliff --version >/dev/null 2>&1; then
  echo "component-versions: git-cliff is not installed or not on PATH." >&2
  exit 1
fi

has_tags=$(git tag --list | head -n1)

# The version this release will carry. Anything that changed in this cycle
# ships inside it, so that is the version those components take.
next_version=$(git cliff --bumped-version 2>/dev/null || true)
if [ -z "$next_version" ]; then
  if [ -n "$has_tags" ]; then
    echo "component-versions: git-cliff resolved no version for the repository." >&2
    exit 1
  fi
  next_version="v0.0.0"
fi

# The release before this one, or empty in a repo with no tags yet.
last_tag=$(git describe --tags --abbrev=0 2>/dev/null || true)

# Resolves one component's version from the paths that make up its artifact.
#
# Two cases, and only two. A component that changed since the last tag is
# going out in the release being cut, so it takes that version. One that did
# not keeps the version of the release that last carried it: the earliest tag
# containing its most recent change.
#
# Deliberately *not* `git cliff --bumped-version --include-path`, which is
# what this used to be. Filtering the history to one component also filters
# out the `chore(release)` commits the tags sit on, so every release since
# that component's last change disappears from the filtered view and the
# answer comes back a version or more behind. The crypto core and the
# extension were spared only because the release commit happens to write
# their manifests; the server, which it did not, resolved to v0.17.0 for code
# that shipped in v0.18.0. An off-by-one that depends on which files a
# release commit touches is not something to leave in the machinery that
# names releases.
resolve() {
  local changed last shipped

  if [ -n "$last_tag" ]; then
    changed=$(git log --format=%H "$last_tag..HEAD" -- "$@" | head -n1)
  else
    changed=$(git log --format=%H -- "$@" | head -n1)
  fi

  if [ -n "$changed" ]; then
    printf '%s' "$next_version"
    return
  fi

  last=$(git log -1 --format=%H -- "$@")
  if [ -z "$last" ]; then
    # Nothing has ever touched these paths: a component added in this very
    # release, before any of its own commits exist.
    printf '%s' "$next_version"
    return
  fi

  # Sorted by version rather than by date: the earliest *version* containing a
  # change is the release that shipped it, even if tags were cut out of order.
  shipped=$(git tag --contains "$last" --sort=version:refname | head -n1)
  if [ -z "$shipped" ]; then
    echo "component-versions: no tag contains the last change to $* ($last)." >&2
    return 1
  fi
  printf '%s' "$shipped"
}

# A component's paths cover everything that lands in its artifact, not merely
# its own directory. The extension bundles the crypto core as wasm, and mobile
# bundles it through FFI/uniffi, so a core-only change alters both shipped
# artifacts and must move their versions. Otherwise two different builds
# would claim to be the same version. The server stores ciphertext and never
# opens it, so it bundles no crypto core.
core_version=$(resolve pw-crypto-core)
extension_version=$(resolve extension pw-crypto-core)
server_version=$(resolve server)
mobile_version=$(resolve mobile pw-crypto-core)

# Manifest versions are plain dotted numbers; the tag stream carries a v.
core_plain=${core_version#v}
extension_plain=${extension_version#v}
server_plain=${server_version#v}
mobile_plain=${mobile_version#v}

if $write; then
  python3 - "$core_plain" "$extension_plain" "$server_plain" "$mobile_plain" <<'PY'
import json, re, sys

core, extension, server, mobile = sys.argv[1:]

match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", mobile)
if match is None:
    raise SystemExit(f"invalid mobile version: {mobile}")
major, minor, patch = map(int, match.groups())
if minor >= 1000 or patch >= 1000:
    raise SystemExit(f"mobile minor and patch must be below 1000: {mobile}")
version_code = major * 1000000 + minor * 1000 + patch

gradle_path = "mobile/android/app/build.gradle"
gradle = open(gradle_path).read()
for key, value, pattern in (
    ("versionCode", str(version_code), r"(?m)^([ \t]*versionCode[ \t]+)\d+([ \t]*)$"),
    ("versionName", f'"{mobile}"', r'(?m)^([ \t]*versionName[ \t]+)"[^"]*"([ \t]*)$'),
):
    gradle, replaced = re.subn(
        pattern, lambda match: f"{match.group(1)}{value}{match.group(2)}", gradle
    )
    if replaced != 1:
        raise SystemExit(f"expected one {key} in {gradle_path}, found {replaced}")

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

for path, version in (
    ("extension/package.json", extension),
    ("server/package.json", server),
    ("mobile/package.json", mobile),
):
    manifest = json.load(open(path))
    manifest["version"] = version
    open(path, "w").write(json.dumps(manifest, indent=2) + "\n")
open(gradle_path, "w").write(gradle)
PY
  echo "wrote pw-crypto-core=$core_plain extension=$extension_plain server=$server_plain mobile=$mobile_plain" >&2
fi

cat <<TABLE
| Component | Version |
| --- | --- |
| \`pw-crypto-core\` | $core_version |
| \`extension\` | $extension_version |
| \`server\` | $server_version |
| \`mobile\` | $mobile_version |
TABLE
