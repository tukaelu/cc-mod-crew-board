import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'crew-board'
const PROGRESS = 'mcp__crew-board__progress'
const STEP = 'mcp__crew-board__step'
const pane = { title: '', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

// The engine beneath the plugin: spawns answer agent ids a1, a2, ... in order, and
// every toast and pane opening is kept.
const engine = (on: On) => {
  mock.clock(on)
  const toasts: string[] = []
  const opened: string[] = []
  let n = 0
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))
  on('turn.complete', () => ({ text: '' }) as never)
  // What the next model request reports; `request` sets it.
  const next = { model: 'claude-opus-5-5', tokens: 0 }
  on('turn.step', async function* () {
    const usage = { model: next.model, input_tokens: next.tokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    return { turnId: 'turn', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  return { toasts, opened, next }
}

const spawn = ($: Engine, description: string, subagentType = 'general-purpose') =>
  $.agent.spawn({ tool_use_id: `t-${description}`, prompt: 'p', description, subagentType, provider: 'engine', parentModel: 'claude-opus-5-5', background: false, fork: false } as never)

const end = ($: Engine, agentId: string, reason: string) =>
  ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId, reason, answer: reason === 'answer' ? 'ok' : '', usage: null })

// One model request of `agentId` whose prompt fills `tokens` of the context.
const request = async ($: Engine, next: { model: string; tokens: number }, agentId: string, tokens: number, model = 'claude-opus-5-5') => {
  Object.assign(next, { model, tokens })
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 'turn', index: 0, model, messageCount: 1, agentId })
  for await (const _ of stream) void _
}

const texts = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'crew-agents', props: pane })
  // A nested Text's words show in its parent's too; buttons carry their label.
  const all = [
    ...(await ui.findAll({ type: 'Text' })).map(el => String(el.text ?? '')),
    ...(await ui.findAll({ type: 'Button' })).map(el => String(el.props.label ?? '')),
  ]
  await ui.unmount()
  return all.join('\n')
}

const PLAN = {
  tool: PROGRESS,
  title: 'Ship it',
  tasks: [
    { title: 'Write the parser', subagent_type: 'general-purpose' },
    { title: 'Wire the CLI', subagent_type: 'general-purpose', after: [1] },
    { title: 'Review', subagent_type: 'code-reviewer', after: [1, 2] },
  ],
}

