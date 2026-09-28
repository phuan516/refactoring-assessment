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
