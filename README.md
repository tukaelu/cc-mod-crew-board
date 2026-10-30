# crew-board

A Claude Code mod that shows the plan and the subagents working on it: a progress band above the prompt and a crew panel beside the chat.

- **Band**: the plan's title, a progress bar (done tasks, with launched tasks as a faint layer and a tick per planned task), the phase and count, the percentage and a mendako mascot. The crew-size button opens the panel; ✕ hides the band.
- **Crew panel** (`/crew` toggles it, `/crew open` only opens it): running, finished and planned subagents with steps, elapsed time, model and effort, context fill, tokens and estimated cost.

## Tools it adds

- `mcp__crew-board__progress`: the main session reports the plan (title, tasks with `subagent_type` and `after`, a free-text phase, done count, `finished`). A call from a subagent is ignored.
- `mcp__crew-board__step`: a subagent reports its own steps (`done`, `total`, `note`). A run that does not report shows its context fill in grey instead.

Cost is an estimate from token counts and a built-in price table (`PRICES` in `hooks/register.tsx`, list prices as of 2026-10). Only a model whose id, version included, is in the table is priced; any other shows `—`, and the panel's total then carries a `+` as a floor.

## Install

```
/plugin install crew-board --marketplace tukaelu/cc-mod-crew-board
```

## Step reports

Each subagent's brief gets one request at its end to report steps with `mcp__crew-board__step`, and a line saying to skip it silently if the tool is missing. It is added only to built-in agents and your own agents (types without `:`), never to a plugin's agents (`plugin:agent`), and not to an agent whose file in `.claude/agents/` or `~/.claude/agents/` gives `tools:` without the step tool. `stepInclude` adds plugin agent types; `stepExclude` (default `Explore`) removes any type, such as agents from `--agents` or managed settings.

## Settings

Set in `/config`: `language` (`auto`, `en`, `ja`), `autoOpen` (`plan`, `any`), `stepInclude` and `stepExclude` (comma-separated agent types).

## License

MIT. Portions derived from claude-kit by johnnyvizz (MIT License).
