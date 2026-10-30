import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'crew-board'
const PROGRESS = 'mcp__crew-board__progress'
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
const pane = { title: '', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

// The engine beneath the plugin. Agent tool calls wait until `release()`, so a test
// can look at the band while they are in flight; each model request fills `tokens`.
const engine = (on: On) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  const models = new Map<string, string>()
  let n = 0
  on('agent.spawn', (_$, e) => {
    const agentId = `a${++n}`
    models.set(agentId, e.model ?? 'claude-opus-5-5')
    return { model: e.model ?? 'claude-opus-5-5', agentId }
  })
  on('turn.complete', () => ({ text: '' }) as never)
  const next = { tokens: 0 }
  on('turn.step', async function* (_$, e) {
    const model = models.get(e.agentId ?? '') ?? 'claude-opus-5-5'
    const usage = { model, input_tokens: next.tokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    return { turnId: 'turn', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  on('tool.call', { tool: 'Agent' }, async () => {
    await held
    return { result: 'done' } as never
  })
  return { next, release: () => release(), clock }
}

const spawn = ($: Engine, description: string, model: string) =>
  $.agent.spawn({ tool_use_id: `t-${description}`, prompt: 'p', description, subagentType: 'general-purpose', model, provider: 'engine', parentModel: model, background: false, fork: false } as never)

const request = async ($: Engine, next: { tokens: number }, agentId: string, tokens: number) => {
  next.tokens = tokens
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 'turn', index: 0, model: 'x', messageCount: 1, agentId })
  for await (const _ of stream) void _
}

const desktopPane = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const svgs = (await ui.findAll({ type: 'Svg' })).map(el => ({ alt: String(el.props.alt), source: String(el.props.source) }))
  await ui.unmount()
  return svgs
}

// The band's one Svg, or null when the plugin draws no band (nothing in the test
// stands beneath it, so mounting a band it leaves to the rest fails).
const bandRow = async ($: Engine, props = band) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props }).catch(() => null)
  if (!ui) return null
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  return svg ? String(svg.props.source) : null
}

test('cost: with a model missing from the price table the total is a floor, marked + and in the alt text', async ($, on) => {
  const { next } = engine(on)
  await spawn($, 'Priced', 'claude-haiku-4-5')
  await spawn($, 'Unpriced', 'claude-opus-9')
  await request($, next, 'a1', 1e6) // 1M input on Haiku 4.5: $1.00
  await request($, next, 'a2', 1e6)
  const [, header] = await desktopPane($) // after the grid tile
  expect(header?.source).toContain('≈$1.00+')
  expect(header?.alt).toContain('≈$1.00+ (excluding models missing from the price table)')
  const rows = await desktopPane($)
  expect(rows.find(r => r.alt.startsWith('Unpriced'))?.source).toContain('—')
})

test('cost: with every model priced there is no + and no note', async ($, on) => {
  const { next } = engine(on)
  await spawn($, 'Priced', 'claude-haiku-4-5')
  await request($, next, 'a1', 1e6)
  const [, header] = await desktopPane($)
  expect(header?.source).toContain('≈$1.00<')
  expect(header?.alt).not.toContain('excluding')
})

test('context: a model missing from the window table is computed against 1M and marked ?', async ($, on) => {
  const { next } = engine(on)
  await spawn($, 'Mystery', 'claude-opus-9')
  await spawn($, 'Known', 'claude-haiku-4-5')
  await request($, next, 'a1', 120_000)
  await request($, next, 'a2', 120_000)
  const rows = await desktopPane($)
  const mystery = rows.find(r => r.alt.startsWith('Mystery'))
  expect(mystery?.source).toContain('ctx 12%?')
  expect(mystery?.alt).toContain('window unknown, computed against 1M tokens')
  const known = rows.find(r => r.alt.startsWith('Known'))
  expect(known?.source).toContain('ctx 60% ') // 120K of Haiku 4.5's 200K
  expect(known?.alt).not.toContain('window unknown')
})

test('band: launched tasks draw a faint layer past the done ones, with a tick per planned task', async ($, on) => {
  const { release, clock } = engine(on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', total: 4, done: 1 } as never)
  const before = await bandRow($)
  const faint = (row: string | null) => /opacity="0\.45">(.*?)<\/g>/.exec(row ?? '')?.[1] ?? ''
  expect(faint(before)).toBe('')
  const inFlight = $.tool.call({ tool: 'Agent', subagent_type: 'general-purpose', description: 'x', prompt: 'p' } as never)
  await clock.settle()
  const during = await bandRow($)
  expect(faint(during)).toContain('<rect')
  // Ticks at 2/4 and 3/4 (1/4 is under the fill).
  expect(/<g class="tk">(.*?)<\/g>/.exec(during ?? '')?.[1]?.match(/<rect/g)?.length).toBe(2)
  release()
  await inFlight
  expect(faint(await bandRow($))).toBe('')
})

test('band: a finished plan turns the bar green and slows the twinkle', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', total: 2, done: 1 } as never)
  const working = await bandRow($)
  expect(working).toContain('fill="#8f8cf4"')
  expect(working).toContain('animation:tw 2.2s')
  await $.tool.call({ tool: PROGRESS, done: 2, finished: true } as never)
  const done = await bandRow($)
  expect(done).toContain('fill="#5fbf8f"')
  expect(done).not.toContain('fill="#8f8cf4"')
  expect(done).toContain('animation:tw 3.2s')
})

test('band: nothing is drawn while Claude Code shows a survey', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', total: 2 } as never)
  expect(await bandRow($, { ...band, hasSurvey: true })).toBeNull()
  expect(await bandRow($)).not.toBeNull()
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
