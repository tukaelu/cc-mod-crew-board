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
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  tokens: number
  /** null once any of the run's usage was on a model the price table lacks. */
  costUsd: number | null
  steps: number
  round: number
  /** Self-reported by the subagent through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
}

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  autoOpenedFor: string
}

declare module 'claude-code' {
  interface PluginState {
    'crew-board': {
      flow: Flow | null
      agents: AgentRun[]
      panel: Panel
      now: number
    }
  }
}
