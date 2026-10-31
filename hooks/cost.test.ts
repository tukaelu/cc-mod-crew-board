import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'crew-board'
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// One subagent on `model`; `request` is what each of its model requests reports.
// `chatUsd` is what the engine's ledger says the whole chat cost; undefined, it keeps none.
const worker = async ($: Engine, on: On, model: string, request: Usage, chatUsd?: number) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], ...(chatUsd === undefined ? {} : { cost: { usd: chatUsd } }) } }) as never)
  on('agent.spawn', () => ({ model, agentId: 'a1' }))
  on('turn.step', async function* () {
    return { turnId: 'turn', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model, ...request } } as never
  })
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Work', subagentType: 'general-purpose', provider: 'engine', parentModel: model, background: false, fork: false } as never)
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 'turn', index: 0, model, messageCount: 1, agentId: 'a1' })
  for await (const _ of stream) void _
}

const texts = async ($: Engine, surface: 'terminal' | 'desktop') => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'crew-agents', props: pane })
  const out = [
    ...(await ui.findAll({ type: 'Text' })).map(el => String(el.text ?? '')),
    ...(await ui.findAll({ type: 'Svg' })).map(el => `${String(el.props.alt)}\n${String(el.props.source)}`),
  ].join('\n')
  await ui.unmount()
  return out
}

// 130K tokens: 20K input, 10K output, 50K cache read, 50K cache write.
const LONG: Usage = { input_tokens: 20_000, output_tokens: 10_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 50_000 }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the header shows the chat's total cost as the engine counts it`, async ($, on) => {
    await worker($, on, 'claude-opus-5-5', LONG, 4.82)
    const shown = await texts($, surface)
    expect(shown).toContain('$4.82')
    expect(shown).not.toContain('≈')
  })

  test(`${surface}: with no ledger the chat cost shows —`, async ($, on) => {
    await worker($, on, 'claude-opus-5-5', LONG)
    expect(await texts($, surface)).toMatch(/Total chat cost (—|<)/)
  })
}

// Rows carry no cost of their own: only tokens, time and the context fill.
test('rows show tokens and the context fill, and no amount', async ($, on) => {
  await worker($, on, 'claude-opus-5-5', LONG, 4.82)
  const shown = await texts($, 'terminal')
  expect(shown).toMatch(/ctx [█░]+ 13% {2}tokens [█░]+ 130k · \d+:\d\d/)
  expect(shown.match(/\$/g)?.length).toBe(1) // the header's total only
})

// The context bar: 130K tokens are 13% of Haiku 5.5's 1M window and 65% of Haiku 4.5's 200K.
for (const [model, percent] of [['claude-haiku-5-5', 13], ['claude-haiku-4-5', 65], ['claude-haiku-4-5-20251001', 65], ['claude-opus-5-5[1m]', 13]] as const) {
  test(`context: ${model} fills to ${percent}% at 130K tokens`, async ($, on) => {
    await worker($, on, model, LONG)
    expect(await texts($, 'terminal')).toMatch(new RegExp(`ctx [█░]+ ${percent}% `))
  })
}

test('context: a model missing from the window table is computed against 1M and marked ?', async ($, on) => {
  await worker($, on, 'claude-opus-9', { ...LONG, input_tokens: 10_000 }) // 120K
  const shown = await texts($, 'desktop')
  expect(shown).toContain('ctx 12%?')
  expect(shown).toContain('window unknown, computed against 1M tokens')
})

// The card of the run, on the desktop.
const card = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const svg = (await ui.findAll({ type: 'Svg' })).find(el => String(el.props.alt).startsWith('Work'))
  await ui.unmount()
  return String(svg?.props.source)
}

const CAUTION = '#E0A419'
const OVER = '#D0453F'

test('meters: the context turns yellow past three quarters of contextWarnPercent, red past it', async ($, on) => {
  await worker($, on, 'claude-haiku-4-5', LONG) // 65% of 200K; 80% × 3/4 = 60%
  const s = await card($)
  expect(s).toContain(`fill="${CAUTION}"`)
  expect(s).not.toContain(`fill="${OVER}"`)
})

test('meters: past contextWarnPercent the context is red', { options: { contextWarnPercent: 50 } }, async ($, on) => {
  await worker($, on, 'claude-haiku-4-5', LONG) // 65% > 50%
  expect(await card($)).toContain(`fill="${OVER}"`)
})

test('meters: a low fill stays grey', async ($, on) => {
  await worker($, on, 'claude-haiku-5-5', LONG) // 13%
  const s = await card($)
  expect(s).not.toContain(`fill="${CAUTION}"`)
  expect(s).not.toContain(`fill="${OVER}"`)
})

test('meters: with no tokenBudget the tokens are compared, never warned', async ($, on) => {
  await worker($, on, 'claude-haiku-5-5', { ...LONG, input_tokens: 2_000_000 })
  const s = await card($)
  expect(s).toContain('>2.1M<')
  // One request this big overfills the context, so its meter is red; the tokens' is not.
  expect(s.match(new RegExp(`fill="${OVER}"`, 'g'))?.length).toBe(1)
})

test('meters: past tokenBudget the tokens are red, and the budget is shown', { options: { tokenBudget: 100_000 } }, async ($, on) => {
  await worker($, on, 'claude-haiku-5-5', LONG) // 130k of 100k
  const s = await card($)
  expect(s).toContain('130k / 100k')
  expect(s).toContain(`fill="${OVER}"`)
})

test('meters: three quarters of tokenBudget is yellow', { options: { tokenBudget: 160_000 } }, async ($, on) => {
  await worker($, on, 'claude-haiku-5-5', LONG) // 130k of 160k = 81%
  expect(await card($)).toContain(`fill="${CAUTION}"`)
})
