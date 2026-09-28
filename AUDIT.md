# Audit findings

Baseline before any change: `pnpm build`, `pnpm typecheck` and all 257 unit tests pass
(api 138, client-user 38, client-admin 15, ui 66). `pnpm lint` **fails** (15 errors in
client-user), and the API plus four packages were never linted at all.

## Task 5: Build pipeline & developer experience

| # | Finding | Severity | Status |
|---|---|---|---|
| 5.1 | `db:*` tasks cached by turbo, so seed/migrate can silently do nothing | High | Fixed |
| 5.2 | Runtime env vars stripped by turbo strict env mode | Medium | Fixed |
| 5.3 | `dev` does not generate protos first | Medium | Fixed |
| 5.4 | API and 4 packages have no `lint` script; lint already red | Medium | Fixed |
| 5.5 | `lint` waits on `^build` it does not need | Low | Fixed |
| 5.6 | No CI, no pre-commit hook, no setup guide | Medium | Fixed |
| 5.7 | Playwright `reuseExistingServer: true` runs E2E against any app on the port | Medium | Fixed |
| 5.8 | Root `test:e2e` orphans the API process | Low | Fixed |
| 5.9 | API `build` emits nothing; API tests excluded from typecheck | Low | Partly fixed (tests typechecked) |
| 5.10 | `typecheck` fails on a fresh clone (generated proto code and route trees missing) | High | Fixed |
| 5.11 | Shared config changes (tsconfig base, `biome.json`) don't bust the cache or count as affected | Medium | Fixed |
| 5.12 | `test:e2e` cacheable, so a stale pass can be replayed | Medium | Fixed |
| 5.13 | `pnpm clean` relies on brace expansion that `/bin/sh` (dash) lacks | Low | Fixed |
| 5.14 | `nitro` tracks `nitro-nightly@latest` | Low | Fixed |

**5.1 Cached db tasks.** `turbo.json` declared `db:generate/migrate/seed` as `{}`, which is
cacheable. Proven: delete `apps/api/chirp.db`, run `pnpm db:seed`; turbo replays the cached
"Database seeded successfully!" log in 133 ms and no database exists. Side-effecting tasks must
never be cached. Fix: `cache: false` on all three, and `db:seed` now `dependsOn: ["db:migrate"]`
so a fresh clone needs one command.

**5.2 Env stripping.** turbo 2 defaults to `envMode: strict` (confirmed with `--dry=json`), which
passes only declared variables. `DATABASE_URL`, `GRPC_JWT_SECRET`, `SESSION_SECRET`, etc. never
reached `dev`/`db:*`/`test:e2e`, so apps silently fell back to hard-coded defaults, including
secrets. Fix: `globalPassThroughEnv`. Pass-through (not `env`) because they are read at runtime,
not inlined by the build, so they must not bust the build cache. Verified by migrating and seeding
a scratch DB through `DATABASE_URL`.

**5.3 Dev ordering.** `dev` had no `dependsOn`, so on a fresh clone the apps start without
`packages/proto/generated`. Now `dependsOn: ["^build"]` (the proto package's build is
`proto:generate`; cached after first run).

**5.4 Lint coverage.** Added `lint` to api, db-schema, grpc-client, proto, shared-types. Fixed the
errors instead of relaxing rules: unused catch binding (api), assignment-in-expression rewritten to
`matchAll` (same behaviour), one format fix. Eight `useExhaustiveDependencies` errors are
load-on-mount effects whose loader is re-created each render; Biome's autofix (add the loader to the
deps) would refetch in an infinite loop, so each has a targeted `biome-ignore` with the reason. The
proper cure is moving these loads to route loaders / React Query, which is a refactor, not a
tooling fix. `NotificationItem` keeps `role="button"` on a div because it contains mention links,
which a `<button>` cannot nest.

**5.5** Biome reads source only; dropping `^build` makes lint and the hook fast.

**5.6 CI / hook / guide.**
- `.github/workflows/ci.yml`: frozen-lockfile install, then lint, typecheck, unit tests, build as
  separate steps (first failure stops the job). PRs use `turbo --affected` (changed packages plus
  dependents vs the base branch, needs `fetch-depth: 0`); pushes to main run everything with the
  turbo cache restored. Concurrency cancels superseded runs.
