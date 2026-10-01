# How I worked through the assessment

This repo is my submission for a 90-minute platform refactoring assessment. The brief is in
[`TASK.md`](TASK.md). This document explains how I approached it: the order I took the tasks in
and why, how I planned each one, what went wrong along the way, and how I dealt with it.

The detailed findings, evidence and before/after numbers are in [`AUDIT.md`](AUDIT.md). Known
issues I found but did not fix are in [`ISSUES_REMAINING.md`](ISSUES_REMAINING.md). Every commit
message also carries its own write-up: problem, severity, trigger, fix, why this approach,
compatibility, and how it was verified.

## The project and the brief

Chirp is a small social app in a pnpm + Turborepo monorepo:

- **Two React apps** (TanStack Start): a user app and an admin app.
- **A gRPC API** (Node, `@grpc/grpc-js`) backed by SQLite through Drizzle ORM.
- **Shared packages** for protobuf definitions, the gRPC client, the DB schema, shared types and
  UI components.
- **Tests:** Vitest unit tests and Playwright end-to-end (E2E) tests.

The brief named five problem areas: credential security, query performance, error handling and
tracing, test infrastructure, and the build pipeline. For each one I had to audit the code,
diagnose the root cause, fix it without breaking existing tests or API contracts, and justify the
change in writing.

## Results at a glance

| | Before | After |
|---|---|---|
| Lint | Failing (15 errors), API and 4 packages never linted | Passing across the whole repo |
| CI / pre-commit hook | None | GitHub Actions CI on every PR, fail-fast, only changed packages; pre-commit hook on staged files |
| Unit tests | 257 | 528 passing, 3 skipped on purpose (they expose real bugs, documented) |
| E2E tests | Passing, with many assertions that could not fail | 539 of 539 passing on a freshly seeded database (checked after submission) |
| Password storage | `sha256(password + "salt")` | scrypt with a per-user salt; old hashes upgraded on login |
| Admin access | Anyone who read the repo could forge an admin token | Only the API issues tokens; role and ban status read from the database on every request |
| Home feed / profile / bookmarks | 33 / 47 / 42 SQL queries per page | 6 / 17 / 5, constant as the page grows |
| Errors and tracing | Every failure reached clients as `INTERNAL`; nothing logged | Typed errors mapped to gRPC codes; a trace ID on every request and every log line |

Time: I cloned the repo at 11:01 and pushed the last commit at 12:20, 79 of the 90 minutes.

## How I worked

**I planned against 80 minutes, not 90.** The last 10 minutes were a buffer and never scheduled.
I checked the clock at each phase boundary and gave every task a budget. When a task ran over, the
rule was to write up what I had learned in `AUDIT.md` as "diagnosed, not fixed" and move on.

**I used Claude Code as a pair, with me leading.** The brief allows AI tools, so I used them the
way I would on a real team. The AI did the fast reading, searching, measuring and typing. I chose
the task order, approved each plan before any code was written, and decided what was in and out of
scope. A few ground rules held throughout:

- **Evidence before claims.** Every finding needed a file and line, and a concrete way to trigger
  it. Anything an agent reported had to be checked against the code before it went into the plan.
  Several findings were proven by actually triggering them: a forged admin token being accepted, a
  cached `db:seed` creating no database.
- **Fix the root cause, keep the diff small.** No loosening lint rules to make errors disappear, no
  drive-by refactors, and no changes to response shapes or error messages that clients and tests
  rely on.
- **Tests first where possible.** For query performance, I wrote tests pinning the exact existing
  output against the old code *before* refactoring. That way "identical responses" was proven, not
  assumed.
- **Never commit red.** Lint, typecheck, unit tests and build all had to pass before each push.
- **Never force push.** When a pushed commit turned out to be wrong, I fixed it with a follow-up
  commit rather than rewriting history.

**I used parallel agents in two phases.**

1. **Read-only audit.** Once I had set the order, I had five agents audit all five tasks at once,
   one per task. None of them could edit the repo. Each came back with findings (file and line, how
   to trigger it, root cause) and a proposed plan. That gave me a full picture of every task early,
   so I could take them one at a time without walking in cold.
2. **Parallel implementation.** Once Task 5 was in and time was getting short, Tasks 1, 2 and 3
   (plus two test-coverage agents) were implemented in parallel. Each agent worked in its own git
   worktree (an isolated copy of the repo on its own branch). Each task "owned" specific files to
   keep merge conflicts small: Task 1 the auth middleware, Task 3 the server wrapper and error
   types, Task 2 the query code. The branches were then merged into `main` one at a time, with the
   full suite run before pushing.

