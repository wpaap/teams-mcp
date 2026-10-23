# CLAUDE.md

## Branches and remotes

- `summit` is the branch we run internally, not `main`. Work on `summit` unless the
  task is an upstream PR.
- `origin` is our fork (`wpaap/teams-mcp`), `upstream` is
  `floriscornel/teams-mcp`. Our fork's `main` is the head branch of upstream PR #98.

## Keep SUMMIT.md current

`SUMMIT.md` lists every way `summit` differs from `upstream/main`, and why. Any
commit on `summit` that adds, changes or removes such a difference must update
`SUMMIT.md` in the same commit: the row in the table, the "Known gaps" section,
and after a sync the "Last synced" line. Follow the sync procedure in `SUMMIT.md`
when merging upstream (merge, never rebase: `summit` is shared).

## Upstream PRs are public

Work that goes to `floriscornel/teams-mcp` must be generic:

- No references to Summit, our tenant, our internal setup, or individual people.
- Author and commit with the GitHub noreply address
  (`131682607+wpaap@users.noreply.github.com`), not a company email.
- Prefer proposing generic improvements upstream before carrying them on `summit`.

## Checks

Run before committing: `npx tsc --noEmit`, `npm run lint`, `npm test`. Upstream
enforces 80% coverage (`npm run test:coverage`). See "Known gaps" in `SUMMIT.md`
for where `summit` falls short.
