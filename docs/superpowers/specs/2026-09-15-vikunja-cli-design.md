# vikunja CLI — Design Spec

Date: 2026-09-15
Status: Approved design, pending implementation plan

## 1. Goal

A command-line tool, `vikunja`, that lets AI agents running in Claude Code on the user's Mac manage a self-hosted Vikunja instance protected by Cloudflare Access. It uses Vikunja API v2 only, covers core features (projects, tasks, labels, comments), and supports multiple identities so different agents can act as different Vikunja bot accounts. It ships as a Claude Code plugin so installation is two slash commands.

### Non-goals (v1)

Assignees, kanban views/buckets, reminders, attachments, subtasks/relations, teams/sharing, name-based lookup of labels or projects, Linux/Windows keychain support, retries, OS-level isolation between agents.

## 2. Background facts this design relies on

### Vikunja API v2 (verified 2026-09-15 against docs and try.vikunja.io v2.6.0)

- Base path `/api/v2`, introduced in v2.4.0 (2026-07-19); covers every endpoint. v1 is frozen and slated for removal in 4.0.
- Auth: `Authorization: Bearer tk_…` (API token with scoped permissions).
- Verbs: `POST` creates (201), `PATCH` partially updates, `PUT` replaces, `DELETE` returns 204.
- Lists return `{items, total, page, per_page, total_pages}` in the body; `per_page` defaults to 50.
- Errors are RFC 9457 `application/problem+json` with `title, status, detail, code, errors[]`; validation errors are 422.
- Descriptions and comments are stored as HTML; `?format=markdown` reads/writes Markdown; for `PATCH` the header `X-Vikunja-Format: markdown` is used.
- Unset dates are returned as `0001-01-01T00:00:00Z`. Dates are RFC 3339.
- OpenAPI spec: `/api/v2/openapi.json`.
- Filter syntax: `done = false && due_date < now+7d`; operators `= != < > <= >= in`, `&&`, `||`; labels/projects by numeric ID.

Endpoints used:

| Purpose | Method + path |
|---|---|
| Server info (setup check) | `GET /info` |
| Current user | `GET /user` |
| Projects | `GET /projects` (`page, per_page, q, is_archived`), `POST /projects`, `GET/PATCH/DELETE /projects/{id}` |
| Tasks | `GET /tasks`, `GET /projects/{p}/tasks` (`page, per_page, q, filter, sort_by[], order_by[]`), `POST /projects/{p}/tasks`, `GET/PATCH/DELETE /tasks/{id}` |
| Labels | `GET /labels` (`page, per_page, q`), `POST /labels`, `DELETE /labels/{id}` |
| Task labels | `POST /tasks/{id}/labels` `{label_id}`, `DELETE /tasks/{id}/labels/{label_id}` |
| Comments | `GET /tasks/{id}/comments`, `POST /tasks/{id}/comments` `{comment}` |

### Cloudflare Access

Service token requests carry `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. A rejected request gets a redirect to `*.cloudflareaccess.com`, an HTML page, or a 403 that is not `problem+json`.

### Claude Code plugins (verified against code.claude.com docs)

- A marketplace is `.claude-plugin/marketplace.json` in a repo; a plugin has `.claude-plugin/plugin.json`.
- Executables in a plugin's `bin/` are added to the Bash tool's `PATH` while the plugin is enabled.
- Skills live at `skills/<name>/SKILL.md`; `allowed-tools: Bash(vikunja tasks *)` pre-approves matching commands.
- Unverified, checked during implementation: that `bin/` files need the git executable bit and that a `#!/usr/bin/env node` shebang works (§9, plugin check).

## 3. Architecture

```
vikunja_cli/                              (git repo = marketplace + source)
├── .claude-plugin/marketplace.json       one plugin entry, source "./plugin"
├── plugin/                               what Claude Code installs
│   ├── .claude-plugin/plugin.json        name "vikunja", version, description (no userConfig)
│   ├── bin/vikunja                       esbuild bundle, #!/usr/bin/env node, +x, committed
│   └── skills/vikunja/SKILL.md           agent instructions + allowed-tools
├── src/
│   ├── cli.ts                            commander setup, dispatch, exit codes
│   ├── config.ts                         resolves URL, CF credentials, token/profile
│   ├── keychain.ts                       Keychain interface + `security`-backed implementation
│   ├── client.ts                         HTTP: headers, errors, pagination, markdown format
│   ├── output.ts                         JSON printing, trimming, date normalization
│   ├── dates.ts                          --due parsing
│   └── commands/
│       ├── setup.ts, profile.ts, whoami.ts
│       └── projects.ts, tasks.ts, labels.ts, comments.ts
├── test/                                 vitest unit tests + bundle freshness test
├── scripts/smoke.ts                      opt-in live test
├── README.md                             install + setup instructions
└── package.json, tsconfig.json, build script
```

