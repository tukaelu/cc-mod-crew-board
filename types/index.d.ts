export type PlannedTask = {
  title: string
  type: string
  after: number[]
}

export type Flow = {
  title: string
  total: number
  done: number
  running: number
  /** Free text from the orchestrator; '' when none was reported. */
  phase: string
  isFinished: boolean
  tasks: PlannedTask[]
  /** Started by an Agent launch with no plan reported; it finishes itself when its runs end. */
  isAdHoc?: boolean
}

/** `aborted`: stopped before it answered (by the person, say), not a failure. */
export type AgentStatus = 'running' | 'done' | 'failed' | 'aborted'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  /** The Agent description with any leading `#N ` taken off. */
  description: string
  /** The plan's task this run works on (1-based), from `#N ` or a title match. */
  taskNo?: number
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  tokens: number
  steps: number
  round: number
  /** The context-fill toast was shown for this run. */
  isCtxWarned?: boolean
  /** Self-reported by the subagent through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  /** The latest step notes, oldest first; the last is the current one. */
  stepNotes?: string[]
}

/** The main session's loop, kept for its own card. */
export type MainAgent = {
  /** A model turn of the main loop is running. */
  isTurn: boolean
  turnStartedAt: number
  /** Foreground Agent calls of the main loop still waiting for their subagent. */
  agentCalls: number
  /** Permission prompts and questions put to the person that are up, any loop's. */
  asks: number
  model: string
  contextTokens: number
  steps: number
}

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  autoOpenedFor: string
}

declare module 'claude-code' {
  // The mod's own tools, registered at session.start: inputs as the model may send them.
  interface McpToolInputs {
    'mcp__crew-board__progress': {
      title?: string
      total?: number
      done?: number
      phase?: string
      finished?: boolean
      tasks?: { title?: string; subagent_type?: string; after?: number[] }[]
    }
    'mcp__crew-board__step': { done?: number; total?: number; note?: string }
  }

  interface PluginState {
    'crew-board': {
      flow: Flow | null
      agents: AgentRun[]
      main: MainAgent
      panel: Panel
      now: number
    }
  }
}