## Timeline

All times are local (the session started at 11:05).

| Time | What happened |
|---|---|
| 11:05 to 11:09 | Setup: install, generate protos, migrate and seed the DB, record the baseline (257 unit tests passing, build and typecheck passing) |
| 11:11 | Set the task order: 5, 4, 3, 1, then 2 |
| 11:11 to 11:14 | Planned Task 5 from evidence: lint, typecheck and build baselines, plus every package's config |
| 11:14 | Started five read-only audit agents, one per task |
| 11:17 to 11:25 | Implemented Task 5 and committed it through the new pre-commit hook |
| 11:30 | The Task 5 audit agent reported that typecheck fails on a fresh clone. I reproduced it in a clean clone: my first CI commit would be red |
| 11:39 | Started Task 4: a helper that registers a fresh E2E user, and a rewritten bookmarks test |
| 11:47 to 12:00 | CI went red on GitHub as predicted. Fixed it, hit a race condition in the first fix, re-verified in a fresh clone, pushed. CI green |
| 11:57 | Tasks 1, 2 and 3 started in parallel, each in its own worktree |
| 12:02 | Two more agents started on the remaining test-coverage gaps (tests only, no source changes) |
| 12:04 to 12:14 | Task 5 leftovers: the E2E runner script, cache fixes, API test typecheck, `pnpm clean`, pinning `nitro` |
| 12:08 to 12:19 | Merged all branches into `main`, resolved conflicts, ran the full suite, pushed |
| 12:20 | Pushed the remaining-issues write-up. Last commit |
| 12:27 to 12:36 | Started the final E2E run; time called before it finished |

## The order, and why

I chose to work in the order **5, 4, 3, 1, 2**.

- **Task 5 (build pipeline) first.** Before touching application code, I wanted the safety net
  working. Lint was already failing, half the codebase was never linted, and there was no CI. If
  the checks can't be trusted, no later fix can be trusted either. Task 5 also turned up something
  Task 1 depended on: the build tool was silently dropping secret environment variables, so the
  apps always fell back to hard-coded secrets.
- **Task 4 (tests) second.** It made sense to understand how reliable the test suite actually was
  before changing behaviour that the tests are supposed to protect. The audit showed the E2E suite
  had many assertions wrapped in "if visible" checks that could never fail. That mattered for
  judging every later change.
- **Task 3 (errors) before Task 1 (credentials).** Task 3 introduces the typed error classes (not
  found, permission denied, and so on) that the rest of the API throws. When the branches were
  merged, the login code used Task 1's logic with Task 3's error types.
- **Task 2 (queries) last.** It was the most self-contained task. The audit had already measured
  the query counts and produced a working prototype, so it was lower risk to leave until later.

In practice, the order changed once time got tight. Tasks 1, 2 and 3 ran in parallel after Task 5
and the start of Task 4, and were merged in the order that gave the fewest conflicts.

## Task by task

### Task 5: Build pipeline and developer experience

**Plan.** I started from evidence, not guesses: I ran lint, typecheck and build, and read every
package's config. The plan fixed the task graph in `turbo.json` rather than documenting manual
workarounds, got lint green by fixing the code rather than the rules, then added CI, a pre-commit
hook and a setup guide.

**What I found and fixed.**
- **The database commands were cached.** I deleted the database and ran `pnpm db:seed`. Turbo
  replayed "Database seeded successfully!" from cache in 133 ms and created nothing. Side-effecting
  tasks must never be cached.
- **Secrets never reached the apps.** Turbo's strict environment mode stripped `DATABASE_URL`,
  `GRPC_JWT_SECRET` and `SESSION_SECRET`, so the apps silently used hard-coded defaults. I passed
  them through at runtime, deliberately not as build inputs, so secrets stay out of the build cache
  keys.
- **`pnpm dev` didn't generate protobuf code first,** so it broke on a fresh clone.
- **Lint was red and incomplete.** I added lint to the API and four packages, then fixed the errors
  in the code. Eight React hook errors were load-on-mount effects. Biome's automatic fix would have
  made those pages re-fetch in an infinite loop, so each got a targeted ignore with a written
  reason instead.