test('link: "#N " ties a run to task N and comes off the title', async ($, on) => {
  engine(on)
  await $.tool.call(PLAN as never)
  await spawn($, '#2 Hook up the command line')
  const shown = await texts($)
  expect(shown).toContain('Hook up the command line')
  expect(shown).not.toContain('#2 Hook up')
  expect(shown).toMatch(/#2 · general-purpose/)
  // Task 2 has started: only 1 and 3 are still planned.
  expect(shown).toContain('Planned · 2')
  expect(shown).toMatch(/1\. Write the parser/)
  expect(shown).not.toMatch(/2\. Wire the CLI/)
  expect(shown).toMatch(/after 1, 2/)
})

test('link: without a number the description is matched to a task title', async ($, on) => {
  engine(on)
  await $.tool.call(PLAN as never)
  await spawn($, 'write the parser')
  const shown = await texts($)
  expect(shown).toMatch(/#1 · general-purpose/)
  expect(shown).not.toMatch(/1\. Write the parser/)
})

test('link: a number the plan does not have falls back to the title', async ($, on) => {
  engine(on)
  await $.tool.call(PLAN as never)
  await spawn($, '#9 Write the parser')
  const shown = await texts($)
  expect(shown).toMatch(/#1 · general-purpose/)
  expect(shown).not.toContain('#9')
  expect(shown).not.toMatch(/1\. Write the parser/)
})

test('link: after a re-plan, runs follow their tasks to the new numbers', async ($, on) => {
  engine(on)
  await $.tool.call(PLAN as never)
  await spawn($, '#2 Hook up the command line')
  // Same plan, tasks reordered: "Wire the CLI" is now task 1.
  await $.tool.call({ ...PLAN, tasks: [PLAN.tasks[1], PLAN.tasks[0], PLAN.tasks[2]] } as never)
  const shown = await texts($)
  expect(shown).toMatch(/#1 · general-purpose/)
  expect(shown).toMatch(/2\. Write the parser/)
  expect(shown).not.toMatch(/1\. Wire the CLI/)
})

test('link: the same task run again is round 2, by number or by title', async ($, on) => {
  engine(on)
  await $.tool.call(PLAN as never)
  await spawn($, '#1 Parser')
  await end($, 'a1', 'answer')
  await spawn($, '#1 Parser, fixed')
  await spawn($, 'Loose job')
  await end($, 'a3', 'answer')
  await spawn($, 'Loose job')
  const shown = await texts($)
  expect(shown.match(/round 2/g)?.length).toBe(2)
})

test('step: a subagent reports on its own row only; the main session cannot', async ($, on) => {
  engine(on)
  await spawn($, 'First')
  await spawn($, 'Second')
  expect(await $.tool.call({ tool: STEP, agentId: 'a2', done: 1, total: 4, note: 'reading' } as never)).toMatchObject({ result: 'ok' })
  expect(await $.tool.call({ tool: STEP, done: 3, total: 3 } as never)).toMatchObject({ result: 'ignored: only subagents report steps' })
  await $.tool.call({ tool: STEP, agentId: 'a2', done: 2, note: 'writing' } as never)
  await $.tool.call({ tool: STEP, agentId: 'a2', done: 2, note: 'writing' } as never)
  const shown = await texts($)
  // The current step leads; the note before it is kept under it, once.
  expect(shown).toContain('Step 3 · writing')
  expect(shown.match(/^ +reading$/gm)?.length).toBe(1)
  expect(shown).not.toContain('3/3')
  // The row of a1 has no steps: its line starts at the context.
  expect(shown).toMatch(/░ ctx 0%/)
})

test('step: a working row lists the notes before the current one newest first; a done row oldest first', async ($, on) => {
  engine(on)
  await spawn($, 'Writer')
  for (const [done, note] of [[1, 'outline'], [2, 'draft'], [3, 'polish']] as const) {
    await $.tool.call({ tool: STEP, agentId: 'a1', done, total: 4, note } as never)
  }
  const working = await texts($)
  expect(working).toContain('Step 4 · polish')
  expect(working.indexOf('draft')).toBeLessThan(working.indexOf('outline'))
  await end($, 'a1', 'answer')
  const done = await texts($)
  expect(done).toContain('Done · 4 steps')
  expect(done.indexOf('draft')).toBeLessThan(done.indexOf('polish'))
  expect(done).not.toContain('outline')
})

test('failure: a run that ends other than with an answer is finished with ✗ and toasts once', async ($, on) => {
  const { toasts } = engine(on)
  await spawn($, 'Fragile')
  await end($, 'a1', 'error')
  await end($, 'a1', 'error')
  const shown = await texts($)
  expect(shown).toContain('Finished · 1')
  expect(shown).toContain('✗')
  expect(toasts).toEqual(['Subagent failed: Fragile'])
})

test('notify: the context warning shows once per agent, past contextWarnPercent', { options: { contextWarnPercent: 50 } }, async ($, on) => {
  const { toasts, next } = engine(on)
  await spawn($, 'Big')
  await spawn($, 'Bigger')
  await request($, next, 'a1', 400_000)
  expect(toasts).toEqual([])
  await request($, next, 'a1', 600_000)
  await request($, next, 'a1', 700_000)
  await request($, next, 'a2', 900_000)
  expect(toasts).toEqual(['Big: ctx 60%', 'Bigger: ctx 90%'])
})

test('notify: a contextWarnPercent of 0 is not a threshold; the default 80% stands', { options: { contextWarnPercent: 0 } }, async ($, on) => {
  const { toasts, next } = engine(on)
  await spawn($, 'Big')
  await request($, next, 'a1', 500_000)
  expect(toasts).toEqual([])
  await request($, next, 'a1', 810_000)
  expect(toasts).toEqual(['Big: ctx 81%'])
})

test('notify: a model missing from the window table is warned on the 1M guess', async ($, on) => {
  const { toasts, next } = engine(on)
  await spawn($, 'Mystery')
  await request($, next, 'a1', 850_000, 'claude-opus-9')
  expect(toasts).toEqual(['Mystery: ctx 85%?'])
})

test('notify: finishing the plan toasts once', async ($, on) => {
  const { toasts } = engine(on)
  await $.tool.call(PLAN as never)
  await $.tool.call({ tool: PROGRESS, finished: true } as never)
  await $.tool.call({ tool: PROGRESS, finished: true } as never)
  expect(toasts).toEqual(['Plan complete: Ship it'])
})

test('autoOpen plan: the panel opens once per reported plan, not when agents start', async ($, on) => {
  const { opened } = engine(on)
  await spawn($, 'Before the plan')
  await $.tool.call(PLAN as never)
  await $.tool.call({ ...PLAN, done: 1 } as never)
  await spawn($, '#1 Parser')
  expect(opened).toEqual(['crew-agents'])
  await $.tool.call({ ...PLAN, title: 'Next plan' } as never)
  expect(opened).toEqual(['crew-agents', 'crew-agents'])
})

test('autoOpen any: the first agent start opens the panel too, once', { options: { autoOpen: 'any' } }, async ($, on) => {
  const { opened } = engine(on)
  await spawn($, 'One')
  await spawn($, 'Two')
  expect(opened).toEqual(['crew-agents'])
})
