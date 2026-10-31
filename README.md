# crew-board

A Claude Code mod that shows the plan and the subagents working on it: a progress band above the prompt and a crew panel beside the chat.

- **Band**: the plan's title, a progress bar (done tasks, with launched tasks as a faint layer and a tick per planned task), the phase and count, the percentage and a mendako mascot. The crew-size button opens the panel; ✕ hides the band.
- **Crew Board panel** (`/crew` toggles it, `/crew open` only opens it): the chat's total cost, the main session's card (a mendako in a captain's cap, with its context fill), then running, finished and planned subagents as cards: the current step and the notes before it, model, context fill, tokens and elapsed time. Effort shows as the height of the seaweed beside the mendako.

The main session's card says whose move it is: **working** (●) while its turn runs; **waiting for its crew** (…) while it waits on an Agent call, or between turns while a subagent still runs (the desktop app launches every subagent in the background); **your turn** (▶) when nothing runs, and whenever a permission prompt or a question (`AskUserQuestion`, `ExitPlanMode`) is up, a subagent's prompt included.

## Tools it adds

- `mcp__crew-board__progress`: the main session reports the plan (title, tasks with `subagent_type` and `after`, a free-text phase, done count, `finished`). A call from a subagent is ignored.
- `mcp__crew-board__step`: a subagent reports its own steps (`done`, `total`, `note`). A run that does not report shows no step lines or progress bar; its context and token meters are there either way.

The cost in the panel's header is the whole chat's, as Claude Code's own ledger counts it (the `/cost` total, main session included); `—` where the host keeps none. Rows carry no cost: the engine does not report one per subagent. The header's tokens and time are the subagents' alone: their tokens summed, and the span from the first one's start to the last one's end.

## Install

```
/plugin install crew-board --marketplace tukaelu/cc-mod-crew-board
```

## Step reports

Each subagent's brief gets one request at its end to report steps with `mcp__crew-board__step`, and a line saying to skip it silently if the tool is missing. It is added only to built-in agents and your own agents (types without `:`), never to a plugin's agents (`plugin:agent`), and not to an agent whose file in `.claude/agents/` or `~/.claude/agents/` gives `tools:` without the step tool. `stepInclude` adds plugin agent types; `stepExclude` (default `Explore`) removes any type, such as agents from `--agents` or managed settings.

## Settings

Set in `/config` (in a terminal) or in `~/.claude/settings.json` under `pluginConfigs`, for example `"pluginConfigs": { "crew-board": { "options": { "showMascot": false } } }`. The fields: `showMascot` (default on; off, the band and the cards drop the mendako and give its room to the text), `language` (`auto`, `en`, `ja`), `autoOpen` (`plan`, `any`), `contextWarnPercent` (default 80), `tokenBudget` (tokens per subagent; 0, the default, turns token warnings off), `stepInclude` and `stepExclude` (comma-separated agent types).

Each subagent card has a context meter and a token meter; the main session's card has the context meter alone. A meter turns yellow past three quarters of its limit and red past it: the context's limit is `contextWarnPercent`, the tokens' is `tokenBudget`. With no budget the token meter compares each run with the one that used the most and never warns.

## License

MIT. Portions derived from [claude-kit](https://github.com/JohnnyVizz/claude-kit) by johnnyvizz (MIT License).
