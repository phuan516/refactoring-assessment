# Developer setup

## Prerequisites
- Node 24 (CI uses 24; 22 LTS also works)
- pnpm 9.15 (`corepack enable` picks the version from `package.json`)

## First run
```bash
pnpm install          # also enables the git pre-commit hook (.githooks/)
pnpm db:seed          # applies migrations, then seeds test data into apps/api/chirp.db
pnpm dev              # generates protos, then starts API :3001, user app :3000, admin :3002
```
Test logins: `alice@test.com / password123`, admin `admin@chirp.com / admin123`.

## Everyday commands
| Command | What it does |
|---|---|
| `pnpm lint` / `pnpm lint:fix` | Biome lint + format check / auto-fix |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Unit tests (Vitest, in-memory DB, no seed needed) |
| `pnpm test:e2e` | Builds, starts the API, runs Playwright for both apps |
| `pnpm build` | Production build of every package |

Add `--affected` to any turbo command (e.g. `pnpm exec turbo run test --affected`)
to run only packages changed versus `main` plus their dependents.

## Reset the database
```bash
rm -f apps/api/chirp.db*
pnpm db:seed
```
`db:*` tasks are never cached by turbo, so they always really run.

## Quality gates
- **Pre-commit hook**: Biome on staged files (~2s) + typecheck of affected packages (~15s for an API change, ~0s when cached).
  Bypass only in an emergency with `git commit --no-verify`; CI will still catch it.
- **CI** (`.github/workflows/ci.yml`): on every PR runs install (frozen lockfile), lint,
  typecheck, unit tests and build, as separate steps that stop at the first failure.

## Troubleshooting
- Missing `generated/*` imports: run `pnpm proto:generate` (normally done by `dev`/`build`).
- Hook not running: `git config core.hooksPath .githooks`.
