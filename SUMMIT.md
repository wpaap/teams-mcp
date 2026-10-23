# Summit fork notes

The `summit` branch is the source we run internally. It tracks
[`floriscornel/teams-mcp`](https://github.com/floriscornel/teams-mcp) `main` (the
`upstream` remote) and adds a few changes of our own. This file lists every way
`summit` differs from upstream, why, and what to do with each difference on the next
upstream sync.

**Rule:** a commit that adds, changes or removes a difference from upstream also
updates this file. Generic improvements go upstream as a PR first.

Last synced with upstream: `b01182d` (1.0.1), 2026-10-22.

## Differences from upstream

| # | Change | Why | Files | Upstream status | On next sync |
|---|--------|-----|-------|-----------------|--------------|
| 1 | `authenticate --interactive` (auth code + PKCE, loopback redirect) and `ENTRA_SETUP.md` | Our tenant blocks device code sign-in through Conditional Access | `src/index.ts`, `ENTRA_SETUP.md`, `README.md`, `package.json` | Our PR [#98](https://github.com/floriscornel/teams-mcp/pull/98), open | Once merged, take upstream's `index.ts`/`ENTRA_SETUP.md` and keep only #2 and #3 on top |
| 2 | `TEAMS_MCP_AUTHORITY` (full authority URL) via `src/config.ts` | Existing team configs set it; upstream only has `TEAMS_MCP_TENANT_ID` | `src/config.ts`, `src/index.ts`, `src/services/graph.ts` | Summit-only | Keep. Can be dropped once every config uses `TEAMS_MCP_TENANT_ID` |
| 3 | Token cache locking across processes, atomic writes, `TEAMS_MCP_CACHE_PATH` | Parallel sessions/worktrees corrupted the shared cache | `src/msal-cache.ts`, `src/config.ts`, `src/__tests__/msal-cache.test.ts` | Ported from [#103](https://github.com/floriscornel/teams-mcp/pull/103) (skysbsb), open. **Deviation:** a lock we cannot take falls back to unlocked access with a warning instead of throwing | If #103 is merged, take upstream's version and re-apply the fallback only if we still want it |
| 4 | Channel announcements: `send_channel_message` with `announcementImagePath` / `announcementTitle` (banner) | Release posts in our Releases channel | `src/tools/teams.ts`, `src/utils/attachments.ts`, tests, `README.md` | Summit-only, not proposed | Keep, or offer upstream as a PR |
| 5 | Load jsdom on first use instead of at import | Server startup went from ~1.8s to ~0.7s | `src/utils/markdown.ts` | Summit-only, not proposed | Keep; a good candidate for an upstream PR |
| 6 | Lockfile bumps for security advisories (mcp sdk, hono, source-map-js) | `npm audit` showed runtime advisories | `package-lock.json` | Upstream has Dependabot PRs open | On conflict, take upstream's lockfile, run `npm install`, then `npm audit --omit=dev` |

Earlier differences that are now in upstream, so no longer differences: owner role and
`add_chat_member` (upstream #94), channel message `subject` (upstream #88).

## Known gaps

- PR #98 has review fixes that are not in `summit` yet: the Conditional Access hint
  that depends on which flow failed, and owner-only writes of
  `~/.msgraph-mcp-auth.json` via `writeOwnerOnly`. Port them, or take them with the
  upstream merge of #98.
- Branch coverage is 78%, below upstream's 80% threshold, because the locking code
  in `src/msal-cache.ts` (#3) is not fully tested. `npm run test:coverage` fails on
  `summit` until it is.

## Syncing with upstream

1. `git fetch upstream`, then `git log --oneline summit..upstream/main` to see what is new.
2. Check the "Upstream status" column above: has any of our changes been merged
   upstream in the meantime?
3. Merge, never rebase: `summit` is shared, so `git merge upstream/main` on `summit`.
4. Resolve conflicts with the table above: keep upstream's version of anything that
   has landed upstream, and keep our version only for the rows marked summit-only.
5. Run `npm ci`, `npx tsc --noEmit`, `npm run lint` and `npm test`; for dependencies
   also `npm audit --omit=dev`.
6. Update this file: the "Last synced" commit and date, and any rows that changed status.
7. Check the result: `git diff --stat upstream/main summit` should only show the files
   listed in the table.
