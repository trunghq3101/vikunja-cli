---
name: vikunja
description: Manage Vikunja projects, tasks, labels and comments with the `vikunja` CLI. Use when the user or your instructions mention Vikunja, todo tasks, task comments, or acting as a Vikunja bot profile.
allowed-tools: Bash(vikunja whoami) Bash(vikunja whoami *) Bash(vikunja projects *) Bash(vikunja tasks *) Bash(vikunja labels *) Bash(vikunja comments *)
---

# Vikunja CLI

`vikunja` talks to the user's self-hosted Vikunja. Every command prints one JSON document to stdout; errors print `{"error": {...}}` to stderr.

## Identity

- If your instructions name a Vikunja profile (for example "act as `reviewer`"), add `--as <profile>` at the **end** of every command: `vikunja tasks list --as reviewer`.
- Otherwise omit `--as`; the session's profile is used.
- Unsure who you are acting as? Run `vikunja whoami`.
- "profile is locked for this session" means this session is pinned to one profile: drop `--as`.
- Never run `vikunja setup` or `vikunja profile …`. Those are for the human.

## Commands

```bash
vikunja whoami

vikunja projects list [--archived] [--search "home"]
vikunja projects get 12
vikunja projects create --title "Website" [--description "Markdown"] [--parent 3]
vikunja projects update 12 [--title "New name"] [--description "Markdown"]
vikunja projects archive 12          # unarchive 12
vikunja projects delete 12 --yes     # deletes its tasks too

vikunja tasks list                                    # open tasks in all projects
vikunja tasks list --project 12 --sort due_date:asc --sort priority:desc
vikunja tasks list --filter "done = false && due_date < now+7d"
vikunja tasks list --include-done --search "invoice"
vikunja tasks get 345
vikunja tasks create --project 12 --title "Draft post" [--description "## Notes"] [--due 2026-09-30] [--priority 3]
vikunja tasks update 345 [--title …] [--description …] [--due 2026-10-01T09:00|none] [--priority 0-5]
vikunja tasks done 345               # undone 345
vikunja tasks delete 345 --yes

vikunja labels list [--search urgent]
vikunja labels create --title urgent [--color e11d48]
vikunja labels add 345 7             # task 345, label 7
vikunja labels remove 345 7
vikunja labels delete 7 --yes

vikunja comments list 345
vikunja comments add 345 --text "Reviewed. **Looks good.**"
```

- List commands accept `--page N`, `--per-page N` (default 50, max 1000) and `--all` (up to 5000 items; `"truncated": true` when cut off).
- Any API command accepts `--full` to print the complete API object instead of the trimmed one.
- `--due`: `YYYY-MM-DD` means 23:59:59 local time that day; ISO datetimes are accepted; `none` clears the date (update only).
- Priority: 0 unset, 1 low, 2 medium, 3 high, 4 urgent, 5 do now.
- `tasks update` changes only the fields you pass.

## Filters (`tasks list --filter`)

- Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, combined with `&&` and `||`, with parentheses.
- Common fields: `done`, `priority`, `due_date`, `start_date`, `end_date`, `done_at`, `created`, `updated`, `labels`, `project`.
- Labels and projects are numeric IDs: `labels in 3, 7`, `project = 12`.
- Date math: `now`, `now+7d`, `now-1w`, `now/d` (start of day); units `s m h d w M y`.
- Passing `--filter` replaces the default "open tasks only", so add `done = false` yourself when needed.

## Output

- Lists: `{"items": [...], "page": 1, "per_page": 50, "total_pages": 2, "total": 71}`.
- Tasks: `id, title, done, project_id, due_date, priority, labels[{id,title}]`; `get`, `create` and `update` add `description, created, updated, done_at, created_by`.
- Unset dates are `null`. Descriptions and comments are Markdown.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | success | |
| 1 | API or network error | read `error.title`, `error.detail` and `error.errors`; fix the input or report it |
| 2 | bad arguments | fix the command (see `vikunja <command> --help`) |
| 3 | config or auth problem (Cloudflare, token, missing profile) | stop and tell the human; do not retry |

## Rules

- Look up IDs with `list` commands. Never guess an ID.
- Before creating a label, run `vikunja labels list --search "<title>"` and reuse an existing one.
- Only pass `--yes` when the user explicitly asked for that deletion.
- Quote arguments with spaces. Use single quotes around text containing `$` or backticks.