- **CI** runs install (frozen lockfile), lint, typecheck, unit tests and build as separate
  fail-fast steps. On PRs it runs only the changed packages and their dependents
  (`turbo --affected`).
- **The pre-commit hook** needs no new dependency. It runs Biome on staged files (about 2 s) and
  typechecks the affected packages.
- **Leftovers, fixed later in the session:** an E2E runner script that shuts down cleanly, a
  typecheck for API test files, config changes now clearing the cache, E2E results no longer
  cached, `pnpm clean` fixed on Linux, and `nitro` pinned instead of tracking `nightly@latest`.

**Challenges.**
- **My first CI commit would have failed on a clean machine, and I didn't catch it locally.**
  Everything passed on my machine because earlier builds had left generated files behind. The audit
  agent found the problem in a fresh clone. The protobuf package was typechecked before its own
  code was generated, and the client apps imported a route file that git ignored. *How I dealt with
  it:* I reproduced it in a fresh clone first, then fixed it with a follow-up commit instead of
  rewriting history. I also committed the two route files, which TanStack recommends. From then on,
  every CI-related change was verified on a fresh clone before pushing, not just locally.
- **The first fix caused a race condition.** Making the root `typecheck` depend on proto
  generation made two copies of the protobuf compiler download at the same time on a fresh machine,
  and they collided (`ETXTBSY`). *How I dealt with it:* I moved the dependency into a small
  package-level `turbo.json`, so only proto's own typecheck waits for its generation step, and
  generation runs once.
- **Processes that don't exit cleanly.** Stopping the E2E script killed only the `pnpm` wrapper
  and left the API running. Process groups need a terminal, which CI doesn't have. *How I dealt
  with it:* the new runner script walks the process tree and kills every child on exit.

### Task 4: Test infrastructure and coverage

**Plan.** First measure how isolated the tests really are, then fix the isolation problems that
make results untrustworthy, and close the coverage gaps in the most security-critical code.

**What I found.**
- **API unit tests** were isolated, but fragilely. They passed in random order across several
  shuffled runs. But each test file's database was built from table definitions copied by hand, not
  from the real migrations, and isolation relied on a Vitest default the config never set (turning
  it off gave 13 to 16 failures).
- **E2E tests shared state.** Tests ran fully in parallel, and 58 of 66 logins used the same
  seeded user. Tests changed that user's bookmarks and follows while other tests asserted on them.
  Admin tests banned and deleted "the first user" or "the first post" while the user-app suite ran
  against the same database.
- **The suite hid the problem instead of fixing it.** 206 `if (await x.isVisible())` guards and
  several always-true assertions meant tests could pass without checking anything. One bookmarks
  test said so in a comment.
- **Coverage gaps:** six API services had no tests, including the admin service that controls bans,
  deletions and role changes. Six request handlers had no tests either.

**What I fixed.**
- **A helper that registers a fresh user** through the real sign-up form. The bookmarks
  empty-state test now uses it and asserts unconditionally.
- **171 new API tests** for the untested services and handlers (274 new API tests in total,
  counting those added in Tasks 1 to 3). Every admin action also checks that it writes an
  audit-log entry.
- **Three real bugs found by the new tests,** left as skipped tests with `// BUG:` notes rather
  than fixed out of scope: the admin user and report lists drop one filter when two are combined,
  and the user list's total ignores filters.

**Challenges.**
- **Other software on the E2E ports.** Another project of mine was already running on port 3000,
  and the Playwright configs silently reuse whatever is on the port. The E2E run would have tested
  the wrong app. *How I dealt with it:* I stopped that service, ran the baseline on separate ports
  against a copy of the database, and later made Playwright reuse servers only outside CI.
- **Playwright's browser wouldn't install** on Ubuntu 26.04. *How I dealt with it:*
  `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` (recorded in `ISSUES_REMAINING.md`).
- **Coverage agents working at the same time as the feature agents.** Tasks 1 to 3 were changing
  error types and the auth check while the new tests were being written. *How I dealt with it:* the
  new tests assert only on error messages and response shapes, which the other tasks promised to
  keep identical, never on error classes or query counts. They all still passed after the merge.
- **Not enough time to fix every isolation problem.** This was the task I left least finished.
  Only one test was moved onto a fresh user. The rest (follow/unfollow, admin ban/delete, the
  "if visible" guards, the truncated unique username) are written up with a proposed fix for each
  in `ISSUES_REMAINING.md`.

### Task 3: Error handling and observability

