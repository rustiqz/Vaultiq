## What and why

<!-- Why this change is needed. The diff already shows what changed. -->

## Checks

- [ ] The checks in CONTRIBUTING.md pass for every component touched
- [ ] Tests cover the change, including failure cases
- [ ] No secrets, `.env` files, vault exports, database dumps or personal vault data are included (I reviewed `git diff --staged`)
- [ ] `SECURITY.md` is updated if this changes what is defended against
- [ ] Commit subjects follow Conventional Commits; a change to a key-derivation input, AAD layout or serialized format is marked `!`
- [ ] A new dependency has a stated reason below, and is pinned to an exact version

## Not verified

<!-- Anything you could not check, such as a real device or browser. Say so plainly. -->
