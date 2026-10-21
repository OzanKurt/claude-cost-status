# claude-cost-status

A Claude Code mod that puts your spend in the status line, including in the Claude desktop app's Code tab, where a `statusLine` command from `settings.json` is not drawn.

```
cost: $1.19 session | $239.01 today | $7,296.48 month
```

- **session**: the current session's cost, as Claude Code's own `/cost` totals it.
- **today** and **month**: summed from every transcript under `~/.claude/projects`, across all sessions and projects, in your local time zone.

No `ccusage` or other dependency is needed; it only uses Node.js, which Claude Code already requires.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install cost --marketplace OzanKurt/claude-cost-status
```

From a shell:

```bash
claude plugin install cost --marketplace OzanKurt/claude-cost-status
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `OzanKurt/claude-cost-status`, then Add plugin.

Answer `y` to add the marketplace, then pick a scope (user scope makes it active in every session).

## How it works

- `hooks/register.ts` refreshes the status line when a session starts, after each turn and every 30 seconds.
- `scripts/totals.cjs` runs in the background for the session's life. It scans this month's transcripts once at start, then every 30 seconds reads only the bytes appended since. Claude Code logs one response once per content block, so each response is counted once, by its largest usage line (deduplicated on message id and request id).
- Costs are computed from token counts with the per-model prices in `scripts/totals.cjs` (input, output, 5-minute and 1-hour cache writes, cache reads). A model missing from that table counts as $0 until it is added.

The totals cover Claude models only. Usage from other tools (such as Codex) that `ccusage` also reports is not included.

## License

MIT
