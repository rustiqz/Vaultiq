# CI and releases

## What runs, and when

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` → `gate` | every PR, push to `main` | fmt, clippy `-D warnings`, tests, WASM feature build |
| `ci.yml` → `commit-messages` | PRs only | rejects malformed commit subjects |
| `ci.yml` → `release` | push to `main`, **after `gate` passes** | tags and cuts the GitHub release |
| `audit.yml` | dependency changes, weekly cron, manual | `cargo audit` against the RustSec advisory database |

Release is a job inside `ci.yml`, not its own workflow, so `needs: gate` can
guarantee ordering. As a separate workflow it would run *in parallel* with the
checks, and a broken build could be tagged.

The weekly cron on `audit.yml` is the point of it: an advisory can land
against a dependency nobody touched.

## Commit subjects decide the version

Version numbers are not edited by hand. git-cliff reads the
conventional-commit subjects since the last tag and derives the bump. A
malformed subject is therefore not a style problem — it silently produces the
wrong release, which is why `ci.yml` rejects one.

The mapping lives in `cliff.toml`: `commit_parsers` decides the changelog
section, `[bump]` decides the version.

| Subject | Changelog section | Bump while `0.x` | Bump at `1.0`+ |
|---|---|---|---|
| `feat:` | Added | minor | minor |
| `fix:` | Fixed | patch | patch |
| `perf:` | Performance | patch | patch |
| `refactor:` | Changed | patch | patch |
| `revert:` | Reverted | patch | patch |
| `docs:` `test:` `build:` `ci:` | own sections | patch | patch |
| `chore(deps):` | Dependencies | patch | patch |
| `feat!:` or `BREAKING CHANGE:` footer | Breaking | **minor** | **major** |
| `chore:` `style:` | hidden | none | none |

Note the `0.x` column: while the version is below `1.0`, a breaking change
bumps the *minor*, per SemVer. That changes the day `1.0.0` ships.

**Breaking, here, means data.** A change to an HKDF `info` string, a KDF
parameter default, an AAD layout or a serialized format makes existing vaults
undecryptable. That is a breaking change even when the Rust API is untouched,
and it must carry `!` or a `BREAKING CHANGE:` footer.

## Two levels of version

The **product version** is the git tag. It moves on any releasable change
anywhere in the repo, and it is what a GitHub release is named after.

Each **component** carries its own version, which moves only when that
component's shipped artifact changes:

| Component | Version lives in |
|---|---|
| `pw-crypto-core` | `pw-crypto-core/Cargo.toml` |
| `extension` | `extension/package.json`, copied into `manifest.json` at build |
| `server` | `server/package.json`, copied into the image and reported at boot |

All three come from the same commits and the same tags, computed by
`scripts/component-versions.sh`: a component that changed since the last tag
takes the version being cut, and one that did not keeps the version of the
release that last carried it — the earliest tag containing its most recent
change.

That rule replaced a path-filtered `git cliff --bumped-version`, which was
quietly wrong. Filtering the history to one component also filters out the
`chore(release)` commits the tags sit on, so every release since that
component's last change vanished from the filtered view and the answer came
back a version or more behind. The core and the extension were spared only
because the release commit happens to write their manifests; the server, which
it did not, resolved to `v0.17.0` for code that shipped in `v0.18.0`.
The release job writes them **before** it tags, so a tagged tree states the
truth about what it contains.

A component's paths cover everything that lands in its artifact, not just its
own directory. The extension bundles the crypto core as wasm, so a core-only
change moves the extension's version too — otherwise two different builds
would claim to be the same version. The server is the opposite case: it stores
ciphertext and never opens it, so it bundles no crypto core and its paths are
exactly `server/**`.

A component that ships an artifact but is not in this table has no version at
all — its manifest keeps whatever it was scaffolded with, and a deployed build
cannot say what it is. That was true of the server between phase 3 and
`v0.19.0`; check this table when a new component lands.

One consequence: component numbers share the product's tag stream, so
`extension 0.3.1` can ship inside product `v0.3.2`. The versions stored in the
tree are the answer to "what is in this release"; the release notes carry the
same table. Give components their own tags (`extension-v0.3.1`) when one needs
a release cadence of its own.

Never edit either version by hand — the next release overwrites both.

## Release flow

1. Open a PR. `gate` and `commit-messages` run on it.
2. Merge into `main`. `gate` runs again on the merge commit.
3. Only if it passes, `release` computes the next version with
   `git cliff --bumped-version`.
4. If nothing since the last tag is releasable — only `chore:` and `style:` —
   the job exits quietly. Otherwise it writes the component versions (see "Two levels of version"),
   commits them as `chore(release): ... [skip ci]`, tags `vX.Y.Z` on that
   commit, pushes both, and cuts a GitHub release with notes generated from
   the commit subjects.

**Merging two PRs close together starts two release jobs**, and the slower one
would be rejected when it pushes, because `main` has moved. The concurrency
group does not prevent this — it serialises the jobs, not the branch. The job
therefore checks whether `main` has moved past the commit it was started for
and stands aside if so. Nothing is lost: git-cliff computes from the last tag,
so the newer run's release contains the older one's commits too. A skipped
release job with "main has moved past …" in its log is working as intended.

Because the release is cut straight from `main`, **the commit message is the
last chance to catch a mistyped change** — there is no release PR to review
before the tag lands. A key-derivation change typed as `fix:` releases as a
patch. Get the subject right in the PR.

There is deliberately **no `CHANGELOG.md`** in the repo: the GitHub Releases
page is authoritative, and a committed copy would either go stale or force CI
to push commits back to `main`. Regenerate one whenever it is useful:

```bash
git cliff -o CHANGELOG.md     # full history
git cliff --unreleased        # what the next release would contain
```

The product version lives only in git tags. Component versions *are* written
into `Cargo.toml` and `package.json` by the release job — see "Two levels of version" — and must
not be edited by hand.

## Branch protection

`main` is **not** protected server-side. GitHub gates both classic branch
protection and rulesets behind a paid plan for private repositories, and this
repo is private on a free account — both API endpoints return
`403 Upgrade to GitHub Pro or make this repository public`.

Standing in for it, two hooks in `.githooks/`:

- **`pre-commit`** refuses to commit while `main` is checked out, catching the
  mistake at the moment it happens rather than at push time.
- **`pre-push`** refuses direct pushes and force-pushes to `main`, letting
  branches and tags through so CI can still push release tags.

Both are guard rails on one machine, not controls — `--no-verify` walks past
either, which the contribution rules forbid. Neither runs in CI, because hooks only fire when
`core.hooksPath` is set and a fresh checkout never sets it; that is what
leaves the release job free to make its own `chore(release):` commit on
`main`. Enable them after cloning:

```bash
git config core.hooksPath .githooks
```

**When the repo goes public** (or gets a Pro plan), replace it with the real
thing. The check names below are exact — a typo means the check never matches
and every PR blocks forever:

```bash
gh api -X PUT repos/rustiqz/Vaultiq/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["fmt · clippy · test · wasm", "conventional commits"]
  },
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "enforce_admins": false,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Two traps in that payload:

- **`required_approving_review_count` must be 0** while this is a solo
  project. GitHub forbids approving your own PR, so any higher number locks
  you out of your own repository.
- **Never require `Tag and release`.** It only runs on push to `main`, never
  on a PR, so requiring it leaves every PR waiting on a check that cannot
  arrive.

## Other settings that are not in this repo

- **Settings → Actions → General → "Allow GitHub Actions to create and
  approve pull requests"** is enabled. Releases no longer need it, but leave
  it on.
- The default `GITHUB_TOKEN` does not trigger workflows on PRs it creates. Not
  currently relevant — releases are cut directly rather than via a PR — but it
  matters if that ever changes.
