---
description: Show a one-line Cost Guard snapshot — today vs daily budget and month-to-date vs target, with a 🟢/⚠️/🛑 flag.
disable-model-invocation: true
---

Show the user their current Cost Guard snapshot.

Execute this with the Bash tool exactly as written:

```bash
node "$(ls -t "$HOME"/.claude/plugins/cache/cost-guard/cost-guard/*/scripts/guard.mjs 2>/dev/null | head -1)" snapshot
```

Then show the command's stdout to the user **verbatim** (a single line). Do not summarise, reformat, or add commentary. If the command produces no output, tell the user the cost-guard plugin may not be installed or that ccusage found no usage data yet.