Rules:

- Runtime: Node ≥ 20 (built-in `fetch`, `AbortSignal.timeout`). The only runtime dependency is `commander`, bundled into `bin/vikunja`. Nothing is installed at plugin-install time.
- `commands/*` never build HTTP requests or touch the Keychain directly. They call `client.ts` and `config.ts`.
- `client.ts` is the only module aware of Cloudflare, auth headers, pagination, error formats and markdown format parameters.
- `keychain.ts` exports an interface (`get(account)`, `set(account, secret)`, `delete(account)`); tests use an in-memory fake.
- `client.ts` takes an injected `fetch` so tests can supply a fake.

## 4. Configuration and identities

### Storage

- **macOS Keychain**, service `vikunja-cli`:
  - `cf:client-id`, `cf:client-secret`
  - `profile:<name>`: Vikunja API token for that profile
- **`~/.config/vikunja-cli/config.json`** (mode 600, non-secret):
  `{ "url": "https://vikunja.example.com", "default_profile": "me", "profiles": { "me": { "username": "trung" } } }`
- Keychain access goes through `/usr/bin/security`. Reads: `find-generic-password -s vikunja-cli -a <account> -w`. Writes use `security -i` with the command sent on stdin, so secrets never appear in process arguments. Add uses `-U` to update an existing item.

### Resolution

Each non-token value: environment variable first, then stored value; if missing, exit 3 naming the value and the command that sets it.

| Value | Env var | Stored in |
|---|---|---|
| Vikunja URL | `VIKUNJA_URL` | config.json `url` |
| CF client ID | `CF_ACCESS_CLIENT_ID` | Keychain `cf:client-id` |
| CF client secret | `CF_ACCESS_CLIENT_SECRET` | Keychain `cf:client-secret` |

The Vikunja token is chosen by the first rule that applies:

1. `--as <name>` flag: Keychain `profile:<name>`. If `VIKUNJA_PROFILE_LOCK=1` is set, `--as` is rejected with exit 2 ("profile is locked for this session").
2. `VIKUNJA_PROFILE` env var: Keychain `profile:<name>`.
3. `VIKUNJA_API_TOKEN` env var: that raw token; profile name reported as `(env)`.
4. `default_profile` from config.json.
5. None: exit 3, "no profile configured; run `vikunja profile add <name>`".

A named profile with no Keychain item gives exit 3, "profile `<name>` not found".

`VIKUNJA_PROFILE_LOCK` is a guardrail against mistakes, not a security boundary.

### Intended usage per agent type

- **Separate sessions:** `VIKUNJA_PROFILE=planner VIKUNJA_PROFILE_LOCK=1 claude`, or the same keys in a project's `.claude/settings.local.json` `env` block.
- **Subagents/teammates in one session:** the agent definition says "run every vikunja command with `--as reviewer`".
- **Main session:** the default profile.

### Setup and profile commands (run by the user, not agents)

- `vikunja setup`: prompts for URL, CF client ID, CF client secret (secret input hidden when stdin is a TTY; line-based read otherwise), stores them, then calls `GET /api/v2/info` to confirm Cloudflare lets the request through. Reports success or the Cloudflare/network error.
- `vikunja profile add <name>`: reads the token (hidden prompt on a TTY; first line of stdin otherwise, e.g. `pbpaste | vikunja profile add reviewer`), calls `GET /user` with it, and only if that succeeds stores the token and records the username in config.json. The first profile added becomes the default.
- `vikunja profile list`: `{"items":[{"name","username","default"}]}`. Never prints tokens.
- `vikunja profile default <name>`, `vikunja profile remove <name>` (removes the Keychain item and config entry; if it was the default, the default is cleared).
- No command ever outputs a token or the CF secret.

Profile names match `^[a-z0-9][a-z0-9_-]{0,31}$`.

## 5. Commands

All API commands accept `--as <name>` and `--full`. List commands also accept `--page N`, `--per-page N` (default 50), `--all`. Options can appear after the subcommand (for example `vikunja tasks list --as reviewer`), which the permission patterns in §8 rely on.