**Plan.** Catalogue every handler's error strategy, design one error taxonomy mapped to gRPC
status codes, then add tracing and logging in one place rather than in 49 handlers.

**What I found.** No gRPC status codes were set anywhere and nothing was logged. Handlers used five
different strategies. 22 returned `{ success: false, error }` with an OK status, passing raw
database messages to the client. 9 swallowed every error and returned a default, so "user not
found" became a follower count of 0. The rest threw raw errors, which reached the client as
`INTERNAL` even for a simple "not found".

**What I built.**
- **An error taxonomy** (`InvalidArgument`, `Unauthenticated`, `PermissionDenied`, `NotFound`,
  `AlreadyExists`, `FailedPrecondition`, `Internal`), each mapped to its gRPC code. Services throw
  these with byte-identical messages. Unexpected errors reach the client as "Internal server error"
  and the real error is logged.
- **One wrapper around every service**, applied where services are registered. It gives each
  request a trace ID (reusing a well-formed one sent by the caller), carries it through the async
  call chain so every log line includes it, and returns it to the client. It also writes one
  structured JSON log line per request with the method, status code, outcome and duration.

**Why this approach.** A wrapper at registration covers all 49 RPCs without touching any handler
body, so the existing handler unit tests stay valid. Response shapes, default values and every
error string are unchanged. Only the status code on thrown paths changed, and no client read it.

**Challenges.**
- **Test mocks would break the error classes.** Many tests mock whole service modules, which would
  have replaced the error classes with mocks too. *How I dealt with it:* the error classes live in
  their own module with no dependencies, so they stay real under mocking.
- **The auth middleware still throws plain errors.** Rewriting it here would have collided with
  Task 1, which was changing the same file. *How I dealt with it:* a small, documented bridge maps
  its exact messages to the right codes for now. Removing it is listed as a follow-up.

### Task 1: Credentials and trust

**Plan.** Two separate problems: how passwords are stored, and how the API decides who a caller
is. Both had to be fixed without locking out existing users, whose plaintext passwords we don't
have.

**What I found.**
- **Passwords** were `sha256(password + "salt")`: fast to crack, the same salt for everyone, and
  compared with a non-constant-time `===`. All seeded users with the same password shared one hash.
  Login also revealed "Account banned: \<reason\>" before checking the password.
- **Trust between apps and API was backwards.** The client apps signed their own tokens and chose
  the role inside them. The API accepted any token signed with a shared secret, and that secret had
  a hard-coded default in the public source. I proved it: a token for a user that doesn't exist,
  claiming the admin role, returned every user's email from the admin API. Bans and demotions were
  also ignored until the token expired.
- **Moderators could promote themselves to admin,** because role changes accepted "admin or
  moderator".

**What I fixed.**
- **scrypt** (built into Node, so no new dependency) with a random salt per user and the cost
  settings stored in the hash, so they can be raised later. Comparisons are constant-time. The
  password is now checked before the ban status, and unknown emails take the same time as known
  ones.
- **Migration without plaintext:** old hashes still verify and are upgraded to scrypt on the user's
  next successful login. Seeded users log in unchanged.
- **Only the API signs tokens.** The apps now store and forward the token the API already issued
  at login (it was previously thrown away). The shared secret is gone from both apps. Tokens are
  pinned to one algorithm, issuer and audience. On every request, the API loads the user's role and
  ban status from the database, so bans and demotions take effect immediately.
- **Secrets are required in production:** the API refuses to start without a strong one.
- **Only real admins can change roles,** checked against the database.

**Why this approach.** Reusing the token the API already issues removes the root cause (signing
keys held by the clients) instead of trying to protect one secret in three places. Rehashing on
login is the standard path for a password upgrade when you don't have the plaintext. For accounts
that never log in again, I documented a one-off script that wraps the old hashes in scrypt.

**Rollout notes** (also in `AUDIT.md`): the old default secrets must be treated as leaked and
rotated, and every user signs in once more after deploy, because old sessions don't carry an
API-issued token.

**Challenges.**
- **The API and both client apps had to change together,** or login would break. *How I dealt with
  it:* one commit covers all three.
- **Making the auth check async broke 36 existing test mocks** that returned plain values. *How I
  dealt with it:* I updated the mocks to return promises, with no change to what they assert.
- **One admin test asserted the exact session contents.** *How I dealt with it:* the new token is
  saved with a second session update (session updates merge), so the existing assertion didn't
  need to change.
