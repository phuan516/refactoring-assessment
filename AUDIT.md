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
| 5.7 | Playwright `reuseExistingServer: true` runs E2E against any app on the port | Medium | Documented |
| 5.8 | Root `test:e2e` orphans the API process | Low | Documented |
| 5.9 | API `build` emits nothing; API tests excluded from typecheck | Low | Documented |

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

**5.7 Not fixed yet.** Both Playwright configs set `reuseExistingServer: true`. Any process on
:3000/:3002 (seen here: an unrelated Next.js app on :3000) is silently tested instead of Chirp.
Proposed: `reuseExistingServer: !process.env.CI` plus a health path unique to the app.

**5.8 Not fixed yet.** `pnpm test:e2e` kills the `pnpm` wrapper PID, not the `tsx` child, leaving the
API on :3001. Proposed: run the API in its own process group and `kill -- -$PGID`, or use a
Playwright `webServer` entry for the API.

**5.9 Not fixed.** API `tsc` inherits `noEmit: true`, so `build` is a typecheck and `dist/` never
exists (harmless: `start` runs `tsx`). API test files are excluded from `tsconfig`, so test code is
never typechecked. Proposed: a `tsconfig.test.json` included in `typecheck`.

E2E is kept out of CI for now: it needs Playwright browsers, a seeded DB and the three servers.
Next step is a separate job gated on the verify job, after 5.7/5.8 are fixed.

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
