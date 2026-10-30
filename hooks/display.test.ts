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
  on('ui.toast', () => ({ value: undefined }))
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-opus-5-5', agentId: `a${++n}` }))
  on('turn.complete', () => ({ text: '' }) as never)
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  on('tool.call', { tool: 'Agent' }, async () => {
    await held
    return { result: 'done' } as never
  })
  return { release: () => release(), clock }
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

test('band: a background agent counts as launched after its Agent call returns', async ($, on) => {
  const { release } = engine(on)
  release() // Agent calls return at once, as a background launch does
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', total: 4, done: 1 } as never)
  await $.tool.call({ tool: 'Agent', subagent_type: 'general-purpose', description: 'x', prompt: 'p' } as never)
  await spawn($, 'Background', 'claude-opus-5-5')
  const faint = /opacity="0\.45">(.*?)<\/g>/.exec((await bandRow($)) ?? '')?.[1] ?? ''
  expect(faint).toContain('<rect')
  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a1', reason: 'answer', answer: 'ok', usage: null })
  expect(/opacity="0\.45">(.*?)<\/g>/.exec((await bandRow($)) ?? '')?.[1]).toBe('')
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