- **Local development trade-off.** Without `GRPC_JWT_SECRET` set, the dev API makes a random
  secret each time it starts, so every reload logs everyone out. That was a deliberate choice over
  keeping a public default secret. It's documented in `ISSUES_REMAINING.md`.

### Task 2: Query performance

**Plan.** Measure the exact query counts the brief asked for, pin the current responses with tests
*before* touching the code, fix the anti-pattern with one reusable helper, and add a test that
stops it coming back.

**What I found.** A classic N+1: list endpoints fetched a page of rows, then ran extra queries for
every row (like count, comment count, "did I like this"). The helper doing it was copy-pasted into
three services. Bookmarks cost 4 queries per bookmarked post.

**What I fixed.** A shared `hydratePosts` helper loads counts and like status for a whole page in
three batched queries that run in parallel. Bookmarks became a single join. Comments,
notifications and admin lists got the same treatment.

| Page | Before | After |
|---|---|---|
| Home feed (10 posts) | 33 | 6 |
| Profile | 47 | 17 |
| Bookmarks (10 posts) | 42 | 5 |

The page totals include the one extra lookup per request that Task 1 adds.

**Why this approach.** Batching by ID keeps every existing sort order, limit and fallback exactly
as it was, so responses stay identical. A single big aggregate join would also work, but it risks
duplicated rows and changes the sort behaviour.

**Preventing it coming back.** A `countQueries` test helper counts the SQL statements a call sends.
The tests assert that each list endpoint sends the same number of queries for 10 rows as for 20.
A per-row query fails the test.

**Challenges.**
- **Proving "identical responses".** *How I dealt with it:* I wrote characterisation tests against
  the old code first, pinning ordering, counts, nulls and even key order. They passed unchanged
  after the refactor, and the JSON output of every profiled call matched the old code on the seeded
  database.
- **Task 1 changes the query counts.** Its per-request user lookup adds one query to each page.
  *How I dealt with it:* the page totals above account for it, and `AUDIT.md` says so.

## Challenges across the whole session

- **Merging five parallel branches.** Task 2 and Task 3 both added import lines to the same files,
  and I kept both. Task 1 and the coverage agent had both created an admin service test file, so
  those became two files. The trickiest conflict was the login function. *How I dealt with it:* I
  kept Task 1's order (password check, then ban check, then hash upgrade) with Task 3's error
  types, then ran the full suite before pushing.
- **The machine was overloaded.** With the E2E baseline, my dev servers and a fresh-clone CI check
  all running, the load average reached about 30, and six API tests timed out during setup. *How I
  dealt with it:* I didn't treat the timeouts as a real failure or push past them. The E2E audit
  agent had already delivered what I needed, so I stopped it and re-ran the check on a quiet
  machine, where everything passed.
- **A cleanup command crashed my dev servers.** Verifying the `pnpm clean` fix while the dev
  servers were running deleted files they were using. *How I dealt with it:* I reinstalled
  dependencies and restarted the servers. The lesson: verify destructive scripts on a scratch copy,
  never the live working tree.
- **Keeping agents in scope.** At one point, work on the Task 5 leftovers started before I had seen
  the list. I stopped it, reviewed the seven items and then approved all of them. Agents writing
  tests were told not to fix bugs they uncovered, only to skip the test with a `BUG:` note, so
  scope decisions stayed with me.

## What I'd do differently

- **Verify CI on a fresh clone before the first push,** not after. The red first CI run was
  avoidable, and it's the check I now do by default.
- **Leave more time for Task 4.** The audit was thorough, but only one isolation problem was
  actually fixed. Several of the remaining fixes are one-liners (the truncated unique username) or
  mechanical (moving mutating specs onto fresh users).
- **Run the final E2E suite earlier.** It ran last and was still going when time was called. It
  passed in full (539 of 539) when I re-ran it on a freshly seeded database after submission, but
  that should have been confirmed inside the time limit.
- **Stick more closely to "one commit per task".** Tasks 4 and 5 each ended up with three commits.
  Each is atomic and justified, but the brief asked for one per task.

## What's left

Everything I found but didn't fix is in [`ISSUES_REMAINING.md`](ISSUES_REMAINING.md), grouped by
task, with a proposed fix for each. The biggest items are the remaining E2E isolation work, the
three admin filtering bugs, token revocation, TLS on the gRPC port, and the missing pagination on
a user's post list.
