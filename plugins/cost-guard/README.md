# cost-guard (plugin)

Budget guard for Claude Code — blocks over-budget prompts and provides a live burn status line, powered by `ccusage`.

This is the plugin itself. For full documentation — install, configuration, status-line wiring, safety, and cross-platform notes — see the [repository README](../../README.md).

## Layout

```
cost-guard/
├── .claude-plugin/plugin.json   manifest + userConfig (budget settings)
├── hooks/hooks.json             UserPromptSubmit → guard.mjs gate
└── scripts/guard.mjs            portable logic: gate | statusline | report
```

## Modes

`node scripts/guard.mjs <mode>`

- `gate` — hook entry point; emits a block/warn decision as JSON.
- `statusline` — reads Claude Code's status JSON on stdin, prints the burn line.
- `report` — prints a human-readable burn report.
