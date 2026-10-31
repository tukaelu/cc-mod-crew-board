import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'crew-board'
const PROGRESS = 'mcp__crew-board__progress'
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }

// The engine beneath the plugin. Agent tool calls wait until `release()`, so a test
// can look at the band while they are in flight.
const engine = (on: On) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: `a${++n}` }))
  on('turn.complete', () => ({ text: '' }) as never)
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  on('tool.call', { tool: 'Agent' }, async () => {
    await held
    return { result: 'done' } as never
  })
  return { release: () => release(), clock, toasts }
}

const spawn = ($: Engine, description: string, model: string) =>
  $.agent.spawn({ tool_use_id: `t-${description}`, prompt: 'p', description, subagentType: 'general-purpose', model, provider: 'engine', parentModel: model, background: false, fork: false } as never)

// The band's one Svg, or null when the plugin draws no band (nothing in the test
// stands beneath it, so mounting a band it leaves to the rest fails).
const bandRow = async ($: Engine, props = band) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props }).catch(() => null)
  if (!ui) return null
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  return svg ? String(svg.props.source) : null
}

test('band: launched tasks draw a faint layer past the done ones, with a tick per planned task', async ($, on) => {
  const { release, clock } = engine(on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', total: 4, done: 1 } as never)
  const before = await bandRow($)
  // The faint layer's width past the fill: 0 when nothing is launched.
  const faint = (row: string | null) => Number(/class="run" x="[\d.]+" width="([\d.]+)"/.exec(row ?? '')?.[1] ?? 0)
  expect(faint(before)).toBe(0)
  const inFlight = $.tool.call({ tool: 'Agent', subagent_type: 'general-purpose', description: 'x', prompt: 'p' } as never)
  await clock.settle()
  const during = await bandRow($)
  expect(faint(during)).toBeGreaterThan(0)
  // A tick per gap between the 4 tasks: 1/4 is a gap in the fill, 2/4 and 3/4 marks on the track.
  const ticks = /<g class="ticks">(.*?)<\/g>/.exec(during ?? '')?.[1] ?? ''
  expect(ticks.match(/class="k"/g)?.length).toBe(1)
  expect(ticks.match(/class="tk"/g)?.length).toBe(2)
  release()
  await inFlight
  expect(faint(await bandRow($))).toBe(0)
})

test('band: a finished plan turns the bar green', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', total: 2, done: 1 } as never)
  const working = await bandRow($)
  expect(working).toContain('fill="#8f8cf4"')
  await $.tool.call({ tool: PROGRESS, done: 2, finished: true } as never)
  const done = await bandRow($)
  expect(done).toContain('fill="#5fbf8f"')
  expect(done).not.toContain('fill="#8f8cf4"')
  // A solid bar: no twinkling dots.
  expect(done).not.toContain('animation:tw')
})

test('band: nothing is drawn while Claude Code shows a survey', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', total: 2 } as never)
  expect(await bandRow($, { ...band, hasSurvey: true })).toBeNull()
  expect(await bandRow($)).not.toBeNull()
})

test('band: a background agent counts as launched after its Agent call returns', async ($, on) => {
  const { release } = engine(on)
  release() // Agent calls return at once, as a background launch does
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', total: 4, done: 1 } as never)
  await $.tool.call({ tool: 'Agent', subagent_type: 'general-purpose', description: 'x', prompt: 'p' } as never)
  await spawn($, 'Background', 'claude-opus-5-5')
  const faint = (row: string | null) => Number(/class="run" x="[\d.]+" width="([\d.]+)"/.exec(row ?? '')?.[1] ?? 0)
  expect(faint(await bandRow($))).toBeGreaterThan(0)
  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a1', reason: 'answer', answer: 'ok', usage: null })
  expect(faint(await bandRow($))).toBe(0)
})

test('band: with no plan reported, a background agent shows "1 running"', async ($, on) => {
  const { release } = engine(on)
  release()
  await $.tool.call({ tool: 'Agent', subagent_type: 'Explore', description: 'x', prompt: 'p' } as never)
  await spawn($, 'Scout', 'claude-opus-5-5')
  expect(await bandRow($)).toContain('1 running')
})

test('band: with no plan reported, a launched agent shows "N running"', async ($, on) => {
  const { release, clock } = engine(on)
  expect(await bandRow($)).toBeNull()
  const inFlight = $.tool.call({ tool: 'Agent', subagent_type: 'Explore', description: 'x', prompt: 'p' } as never)
  await clock.settle()
  expect(await bandRow($)).toContain('1 running')
  release()
  await inFlight
})

test('band: with no plan reported, the band finishes itself when its last agent does', async ($, on) => {
  const { release, toasts } = engine(on)
  release()
  await $.tool.call({ tool: 'Agent', subagent_type: 'Explore', description: 'x', prompt: 'p' } as never)
  await spawn($, 'Scout', 'claude-opus-5-5')
  expect(await bandRow($)).toContain('1 running')
  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a1', reason: 'answer', answer: 'ok', usage: null })
  const done = await bandRow($)
  expect(done).toContain('Done')
  expect(done).toContain('fill="#5fbf8f"')
  expect(done).not.toContain('0 running')
  // No plan was reported, so there is no plan to announce as complete.
  expect(toasts).toEqual([])
})

test('panel: the Finished section folds away with the toggle beside its bar', async ($, on) => {
  engine(on)
  await spawn($, 'One', 'claude-opus-5-5')
  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a1', reason: 'answer', answer: 'ok', usage: null })
  const pane = { title: '', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
  const cards = async () => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
    const n = (await ui.findAll({ type: 'Svg' })).filter(el => String(el.props.alt).startsWith('One')).length
    return { ui, n }
  }
  const before = await cards()
  expect(before.n).toBe(1)
  await before.ui.press({ key: 'done' })
  await before.ui.unmount()
  const after = await cards()
  expect(after.n).toBe(0)
  await after.ui.unmount()
})

test('panel: a main-session turn redraws the panel, so the chat cost stays current', async ($, on) => {
  engine(on)
  let usd = 1
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd } } }) as never)
  const pane = { title: '', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'crew-agents', props: pane })
  expect(await ui.find({ type: 'Text', text: /\$1\.00/ })).toBeDefined()
  usd = 2.5
  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ reason: 'answer', answer: 'ok', usage: null })
  expect(await ui.find({ type: 'Text', text: /\$2\.50/ })).toBeDefined()
  await ui.unmount()
})