- `.githooks/pre-commit`, enabled by the root `prepare` script (no new dependency): Biome on
  staged files only, then typecheck of affected packages (cache makes unchanged ones free).
- `SETUP.md`: under 50 lines.

**5.7 Server reuse.** Both Playwright configs set `reuseExistingServer: true`. Any process on
:3000/:3002 (seen here: an unrelated Next.js app on :3000) was silently tested instead of Chirp.
Fix (`a418962`): `reuseExistingServer: !process.env.CI`. A health path unique to the app would
also protect local runs.

**5.8 Orphaned API.** `pnpm test:e2e` killed the `pnpm` wrapper PID, not the `tsx` child, leaving
the API on :3001; it also waited forever for an API that never came up, and one app's failure
cancelled the other. Fix (`a418962`): `scripts/test-e2e.sh` kills the whole process tree on exit
(process groups need a TTY, which CI lacks, so it walks the tree with `pgrep`), gives up after 60s
without a healthy API, and runs turbo with `--continue`.

**5.9 API build and test typecheck.** API test files were excluded from `tsconfig`, so test code
was never typechecked; this hid a type error in `tests/setup.ts` behind `as any`. Fix
(`a418962`): `apps/api/tsconfig.test.json`, used by the API `typecheck` script, and `setup.ts` now
uses `db.$client`. Not fixed: API `tsc` still inherits `noEmit: true`, so `build` is a typecheck
and `dist/` never exists (harmless: `start` runs `tsx`).

**5.10 Fresh-clone typecheck.** The first CI run failed. `packages/proto` re-exports git-ignored
generated code, but its `typecheck` only waited for dependencies' builds, never its own
`proto:generate`; the client apps import `routeTree.gen.ts`, which was git-ignored and only
written by `vite build`/`dev`. Local runs passed because both were left over from earlier builds.
Fix (`27e1bc5`): `packages/proto/turbo.json` makes proto's typecheck depend on its own build, and
both `routeTree.gen.ts` files are committed (as TanStack Router recommends) and excluded from
Biome. Making the root `typecheck` depend on `proto:generate` was tried first and rejected: it ran
protoc twice concurrently, which raced on the first-run protoc download (`ETXTBSY`).

**5.11 to 5.14** (`a418962`). Every package now declares `@chirp/typescript-config`, which fixes
both the cache hash and `--affected` for shared config changes (`globalDependencies` alone does
not fix `--affected`); lint inputs include `biome.json` and CI lints the whole repo with
`biome ci`. `test:e2e` is `cache: false`. `clean` spells its paths out. `nitro` is pinned to the
version already in the lockfile.

E2E is kept out of CI for now: it needs Playwright browsers, a seeded DB and the three servers.
Next step is a separate job gated on the verify job; 5.7 and 5.8, which it depended on, are fixed.

## Task 3: Error handling & observability

### What was there

No gRPC status codes were set anywhere and nothing was logged. Every thrown error surfaced as
`INTERNAL` with the raw message (including DB/driver text) in `details`. Handlers used five
different strategies:

| Strategy | Behaviour | RPCs |
|---|---|---|
| A. field error | catch, return `{ success: false, error: e.message \|\| fallback }` with status OK | auth register/login; posts create/update/delete; comments create/delete; likes toggle x2; follows toggle; bookmarks toggle; users updateProfile; notifications markAsRead/markAllAsRead/delete; admin ban/unban/updateUserRole/deleteUser/deletePostAdmin/deleteCommentAdmin/reviewReport (22) |
| B. swallow | catch everything, return a default (`false`, `0`, `[]`); failures invisible | bookmarks getBookmarkStatus/getBookmarkedPosts; follows getFollowStatus/getFollowerCount/getFollowingCount; likes getPostLikeStatus/getCommentLikeStatus; notifications getNotifications/getUnreadCount (9). `auth.validateSession -> {valid:false}` is intended and untouched |
| C. raw throw | no try/catch; everything `INTERNAL` | feed getHomeFeed; admin listUsers/getUserDetails/listReports/getReport/getDashboardStats/getAuditLogs; users getUser |
| D. optional auth + raw throw | bad token ignored, service errors `INTERNAL` | posts getPost/getPosts/getUserPosts; comments getPostComments; feed getExploreFeed; search searchPosts/searchUsers |
| E. re-wrap | `throw new Error(e.message)` loses class and stack | auth getCurrentUser |