```
vikunja whoami

vikunja projects list    [--archived] [--search Q]
vikunja projects get     <id>
vikunja projects create  --title T [--description MD] [--parent ID]
vikunja projects update  <id> [--title T] [--description MD]
vikunja projects archive <id>
vikunja projects unarchive <id>
vikunja projects delete  <id> --yes

vikunja tasks list    [--project ID] [--filter EXPR] [--search Q] [--sort FIELD:asc|desc]... [--include-done]
vikunja tasks get     <id>
vikunja tasks create  --project ID --title T [--description MD] [--due DATE] [--priority 0-5]
vikunja tasks update  <id> [--title T] [--description MD] [--due DATE|none] [--priority 0-5]
vikunja tasks done    <id>
vikunja tasks undone  <id>
vikunja tasks delete  <id> --yes

vikunja labels list   [--search Q]
vikunja labels create --title T [--color HEX]
vikunja labels delete <id> --yes
vikunja labels add    <task-id> <label-id>
vikunja labels remove <task-id> <label-id>

vikunja comments list <task-id>
vikunja comments add  <task-id> --text MD
```

Behavior details:

- **projects list:** `--archived` sends `is_archived=true` (includes archived projects).
- **projects archive/unarchive:** `PATCH /projects/{id}` with `{"is_archived": true|false}`.
- **tasks list:** uses `GET /projects/{p}/tasks` when `--project` is given, else `GET /tasks`. With neither `--filter` nor `--include-done`, sends `filter=done = false`. With `--filter`, the expression is sent as-is and no implicit done filter is added. `--sort due_date:asc` (repeatable) becomes paired `sort_by[]`/`order_by[]`; without `--sort` no sort parameters are sent.
- **tasks create:** `POST /projects/{p}/tasks`.
- **tasks update / done / undone:** `PATCH /tasks/{id}` with only the given fields (`done/undone` send `{"done": true|false}`). `update` with no field options exits 2.
- **Priority:** integer 0–5 (0 unset, 1 low, 2 medium, 3 high, 4 urgent, 5 do now); other values exit 2.
- **`--due`:**
  - `YYYY-MM-DD`: 23:59:59 local time on that date.
  - ISO datetime with offset: sent as given.
  - ISO datetime without offset: interpreted as local time.
  - `none` (update only): sends `"due_date": null`. The smoke test (§9) confirms the server clears the date. If v2 rejects `null`, the implementation sends `0001-01-01T00:00:00Z` instead, and the unit test is updated to match.
  - Anything else exits 2.
- **Markdown:** every request for projects, tasks and comments includes `format=markdown`; `PATCH` requests also send `X-Vikunja-Format: markdown`.
- **Deletes** without `--yes` exit 2 with "refusing to delete without --yes".
- **labels add/remove:** `POST /tasks/{id}/labels` `{label_id}` / `DELETE /tasks/{id}/labels/{label_id}`.
- **`--all`:** follows `total_pages` until done or 5,000 items collected; if truncated, the output includes `"truncated": true`.

## 6. Output

- Success: exactly one JSON document on stdout, newline-terminated.
- Lists: `{"items": [...], "page": 1, "per_page": 50, "total_pages": 3, "total": 120}`. With `--all`: `{"items": [...], "total": 120}` plus `"truncated": true` when capped.
- Records are trimmed unless `--full` is given (then the raw API object is printed, with date normalization still applied):

| Resource | Trimmed fields (list) | Added in `get`/`create`/`update` |
|---|---|---|
| project | `id, title, parent_project_id, is_archived` | `description` |
| task | `id, title, done, project_id, due_date, priority, labels[{id,title}]` | `description, created, updated, done_at, created_by` (username) |
| label | `id, title, hex_color` | — |
| comment | `id, author` (username), `created, comment` | — |

- `whoami`: `{"profile": "reviewer", "user_id": 7, "username": "bot-reviewer", "url": "https://…"}`.
- `delete`: `{"deleted": true, "id": 12}`. `labels add/remove`: `{"task_id": 5, "label_id": 3, "added": true}` / `"removed": true`.
- Date normalization: any value equal to `0001-01-01T00:00:00Z` becomes `null`.

## 7. Errors and exit codes

Errors: exactly one JSON document on stderr, `{"error": {"status": 404, "title": "…", "detail": "…", "errors": [...]}}` (`status` and `errors` present when applicable). Nothing is printed to stdout.

