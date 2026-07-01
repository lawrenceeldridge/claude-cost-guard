---
description: Before a big task, show your live burn rate — spend so far, $/hr, projected block total, models in use, and a Sonnet/Opus recommendation.
disable-model-invocation: true
---

Show the user their Cost Guard live-burn quote.

Execute this with the Bash tool exactly as written:

```bash
node "$(ls -t "$HOME"/.claude/plugins/cache/cost-guard/cost-guard/*/scripts/guard.mjs 2>/dev/null | head -1)" quote
```

Then show the command's stdout to the user **verbatim** in a code block. Do not summarise, reformat, recompute, or add commentary — just display it as printed. If the command produces no output, tell the user the cost-guard plugin may not be installed or that ccusage found no usage data yet.
