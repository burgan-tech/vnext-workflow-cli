# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node.js CLI (`@burgan-tech/vnext-workflow-cli`) that synchronizes local vNext workflow component definitions (JSON + embedded C# script `.csx` files) with a remote vNext API and its PostgreSQL database. There is no transpile step — the `bin/` entrypoint runs `src/` directly with CommonJS `require`.

The CLI is invoked as `workflow`, `wf`, or `vnext` (all three bins point at `bin/workflow.js`). The `vnext` alias is preferred on Windows where `wf` may clash.

## Commands

```bash
npm install            # install deps
npm link               # symlink the bins globally for local development
node bin/workflow.js   # run the CLI directly (same as `npm run dev` / `npm start`)
```

- **`build` is a no-op** (`echo 'Build not needed for now'`) — nothing to compile.
- **There is no test suite, linter, or formatter configured.** Do not invent `npm test`/`npm run lint` commands; they will fail. Verify changes by running the CLI against a real vNext project directory.

The CLI always treats `process.cwd()` as the project root and requires a `vnext.config.json` in that directory. To exercise it, `cd` into a vNext workspace (not this repo) before running.

## Two distinct config systems (do not conflate)

1. **`vnext.config.json`** — lives in the *user's project root*, read fresh each run. Defines `domain` and `paths` (which folders hold which component types). Handled by [src/lib/vnextConfig.js](src/lib/vnextConfig.js) with a single-entry cache.
2. **CLI config** — global, stored in `~/.config/vnext-workflow-cli/config.json` via the `conf` package. Holds API/DB connection settings, structured as **domain profiles** (`ACTIVE_DOMAIN` + `DOMAINS[]`). Handled by [src/lib/config.js](src/lib/config.js).

`config.js` auto-migrates the old flat config format to the domain-aware format on module load (`migrateConfig`), and exposes a virtual `PROJECT_ROOT` key that always returns `process.cwd()` (it is never persisted). `DOMAIN_NAME`, `ACTIVE_DOMAIN`, and `PROJECT_ROOT` are reserved and cannot be set via `config.set` — they have dedicated domain commands.

**Auto domain resolution:** the `preAction` hook in [bin/workflow.js](bin/workflow.js) calls `config.resolveWorkspaceDomain(cwd)` before every command *except* `domain`. It reads the `domain` field from the project's `vnext.config.json` and, if a matching CLI domain profile exists, silently switches `ACTIVE_DOMAIN` to it. This is why running a command in a project folder uses that project's connection settings without a manual `wf domain use`.

## Architecture

`bin/workflow.js` wires up Commander, registers commands, and installs the `preAction` domain-resolution + banner hook. Each command in `src/commands/` orchestrates the shared libraries in `src/lib/`:

- **discover.js** — given `vnext.config.json` `paths`, locates component folders under `componentsRoot` and globs their JSON/CSX files. Crucially, it **only scans folders declared in `paths`** and always ignores `.meta/`, `*.diagram.json`, `package*.json`, and `*config*.json`.
- **csx.js** — embeds `.csx` content into the JSON files that reference it. A `.csx` file is matched to JSON by its `location` string (e.g. `./src/Rules/MyRule.csx`), and the JSON's per-reference `encoding` field decides the form: `NAT` writes plain text, `B64`/absent writes Base64 (default). It updates *every* matching `location` in the JSON tree recursively. **CSX→JSON matching is scoped to the CSX file's own component directory** (the parent of its `src/` folder) so that same-named `.csx` files in sibling components don't cross-contaminate.
- **workflow.js** — per-component publish logic: read JSON `key`/`version`/`flow`, map the component type to a `sys-*` flow name (`workflows`→`sys-flows`, `tasks`→`sys-tasks`, etc.), check the DB, delete if present, publish.
- **db.js** — PostgreSQL access with two interchangeable backends selected by `USE_DOCKER`: a direct `pg.Client` connection, or `docker exec ... psql` shelling into a container. Queries target `"<schema>"."Instances"` where schema = the flow name with `-`→`_`. Lookups are by `Key` only (version is ignored), newest `CreatedAt` first.
- **api.js** — axios calls: `GET /health`, `POST /api/v1/definitions/publish`, `GET /api/{version}/definitions/re-initialize`. `publishComponent` carefully unwraps RFC 7807 Problem Details (`detail`, `title`, `errors`, `errorCode`, `traceId`) into a structured `apiError` for rich error display.
- **ui.js** — all console output (chalk). `LOG` helpers, the active-domain banner, and two error renderers: `printApiError` (single component, tree-style) and `printErrorSummaryTable` (batch, table with expanded validation errors). Route user-facing output through this module rather than ad-hoc `console.log`.

## Command semantics

The four sync commands differ only in their DB/existing-component behavior — keep this table consistent when editing them:

| Command | Scans | If exists in DB | If new |
|---------|-------|-----------------|--------|
| `sync`   | all components | **skip** | publish |
| `update` | git-changed files (or `--all` / `--file`) | delete + publish | publish |
| `reset`  | interactively-chosen folder | delete + publish | publish |
| `csx`    | CSX files only | n/a (no DB/API) | n/a |

`update` and `reset` re-initialize the system (`reinitializeSystem`) after a successful batch. `update`/`csx` default to git-changed files: `getGitChangedJson` / `getGitChangedCsx` run `git status --porcelain` from the **git root** (not project root), then filter results back down to `PROJECT_ROOT`.

## Conventions

- CommonJS only (`require`/`module.exports`), Node >= 14. No TypeScript, no ESM.
- Library functions take an explicit `projectRoot` argument rather than reading cwd directly; commands resolve it once via `config.get('PROJECT_ROOT')`.
- DB and API helpers swallow connection errors and return `false`/`null` rather than throwing — callers treat a missing instance as "not in DB".
