# Cost Guard for Claude Code

A Claude Code plugin that keeps your spend on a budget. It **blocks prompts once you exceed a daily or monthly limit** and shows an optional **live burn status line**. It reads your spend from [`ccusage`](https://github.com/ryoppippi/ccusage) over your local transcripts — **no API key, no network beyond ccusage, no telemetry**.

> Cost data comes from your own machine's transcripts, not the Anthropic billing API (which needs an org Admin key and lags ~5 minutes). This measures *your* usage in real time.

## What it does

- **Budget block** — a `UserPromptSubmit` hook refuses a prompt (before it reaches the model) once today's spend hits the daily budget, or month-to-date hits the monthly target.
- **80% warning** — as you approach the limit, the status line turns amber and the model is quietly told to be economical.
- **Live status line** (optional) — `🟢 [Opus] sess $0.42 · today $16.15/$190 (8%) · month $16/$4000 (0%)`.
- **On-demand report** — `node .../guard.mjs report` prints today vs budget, month-to-date, run-rate projection, and the last 7 days.

## Requirements

- Claude Code with plugin support.
- Node.js ≥ 18 (bundled with Claude Code's toolchain on most setups).
- `ccusage` — used automatically. If it is not on your `PATH`, the plugin falls back to `npx -y ccusage@latest`.

## Install

```
/plugin marketplace add <owner>/claude-cost-guard
/plugin install cost-guard@cost-guard
```

On enable you will be prompted for the budget settings (monthly target, working days, warn %, hard-block on/off, cache TTL). Restart Claude Code for the hook to take effect.

## Configuration

All settings are plugin `userConfig` — set at enable time, changeable later via `/plugin`:

| Setting | Default | Meaning |
|---|---|---|
| Monthly budget (USD) | `4000` | Block once month-to-date reaches this |
| Working days per month | `21` | Daily budget = monthly / this (use `30` for calendar-day pacing) |
| Warn threshold (%) | `80` | Status line turns amber past this % of the daily budget |
| Block when over budget | `on` | Off = warn only, never block |
| Cache TTL (seconds) | `120` | How long ccusage results are cached between recomputations |

## The status line (manual step)

Claude Code plugins **cannot set the main status line** (a plugin may only contribute the `agent` and `subagentStatusLine` settings keys). The status-line script ships with the plugin, but you opt in by adding this to your **`~/.claude/settings.json`**, pointing at your installed plugin path:

```jsonc
{
  "statusLine": {
    "type": "command",
    "command": "node \"$HOME/.claude/plugins/cache/cost-guard/plugins/cost-guard/scripts/guard.mjs\" statusline"
  }
}
```

The exact cache path is shown by `claude plugin details cost-guard`. The budget-block hook works with no manual step; only the status line is opt-in.

## When you are blocked

The prompt is refused with a message that tells you where you stand. To keep working the same day:

- create the file named in the message (`~/.claude/plugins/data/cost-guard-cost-guard/.override-YYYY-MM-DD`), **or**
- run once with `COST_GUARD_OVERRIDE=1`, **or**
- set *Block when over budget* to off in `/plugin` (warn-only).

## Safety

- **Fails open.** Any error — ccusage missing, bad JSON, timeout — results in *allow*. A fault can never lock you out of Claude Code.
- **No network** beyond invoking ccusage; **no `eval`**; ccusage reads usage metadata only — transcript contents are never read or transmitted.
- **State** (cache, override markers) is written only to the plugin's `CLAUDE_PLUGIN_DATA` directory.
- **Blocking is explicit and reversible**, with the escape hatches above.

## Cross-platform

The logic is a single Node script (`scripts/guard.mjs`) using only built-ins — it runs on macOS, Linux, and Windows. No bash, no `stat`, no Python.

## License

MIT — see [LICENSE](./LICENSE).