### Taxonomy (`apps/api/src/errors.ts`)

| Error class | gRPC code | Client sees | Used for |
|---|---|---|---|
| `InvalidArgumentError` | INVALID_ARGUMENT | message | content required / too long, invalid role, reply to a reply, follow yourself |
| `UnauthenticatedError` | UNAUTHENTICATED | message | "Invalid email or password" |
| `PermissionDeniedError` | PERMISSION_DENIED | message | "Account banned: ...", "You can only ...", "Unauthorized" |
| `NotFoundError` | NOT_FOUND | message | every "... not found" |
| `AlreadyExistsError` | ALREADY_EXISTS | message | email exists, username taken |
| `FailedPreconditionError` | FAILED_PRECONDITION | message | edit window expired, cannot ban/delete admin users |
| `InternalError` / any other `Error` / non-Error | INTERNAL | "Internal server error" (original logged) | bugs, DB failures |

Temporary bridge: `middleware/auth.ts` still throws plain `Error`s, so the classifier maps their
exact messages ("Invalid or expired session token", "Authentication required" -> UNAUTHENTICATED;
"Admin access required", "Super admin access required" -> PERMISSION_DENIED) and does not mask
them. Remove once the middleware throws typed errors.

### Tracing and logging design

- `grpc/with-tracing.ts` wraps every handler in `server.ts` (`adaptService(X, withTracing(X, h))`),
  so handlers and their direct-call unit tests are unchanged, and `ctx` may be undefined.
- Trace id: incoming `x-trace-id` (then `x-request-id`) if it matches `^[\w.-]{1,128}$`, else
  `crypto.randomUUID()`. Returned as the `x-trace-id` response header, in trailers on success and
  in the error metadata on failure, so a user-reported failure can be looked up by id.
- The id lives in `AsyncLocalStorage` (`observability/context.ts`); every `logger` call anywhere in
  the request's async chain carries `traceId`, `method` and (once set via `setUserId`) `userId`.
- `observability/logger.ts`: one JSON line per event to stdout, `LOG_LEVEL` env (default `info`,
  `silent` under Vitest), injectable sink for tests, never throws on bad fields.
- Exactly one summary line per RPC; OK at info, client errors at warn, INTERNAL at error with stack;
  `success: false` bodies logged as `outcome: "soft_failure"` at warn with the body unchanged.
  Handlers additionally log the error they caught (`handler_caught_error` for strategy A,
  `handler_swallowed_error` for strategy B) with its class and code.

```json
{"ts":"2026-09-28T12:00:00.000Z","level":"warn","msg":"rpc","traceId":"3f0c...","method":"chirp.posts.PostsService/GetPost","code":"NOT_FOUND","outcome":"error","durationMs":2.4,"errorClass":"NotFoundError","errorMessage":"Post not found"}
```

### Contract guarantees

- Response shapes, swallow defaults and every message string are byte-identical. Strategy A still
  passes through any `Error`'s message (`errorMessage(e, fallback)`) and uses the same fallbacks.
- Services throw typed errors with the same messages, so `toThrow("msg")` tests and the E2E
  text regexes still match.

### What changed on the wire

Only thrown paths (C, D, E): status is now the specific code instead of `INTERNAL`; unexpected
errors no longer leak their message (now "Internal server error"). No client reads gRPC status
codes today (they surface `message`/`error`), so this is safe. Every response gains an
`x-trace-id` header.

### Follow-ups

- Migrate `middleware/auth.ts` to `UnauthenticatedError`/`PermissionDeniedError`, call
  `setUserId` there, then delete the legacy message bridge.
