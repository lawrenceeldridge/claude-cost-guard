---
description: Show the Cost Guard burn report — today vs daily budget, month-to-date vs target, run-rate projection, and the last 7 days.
disable-model-invocation: true
---

Run the Cost Guard burn report for the user.

Execute this with the Bash tool exactly as written:

```bash
node "$(ls -t "$HOME"/.claude/plugins/cache/cost-guard/cost-guard/*/scripts/guard.mjs 2>/dev/null | head -1)" report
```

Then show the command's stdout to the user **verbatim** in a code block. Do not summarise, reformat, recompute, or add commentary — just display the report as printed. If the command produces no output, tell the user the cost-guard plugin may not be installed or that ccusage found no usage data yet.
