# vikunja CLI

A JSON-speaking command-line tool that lets AI agents in Claude Code manage a self-hosted [Vikunja](https://vikunja.io) instance: projects, tasks, labels and comments. It uses Vikunja API v2, passes Cloudflare Access with a service token, and supports one Vikunja bot account per agent.

## Requirements

- macOS (secrets are stored in the login Keychain)
- Node.js 20 or newer on `PATH`
- Vikunja 2.4.0 or newer (API v2)
- A Cloudflare Access service token allowed by the Vikunja application's policy
- A Vikunja API token for each account the agents should use, with these permissions: `projects`, `tasks`, `labels`, `tasks_labels`, `tasks_comments`, and **Other → user**. This applies to bot-user tokens too (Settings → Bot Users), not just personal API tokens (Settings → API Tokens). A bot account only sees projects that have been shared with it, or that it creates itself.

## Install in Claude Code

```
/plugin marketplace add trunghq3101/vikunja-cli
/plugin install vikunja@vikunja-cli
```

A local checkout works the same way: `/plugin marketplace add /path/to/vikunja_cli`. Start a new Claude Code session after installing so the `vikunja` command and skill are available.

## One-time setup (in a regular terminal)

Run these yourself, not through an agent. The plugin puts `vikunja` on the PATH of Claude Code's Bash tool, not on your shell's PATH, so use the binary's full path. To find it, ask Claude Code to run `which vikunja` in an installed session, or clone this repo and use `./plugin/bin/vikunja` from the clone:

```bash
./plugin/bin/vikunja setup                   # Vikunja URL, Cloudflare client ID and secret
./plugin/bin/vikunja profile add me          # your own API token; the first profile becomes the default
./plugin/bin/vikunja profile add reviewer    # a bot account's API token
./plugin/bin/vikunja profile list
```

Secrets typed at the prompts are hidden. You can also pipe a token: `pbpaste | ./plugin/bin/vikunja profile add reviewer`. Tokens live in the Keychain under the service `vikunja-cli`; `~/.config/vikunja-cli/config.json` holds only the URL and profile names.

## Choosing an identity per agent

A command uses the first identity it finds, in this order:

1. `--as <profile>` on the command
2. `VIKUNJA_PROFILE`
3. `VIKUNJA_API_TOKEN` (a raw token, for one-off runs)
4. the default profile (`vikunja profile default <name>`)

**Subagents.** In `.claude/agents/reviewer.md`:

```markdown
---
name: reviewer
description: Reviews Vikunja tasks and leaves feedback comments.
---
You act as the Vikunja profile `reviewer`. Add `--as reviewer` to the end of every `vikunja` command.
```

**Separate sessions.** Pin a project's sessions to one bot in `.claude/settings.local.json`:

```json
{ "env": { "VIKUNJA_PROFILE": "planner", "VIKUNJA_PROFILE_LOCK": "1" } }
```

With `VIKUNJA_PROFILE_LOCK=1`, `--as` is rejected unless it names the same profile as `VIKUNJA_PROFILE`. This guards against mistakes; it is not a security boundary.

**Main session.** Uses the default profile.

## Environment overrides

`VIKUNJA_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` and `VIKUNJA_API_TOKEN` override stored values.

## Troubleshooting

| Error | Fix |
|---|---|
| `Cloudflare Access rejected the request` | Re-run `setup`; check the service token is in the Access policy and not expired |
| `` Vikunja rejected the token for profile `…` `` | The token is invalid, expired, or missing a permission for this endpoint. If the detail mentions the `user` permission, grant the token the **user** permission (Other group) in Vikunja (Settings → API Tokens, or Settings → Bot Users for bot tokens); otherwise create a new API token in Vikunja and `profile add <name>` again |
| `profile … not found` / `no profile configured` | `profile list`, then `profile add` |
| `vikunja: command not found` in Claude Code | Check `/plugin` shows `vikunja` enabled, then start a new session |

## Development

```bash
npm install
npm test               # unit tests (fake HTTP and Keychain)
npm run typecheck
npm run build          # regenerate plugin/bin/vikunja; commit it with source changes
KEYCHAIN_IT=1 npx vitest run test/keychain.darwin.test.ts   # real Keychain round trip
SMOKE_PROFILE=<bot> npm run smoke                          # live test against your instance
```
