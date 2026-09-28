# Issues remaining

Known issues found during the audit and not fixed in the time available. Details and evidence for
each task are in `AUDIT.md`.

## Pending verification
- **Full E2E run after all merges.** Unit tests (522 passing, 3 skipped), typecheck, lint and build
  are green, and CI passes. E2E has not yet run against the merged code. Task 1 changes the login
  flow (clients now use the API-issued session token), so it is the main E2E risk. Run with
  `pnpm test:e2e` and a fixed `GRPC_JWT_SECRET` (see Task 1 below).

## Bugs found by new tests (skipped with `// BUG:` in `apps/api/src/services/admin.service.test.ts`)
- `listUsers`: a search term plus a role filter drops the search term, because each filter replaces
  the previous `where` instead of combining with `and()`.
- `listUsers`: `total` counts every user and ignores the filters, so pagination totals are wrong.
- `listReports`: a type filter plus a status filter drops the status filter (same cause).
  `getAuditLogs` uses the same pattern and is probably affected too (untested).
- `banUser` doesn't check whether the user is already banned: a second ban overwrites
  `bannedAt`/`bannedBy` and writes a second audit row. `unbanUser` doesn't check the user is banned.

## Task 1: Credentials & trust
- **Dormant accounts keep legacy hashes** until they log in. Proposed: a one-off script that
  replaces each legacy hash with `scrypt(sha256hex)` (no plaintext needed), which
  `verifyPassword` recognises.
- **Dev secret:** without `GRPC_JWT_SECRET` the API uses a random per-process secret, so every API
  restart (including `tsx watch` reloads) logs everyone out. Set a fixed value locally and for E2E.
  Production refuses to start without it.
- **Leaked secret:** the old hard-coded default JWT and cookie secrets must be treated as leaked and
  rotated in any real deployment.
- **No revocation:** tokens are 7-day bearer tokens. Logout is client-side only; a stolen token for
  an active user stays valid until expiry. Needs a token version column or a denylist.
- **Plaintext gRPC:** the server binds `0.0.0.0` without TLS (`apps/api/src/grpc/server.ts`).
  Bind privately or use TLS/mTLS in production.
- No rate limiting on login.
- `jsonwebtoken` is now an unused dependency in both client apps.

## Task 2: Query performance
- `getUserPosts` has no `LIMIT`. Adding pagination changes the API, so it needs a versioned rollout.
- Client-side N+1: `BookmarkButton` calls `getBookmarkStatus` once per rendered post. Fix by
  returning `isBookmarked` on post responses (API change).
- The profile page re-fetches follower/following counts and follow status that `getUser` already
  returns (client change).
- No indexes on `likes.post_id`, `comments.post_id`, `posts.author_id`, `bookmarks.user_id` (DB
  tuning, out of scope for this task).

## Task 3: Error handling & observability
- `userId` is never set in log lines: `setUserId` exists but the auth middleware doesn't call it yet.
- A temporary bridge maps the auth middleware's plain-`Error` messages to UNAUTHENTICATED /
  PERMISSION_DENIED. Remove it once the middleware throws the typed errors.
- `{success:false, error}` handlers still return raw messages for unexpected errors; masking them
  breaks existing tests that assert arbitrary messages.
- Task 1 logs a failed password rehash with `console.error` instead of the structured logger.

## Task 4: Test infrastructure
- Remaining E2E specs still share seeded users: move follow/unfollow (`profile.comprehensive`),
  bookmark toggles, and notification "mark all" onto `loginAsNewUser`.
- Admin E2E specs ban and delete `.first()` rows or user id `1` while the user suite runs against
  the same DB. They should act only on data they create.
- Replace the remaining `if (await x.isVisible())` guards (40 user, 166 admin) with real assertions.
  Expect some real failures when these are removed.
- `auth.comprehensive.spec.ts:8` truncates `uniqueId()` to its timestamp, so parallel registrations
  can collide.
- No DB reset before E2E: `scripts/test-e2e.sh` should start the API on a freshly migrated and
  seeded throwaway DB via `DATABASE_URL`.
- `apps/api/tests/setup.ts` hand-copies the schema; build it from `db/migrations/*.sql` instead.
  Set `isolate: true` explicitly in `apps/api/vitest.config.ts`.
- `@vitest/coverage-v8` isn't installed, so the configured coverage reports fail.

## Task 5: Build pipeline
- E2E is not in CI yet. Add a job gated on `verify` that installs Playwright browsers and seeds a DB.
- `test:e2e` depends on `build`, but Playwright runs `vite dev`, so that build is wasted.
- A committed `routeTree.gen.ts` can go stale. Add `git diff --exit-code '**/routeTree.gen.ts'`
  after the CI build.
- The pre-commit typecheck takes about 15-30s on a cold package. Consider moving it to pre-push.
- The API `build` inherits `noEmit`, so it emits nothing (`start` runs `tsx`).
- Both clients hard-code TanStack devtools ports (42069 and 42070), so two copies of an app can't
  run at once.
- README Quick Start tells newcomers to run `db:generate` (only needed after schema edits) and lists
  `eve@test.com`, which the seed doesn't create (it creates `admin_old` and `moderator`). `SETUP.md`
  is correct.
- Playwright 1.58 on Ubuntu 26.04 needs `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` to
  install browsers.