- Surface the `x-trace-id` in client error toasts so users can quote it.
- Strategy A returns raw messages for unexpected errors inside a `success: false` body; switch it
  to mask non-`AppError`s once handler tests stop asserting arbitrary messages.
- Strategy B endpoints should eventually throw on non-auth failures instead of returning defaults.
## Task 2: Query performance

**Anti-pattern (N+1).** List endpoints fetched a page of rows, then ran per-row queries inside
`Promise.all(rows.map(...))`. The worst case was a `getPostCounts` helper copy-pasted into
`posts.service.ts`, `feed.service.ts` and `search.service.ts`: two `count(*)` queries plus an
"is liked" lookup for every post. `getBookmarkedPosts` also fetched each post separately (4 per row).
Every page load paid one database round trip per row, so cost grew linearly with page size.
Severity: High (the home feed, profile and bookmarks pages are the hottest paths).

**Fix.** `apps/api/src/services/post-hydration.ts` holds the shared post projection and
`hydratePosts(rows, viewerId?)`: three batched queries run in parallel (like counts and comment
counts via `inArray` + `GROUP BY`, and the viewer's likes for the page), mapped back in the original
order with the same `|| 0` / `false` fallbacks. No viewer query for anonymous requests; no queries at
all for an empty page. `getBookmarkedPosts` is now one `bookmarks -> posts -> users` join with the
original `ORDER BY bookmarks.created_at DESC`, limit and offset; bookmarks whose post is gone are
still dropped. Every `ORDER BY` is unchanged, so ties (timestamps are whole seconds) resolve as before.

**Measured** on the seeded database, viewer alice, by counting statements sent to the libsql client
(HEAD vs this change, same data). JSON output of every measured call is identical before and after.

| Call (rows returned) | Before | After |
|---|---|---|
| `getHomeFeed` (10) | 32 | 5 |
| `getUserPosts` (11) | 35 | 5 |
| `getBookmarkedPosts` (10) | 41 | 4 |
| `getExploreFeed` / `getPosts` (10) | 31 | 4 |
| `searchPosts` (15) | 46 | 4 |
| `getPostComments` (2 top-level, 1+3T+2R) | 7 | 4 |
| `getUserNotifications` (6) | 9 | 3 |
| admin `listUsers` (7) | 16 | 4 |
| admin `listReports` / `getAuditLogs` (4) | 6 | 3 |
| **Home page** (`getCurrentUser` + feed) | 33 | 6 |
| **Profile page** (user, posts, current user, 2 counts, follow status) | 47 | 17 |
| **Bookmarks page** (`getCurrentUser` + bookmarks) | 42 | 5 |

After the change every call above is constant in the number of rows.

**Fixed sites:** `getHomeFeed`, `getExploreFeed`, `getPosts`, `getPost`, `getUserPosts`,
`searchPosts`, `getBookmarkedPosts`, `getPostComments`, `getUserNotifications`, admin `listUsers`,
`listReports`, `getAuditLogs`. **Checked, not N+1:** `getUser`, `getUserDetails`,
`getDashboardStats` (fixed number of queries; could be merged, low value).

**Preventing reintroduction.** `countQueries(fn)` in `apps/api/tests/helpers.ts` counts the
statements a call sends. `tests/post-lists.test.ts` and `tests/list-enrichment.test.ts` pin the exact
response shape (ordering, counts, `isLiked`, null vs undefined, key order) and assert that each list
call issues the same number of queries for 10 and 20 rows, under a small bound. A per-row query
fails those tests. The rule is also written at the top of `post-hydration.ts`.

**Follow-ups (out of scope, not changed):**
- `getUserPosts` has no `LIMIT`; a prolific user returns every post. Adding pagination changes the
  API contract (proto + client), so it is left for a separate change. Its `inArray` lists also grow
  with the post count (SQLite allows 32766 bound parameters).
- Client side: `BookmarkButton` calls the API once per rendered post to get bookmark status; the
  profile page fetches follower/following counts separately although `getUser` already returns them.
- Missing indexes on `likes.post_id`, `comments.post_id`, `posts.author_id`, `bookmarks.user_id`
  (schema/migration change). Batching cut the number of queries; indexes would cut the cost of each.
- Task 1 adds one primary-key user lookup per authenticated request, which adds 1 to each
  page-level count above.

## Task 1: Credentials & trust

| # | Finding | Severity | Status |
|---|---|---|---|
| 1.A | Passwords stored as `sha256(password + "salt")`, no per-user salt, no work factor; ban status leaked before password check | Critical | Fixed |
| 1.B | API trusts JWTs minted by the client apps with a public default secret; role/username taken from the token; no DB check | Critical | Fixed |
| 1.C | Moderators can change roles, including promoting themselves to admin | High | Fixed |
| 1.D | gRPC bound to `0.0.0.0` with `createInsecure()` (no TLS) | Medium | Documented |

Line numbers refer to the code before the fix.

**1.A Password storage.** `apps/api/src/services/utils.ts:13-25` hashed every password as
`sha256(password + "salt")` hex and compared with `===`. The constant salt means equal passwords
give equal hashes (all seeded `password123` users share one hash) and one GPU pass cracks the
whole table; the seeded `password123` / `admin123` / `mod123` fall to a dictionary instantly.
`apps/api/src/services/auth.service.ts:71-78` also checked `bannedAt` before the password, so
anyone knowing an email learned "Account banned: <reason>".
Fix: scrypt from `node:crypto` (no new dependency) with a random 16-byte salt per hash, stored
as `scrypt$N$r$p$salt$hash` (N=2^14, r=8, p=1, 64-byte key) so cost can be raised later, compared
with `timingSafeEqual`. Malformed hashes never verify. Login now verifies the password first and
only then reports a ban (unchanged message for the rightful owner); unknown emails run a dummy
scrypt verify so response time does not reveal which emails exist.

**1.B Client-minted tokens.** `apps/api/src/middleware/auth.ts:4` and both
`apps/client-*/src/lib/grpc.server.ts:6` fell back to the same hard-coded
`GRPC_JWT_SECRET`. Each client signed its own token with a role of its choosing
(`createGrpcSessionToken`, `createAdminGrpcSessionToken`); `validateSessionToken` returned
`userId/username/role` straight from the payload; `requireAdmin` trusted that role. Proven: a
token signed with the public default claiming `role: "admin"` for a user that does not exist was
accepted by `AdminService.ListUsers`. Bans and demotions were ignored until token expiry, and
`jwt.verify` pinned no algorithm, issuer or audience. The token the API already issues at login
was thrown away by the clients. Cookie `SESSION_SECRET`s also had hard-coded defaults.
Fix:
- Only the API signs tokens. Clients store the API-issued `sessionToken` in their encrypted
  session cookie and forward it. Neither client imports `jsonwebtoken` or holds the JWT secret any
  more (the now-unused dependency is still listed in both clients' `package.json`).
- Sign/verify pinned to `HS256`, issuer `chirp-api`, audience `chirp-clients`.
- `validateSessionToken` is now async and loads the user on every call: missing or banned users
  are rejected, and `username`/`role` come from the database, so demotions and bans take effect
  immediately.
- `GRPC_JWT_SECRET` (API) and `SESSION_SECRET` (clients) are required, 32+ chars, when
  `NODE_ENV=production` (startup fails otherwise). In development the API uses a random
  per-process secret with a warning; sessions reset when the API restarts.

**1.C Role changes.** `apps/api/src/grpc/handlers/admin.handler.ts:134-137` gated
`updateUserRole` with `requireAdmin`, which admits moderators. `updateUserRole` in
`admin.service.ts` now loads the acting user's role from the database and requires `admin`
("Super admin access required").

**Migration and rollout.**
- Passwords: rehash on login. Legacy hex hashes still verify (constant-time); on the first
  successful login the hash is replaced with scrypt. A failed rewrite is logged and never blocks
  the login. Existing seeded databases keep working with no manual step; a fresh `db:seed` writes
  scrypt directly. Optional follow-up (not implemented): a one-off script that wraps every dormant
  legacy hash as `scrypt(sha256hex)` under a distinct prefix, so the weak hashes stop existing at
  rest without needing plaintext; after that, delete `legacySha256Hash`.
- Secrets: the old default JWT and cookie secrets are public and must be treated as leaked.
  Production must set fresh `GRPC_JWT_SECRET` (API only) and `SESSION_SECRET` (each client).
- Sessions: tokens minted by clients and cookies without a `sessionToken` are rejected, so
  every user is logged out once and signs in again. No schema change.

**Residual.** 1.D: `apps/api/src/grpc/server.ts:45` binds `0.0.0.0` with insecure credentials,
so session tokens cross the network in clear text. Should bind to a private interface or use
TLS / a service mesh in production. Session tokens are 7-day bearer tokens with no revocation
list; logout is client-side only (the DB lookup makes bans and demotions effective, but a stolen
token for an active user stays valid until expiry). No rate limiting on login.

## Task 4: Test infrastructure & coverage

**Baseline.** API unit tests pass in random order (3 shuffled runs, 138/138): each file gets its own
in-memory libsql DB (`apps/api/tests/setup.ts`) wiped before every test. Clean E2E baseline (own
ports, DB copy): client-user 98 passed / 2 failed and client-admin 171 passed / 2 failed at the
point it was stopped; all 4 failures were the first tests of the run, timing out during Vite's cold
compile. After all changes, a full run on a freshly seeded database passed 539 of 539 (user app 201,
admin app 338).

**Isolation problems found**
- *E2E shared mutable users (root cause of flakiness).* `fullyParallel: true` with default workers,
  and 58 of 66 logins use the seeded `alice`. Specs mutate her bookmarks and follows
  (`profile.comprehensive.spec.ts:99-126`, `bookmarks.comprehensive.spec.ts`) while others assert
  on them. The suite papered over this with `if (await x.isVisible())` guards (40 in client-user,
  166 in client-admin) and always-true expects, e.g. the bookmarks empty-state test commented
  "Other parallel tests may add bookmarks ... test still passes".
- *Admin specs mutate data the user suite logs in with*: they ban `.first()` user or user id `1`
  and delete the first posts (`moderation.workflow.spec.ts:82-410`, `audit.comprehensive.spec.ts`),
  concurrently with the user suite, against the same DB, with no reset between runs.
- *Unique id truncated*: `auth.comprehensive.spec.ts:8` does `user_${uniqueId()}`.substring(0, 20),
  keeping only the epoch seconds, so same-second registrations collide across workers.
- *API tests*: the schema is hand-copied DDL, not the migrations, so it will drift. Isolation relies
  on Vitest's implicit `isolate: true` (13-16 failures with `--no-isolate`). `tests/setup.ts` read
  an export the real module does not have, hidden by `as any` (fixed in Task 5).
- *Helpers* expose only the fixed seeded users (`TEST_USERS`), with no way to make an isolated user
  and no DB reset, which steers every new test toward shared state. `loginAs` hides Vite error
  overlays with CSS, which can mask real server errors.

**Fixed**
- `loginAsNewUser(page)` in `apps/client-user/tests/e2e/fixtures/test-helpers.ts` registers a unique
  user through the real form. The bookmarks empty-state test now uses it and asserts unconditionally
  (previously it could pass without asserting anything).
- Coverage: added 274 API tests (138 -> 409 passing, plus 3 skipped as real bugs; 528 passing
  across the whole repo):
  - services: admin (every mutation also checks its audit-log row), notifications, search, users,
    mentions, and the post edit-window expiry error path;
  - handlers: bookmarks, feed, follows, notifications, search, users (success, bad token, service
    failure, and the per-method error strategy they use today);
  - plus Task 1 (password, auth middleware, role change) and Task 2 (output shape + query-count
    guards) tests.
- Bugs found by the new tests, left `it.skip` with `// BUG:` (`admin.service.test.ts`), not fixed:
  admin `listUsers` drops the search term when a role filter is also given; its `total` ignores
  filters; `listReports` drops the status filter when a type filter is given.

Remaining isolation work is listed in `ISSUES_REMAINING.md`.
