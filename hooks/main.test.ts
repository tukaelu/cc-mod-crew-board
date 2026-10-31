import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { mendako } from './mendako'

const PLUGIN = 'crew-board'
const pane = { title: '', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

// The engine beneath the plugin. Agent, AskUserQuestion and Bash calls wait until
// `release()`; a Bash call raises a permission prompt first, as a session's ask does.
const engine = ($: Engine, on: On) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('classic.PermissionRequest', () => ({}) as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.step', async function* () {
    const usage = { model: 'claude-opus-5-5', input_tokens: 100_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    return { turnId: 'turn', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  let release = () => {}
  let held = Promise.resolve()
  const hold = () => (held = new Promise<void>(resolve => (release = resolve)))
  on('tool.call', { tool: 'Agent' }, async () => (await held, { result: 'done' }) as never)
  on('tool.call', { tool: 'AskUserQuestion' }, async () => (await held, { result: 'answered' }) as never)
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, ...(e.agentId ? { agent_id: e.agentId } : {}) } as never)
    await held
    return { result: 'ok' } as never
  })
  return { clock, hold, release: () => release() }
}

const start = ($: Engine) => ($.turn.start as (e: unknown) => Promise<unknown>)({ text: 'go', turnId: 'turn' })
const end = ($: Engine) => ($.turn.complete as (e: unknown) => Promise<unknown>)({ reason: 'answer', answer: 'ok', usage: null })
const request = async ($: Engine) => {
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 'turn', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of stream) void _
}

// The main card's line on the terminal: its name, then its state's glyph.
const mainRow = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'crew-agents', props: pane })
  const all = (await ui.findAll({ type: 'Text' })).map(el => String(el.text ?? ''))
  await ui.unmount()
  return all.join('\n')
}

// The main card's alt text on the desktop.
const mainAlt = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const svgs = await ui.findAll({ type: 'Svg' })
  await ui.unmount()
  return svgs.map(el => String(el.props.alt)).find(a => a.startsWith('Main:')) ?? ''
}

test('main: shown with no subagents; your turn outside a turn, working inside one', async ($, on) => {
  engine($, on)
  expect(await mainRow($)).toMatch(/Main\n▶/)
  expect(await mainAlt($)).toBe('Main: your turn, ctx —')
  await start($)
  expect(await mainRow($)).toMatch(/Main\n●/)
  expect(await mainAlt($)).toContain('Main: working')
  await end($)
  expect(await mainRow($)).toMatch(/Main\n▶/)
})

test('main: the context meter follows the main loop’s own requests', async ($, on) => {
  engine($, on)
  await start($)
  await request($)
  expect(await mainAlt($)).toBe('Main: working, ctx 10%')
})

test('main: a foreground Agent call waits on the crew', async ($, on) => {
  const { clock, hold, release } = engine($, on)
  await start($)
  hold()
  const inFlight = $.tool.call({ tool: 'Agent', subagent_type: 'general-purpose', description: 'x', prompt: 'p' } as never)
  await clock.settle()
  expect(await mainRow($)).toMatch(/Main\n…/)
  release()
  await inFlight
  expect(await mainRow($)).toMatch(/Main\n●/)
})

// The desktop launches every Agent call in the background: the main turn ends while its subagent works.
test('main: outside a turn, a running subagent means waiting on the crew; inside one, working', async ($, on) => {
  engine($, on)
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'x', subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  expect(await mainRow($)).toMatch(/Main\n…/)
  expect(await mainAlt($)).toContain('Main: waiting for the crew')
  await start($)
  expect(await mainRow($)).toMatch(/Main\n●/)
  await end($)
  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a1', reason: 'answer', answer: 'ok', usage: null })
  expect(await mainRow($)).toMatch(/Main\n▶/)
})

test('main: a question or a permission prompt is the person’s turn until the call ends', async ($, on) => {
  const { clock, hold, release } = engine($, on)
  await start($)
  for (const call of [{ tool: 'AskUserQuestion', questions: [] }, { tool: 'Bash', command: 'ls' }]) {
    hold()
    const inFlight = $.tool.call(call as never)
    await clock.settle()
    expect(await mainRow($)).toMatch(/Main\n▶/)
    release()
    await inFlight
    expect(await mainRow($)).toMatch(/Main\n●/)
  }
})

test('main: a subagent’s permission prompt is the person’s turn too', async ($, on) => {
  const { clock, hold, release } = engine($, on)
  await start($)
  hold()
  const asked = $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never)
  await clock.settle()
  expect(await mainRow($)).toMatch(/Main\n▶/)
  release()
  await asked
  expect(await mainRow($)).toMatch(/Main\n●/)
})

test('main: the compact panel puts the main session first', async ($, on) => {
  engine($, on)
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'x', subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  const desk = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  await desk.press({ key: 'compact' })
  const row = (await desk.findAll({ type: 'Svg' })).map(el => ({ alt: String(el.props.alt), source: String(el.props.source) })).find(s => s.alt.startsWith('Main:'))
  await desk.unmount()
  expect(row?.alt).toMatch(/^Main: waiting for the crew, ctx —; 1 agents/)
  // The captain's cap is drawn before the subagent's carpenter helmet.
  expect(row?.source.indexOf('#2B3A67')).toBeGreaterThan(-1)
  expect(row?.source.indexOf('#2B3A67')).toBeLessThan(row?.source.indexOf('#FBE08A') ?? 0)
  const term = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'crew-agents', props: pane })
  // The compact switch is the panel's, already on from the desktop's press.
  const shown = (await term.findAll({ type: 'Text' })).map(el => String(el.text ?? '')).join('\n')
  await term.unmount()
  expect(shown).toMatch(/… ● /)
})

test('main: the captain wears a cap and no prop', () => {
  const cap = mendako('captain', 'run', '#8f8cf4')
  expect(cap).toContain('fill="#2B3A67"')
  expect(mendako('none', 'run', '#8f8cf4')).not.toContain('fill="#2B3A67"')
})