| Exit | Meaning |
|---|---|
| 0 | Success |
| 1 | API error (`problem+json` or other non-2xx), network failure, 30 s timeout |
| 2 | Usage error: bad/missing arguments, invalid date/priority, delete without `--yes`, `--as` under lock |
| 3 | Config/auth: missing config, unknown profile, Cloudflare Access rejection, Vikunja 401 |

Detection in `client.ts`:

- Requests use `redirect: "manual"`. A 3xx whose `Location` host ends in `cloudflareaccess.com`, any `text/html` response, or a 403 without `application/problem+json` gives exit 3, "Cloudflare Access rejected the request — check the service token (vikunja setup)".
- A 401 gives exit 3, "Vikunja token for profile `<name>` is invalid or expired".
- No automatic retries.

## 8. Plugin packaging and skill

`.claude-plugin/marketplace.json`:

```json
{
  "name": "vikunja-cli",
  "owner": { "name": "trung" },
  "plugins": [
    { "name": "vikunja", "source": "./plugin", "description": "Vikunja CLI for agents (API v2, Cloudflare Access, multi-profile)" }
  ]
}
```

Install (local path now; GitHub `owner/repo` works the same once pushed):

```
/plugin marketplace add /Users/trung/Code/vikunja_cli
/plugin install vikunja@vikunja-cli
```

Then, in a regular terminal: `vikunja setup` and `vikunja profile add <name>` for each account. The README documents how to call the bundled binary before `bin/` is on the shell's PATH (`~/.claude/plugins/.../bin/vikunja` or `node plugin/bin/vikunja` from the repo).

`plugin/skills/vikunja/SKILL.md`:

- Frontmatter:
  - `description`: use when the user or instructions involve Vikunja tasks, projects, labels or comments.
  - `allowed-tools`: `Bash(vikunja whoami) Bash(vikunja whoami *) Bash(vikunja projects *) Bash(vikunja tasks *) Bash(vikunja labels *) Bash(vikunja comments *)`. `setup` and `profile` are deliberately not pre-approved, so they prompt.
- Body sections:
  1. Identity: if your instructions name a Vikunja profile, append `--as <name>` to every command; run `vikunja whoami` first when unsure who you are acting as.
  2. Command reference (§5) with one example each.
  3. Filter syntax cheat sheet.
  4. Output and exit codes (§6–7).
  5. Rules:
     - Look up IDs with `list` before acting.
     - Check `labels list` before creating a label, to avoid duplicates.
     - Only use `--yes` when the user explicitly asked for deletion.
     - Never run `setup` or `profile` commands.
     - Descriptions and comments are Markdown.

Build: `npm run build` runs esbuild (`platform: node`, `target: node20`, `format: cjs`, bundle, shebang banner) into `plugin/bin/vikunja`, then sets mode 755. The git index stores the executable bit.

Versioning: `plugin.json` `version` follows semver and is bumped on each release commit.

## 9. Testing

**Unit tests (vitest, `npm test`)**, with fake `fetch`, fake Keychain, and temporary config dir and env:

- Config resolution: env over stored values; missing values give exit 3 with the right message.
- Profile selection: the four precedence rules, lock rejection, unknown profile.
- `profile add`: verifies with `GET /user` before storing; failed verification stores nothing; first profile becomes default.
- Every command: method, path, query (including `format=markdown`, implicit done filter, sort pairs), body, and headers (CF headers, Bearer, `X-Vikunja-Format` on PATCH).
- `--due` parsing cases, priority validation, delete without `--yes`.
- Output trimming, `--full`, zero-date → `null`, `--all` pagination and truncation.
- Error mapping: Cloudflare redirect, HTML, bare 403, 401, `problem+json` 422 with `errors[]`, network error, timeout.
- Bundle freshness: build into a temp file and assert it is byte-identical to the committed `plugin/bin/vikunja`.

**Live smoke test (`npm run smoke`, opt-in)**, using the stored setup and the profile in `SMOKE_PROFILE`:

1. Fetch `/api/v2/openapi.json` and assert every method and path in §2's endpoint table exists.
2. `whoami`.
3. Create project `vikunja-cli-smoke-<timestamp>`; create a task with a Markdown description and due date; update, done, undone; `--due none` clears the date; create a label, add and remove it; add and list a comment; check read-back values at each step.
4. Delete everything created (in a `finally` block).

**Plugin check (manual, once):** install from the local marketplace; in a new session confirm that `vikunja whoami` and `vikunja tasks list --as <bot>` run without a permission prompt, that `vikunja profile list` does prompt, and that the committed executable bit and `#!/usr/bin/env node` shebang work from `bin/`.
