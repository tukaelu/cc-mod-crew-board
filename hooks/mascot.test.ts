import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { costumeOf, mendako } from './mendako'

const PLUGIN = 'crew-board'
const pane = { title: '', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

test('mascot: built-in types wear their fixed costume, other types one by keyword', () => {
  expect(costumeOf('Explore')).toBe('explorer')
  expect(costumeOf('Plan')).toBe('planner')
  expect(costumeOf('general-purpose')).toBe('carpenter')
  expect(costumeOf('deep-researcher')).toBe('detective')
  expect(costumeOf('investigate-bugs')).toBe('detective')
  expect(costumeOf('code-reviewer')).toBe('wizard')
  expect(costumeOf('my-plugin:security-audit')).toBe('wizard')
  expect(costumeOf('handoff-writer')).toBe('mail')
  expect(costumeOf('deliver-bot')).toBe('mail')
  expect(costumeOf('test-runner')).toBe('none')
  // Case matters for the built-ins only: "explore" is not the built-in type.
  expect(costumeOf('explore')).toBe('none')
})

const KELP = /fill="#(3E9B5A|2E7A44)"/g
// The first seaweed frame's rows: the height on the 22×16 grid.
const kelpRows = (sprite: string) => (/<g class="kelp-a">(.*?)<\/g>/.exec(sprite)?.[1] ?? sprite).match(KELP)?.length ?? 0

for (const [effort, rows] of [['low', 2], ['medium', 4], ['high', 6], ['xhigh', 8], ['max', 10]] as const) {
  test(`mascot: effort ${effort} grows ${rows} cells of seaweed`, () => {
    const sprite = mendako('none', 'run', '#888780', effort)
    expect(kelpRows(sprite)).toBe(rows)
    expect(sprite).toContain('<rect x="17" y="13" width="5" height="1" fill="#D8C27A"/>') // the sand
    expect(sprite.includes('class="sparkle"')).toBe(effort === 'max')
  })
}

test('mascot: no seaweed when effort is unknown or the task waits', () => {
  expect(kelpRows(mendako('none', 'run', '#888780'))).toBe(0)
  expect(kelpRows(mendako('none', 'run', '#888780', '7'))).toBe(0)
  expect(kelpRows(mendako('none', 'wait', '#888780', 'high'))).toBe(0)
})

const EYE = '#1F1E1D'
const at = (x: number, y: number, w = 1) => `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${EYE}"/>`

test('mascot: working plays every layer, with dot eyes and the prop', () => {
  const s = mendako('carpenter', 'run', '#378ADD', 'high')
  expect(s.startsWith('<g class="run">')).toBe(true)
  for (const cls of ['la', 'lb', 'bd', 'fin', 'p-swing', 'kelp-a', 'kelp-b']) expect(s).toContain(`class="${cls}"`)
  expect(s).toContain(at(5, 8))
  expect(s).toContain(at(10, 8))
})

test('mascot: done smiles (^ eyes) and holds still, prop in hand', () => {
  const s = mendako('carpenter', 'done', '#378ADD', 'high')
  expect(s).not.toContain('class="run"')
  for (const [x, y] of [[4, 8], [5, 7], [6, 8], [9, 8], [10, 7], [11, 8]]) expect(s).toContain(at(x as number, y as number))
  expect(s).toContain('class="p-swing"')
})

test('mascot: failed has × eyes, drooping fins and sweat, and drops the prop', () => {
  const s = mendako('carpenter', 'fail', '#378ADD', 'high')
  for (const [x, y] of [[4, 7], [6, 7], [5, 8], [4, 9], [6, 9]]) expect(s).toContain(at(x as number, y as number))
  expect(s).toContain('<rect x="2" y="4" width="1" height="2" fill="#7FB8E8"/>') // sweat
  expect(s).not.toContain('class="fin"')
  expect(s).toContain('<rect x="1" y="8" width="1" height="1" fill="#D06A55"/>') // fin hangs at (0,3)
  expect(s).not.toContain('p-swing')
  expect(s).toContain('fill="#C99A1E"') // the helmet stays
})

test('mascot: waiting closes its eyes, fades to half, and only the Zz blinks', () => {
  const s = mendako('wizard', 'wait', '#D4537E')
  expect(s.startsWith('<g opacity="0.5">')).toBe(true)
  expect(s).toContain(at(4, 8, 2))
  expect(s).toContain('<g class="zz">')
  expect(s).not.toContain('class="run"')
  expect(s).not.toContain('p-twinkle')
  expect(s).toContain('fill="#6A4FB0"') // the hat stays
})

// The panel draws each row's mendako in its type's costume and color.
const engine = (on: On) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))
}

const rowOf = async ($: Engine, description: string) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const svg = (await ui.findAll({ type: 'Svg' })).find(el => String(el.props.alt).startsWith(description))
  await ui.unmount()
  return String(svg?.props.source)
}

test('mascot: panel rows wear the costume of their type', async ($, on) => {
  engine(on)
  for (const [type, d] of [['Explore', 'Scout'], ['deep-researcher', 'Dig'], ['test-runner', 'Tester']]) {
    await $.agent.spawn({ tool_use_id: d, prompt: 'p', description: d, subagentType: type, provider: 'engine', parentModel: 'm', background: false, fork: false } as never)
  }
  expect(await rowOf($, 'Scout')).toContain('fill="#C8A96B"') // explorer's hat
  expect(await rowOf($, 'Dig')).toContain('class="p-smoke"') // detective's pipe
  const plain = await rowOf($, 'Tester')
  expect(plain).not.toContain('class="p-')
  expect(plain).toContain('class="run"')
})

test('mascot: planned tasks wait, with no seaweed', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'mcp__crew-board__progress', title: 'P', tasks: [{ title: 'Later', subagent_type: 'code-reviewer' }] } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const planned = (await ui.findAll({ type: 'Svg' })).find(el => String(el.props.alt).startsWith('1. Later'))
  const s = String(planned?.props.source)
  expect(s).toContain('<g opacity="0.5">')
  expect(s).toContain('class="zz"')
  expect(s).toContain('fill="#6A4FB0"') // a reviewer waits in the wizard's hat
  expect(s).not.toContain('class="kelp')
})

// showMascot off: no mendako anywhere, and the text takes its room.
const band = { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }

for (const isShown of [true, false]) {
  test(`showMascot ${isShown}: the cards and the band ${isShown ? 'draw' : 'leave out'} the mendako`, { options: { showMascot: isShown } }, async ($, on) => {
    engine(on)
    await $.tool.call({ tool: 'mcp__crew-board__progress', title: 'P', tasks: [{ title: 'Later', subagent_type: 'code-reviewer' }] } as never)
    await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Tester', subagentType: 'test-runner', provider: 'engine', parentModel: 'm', background: false, fork: false } as never)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
    const svgs = (await ui.findAll({ type: 'Svg' })).map(el => ({ alt: String(el.props.alt), source: String(el.props.source) }))
    await ui.unmount()
    const card = svgs.find(s => s.alt.startsWith('Tester'))?.source ?? ''
    const planned = svgs.find(s => s.alt.startsWith('1. Later'))?.source ?? ''
    const main = svgs.find(s => s.alt.startsWith('Main:'))?.source ?? ''
    for (const s of [card, planned, main]) {
      expect(s.includes('shape-rendering="crispEdges"')).toBe(isShown)
      expect(/<text class="[ts]" x="(\d+)"/.exec(s)?.[1]).toBe(isShown ? '96' : '18')
    }
    const row = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band })
    const bandSvg = String((await row.find({ type: 'Svg' }))?.props.source)
    await row.unmount()
    expect(bandSvg.includes('shape-rendering="crispEdges"')).toBe(isShown)
    // The percent ends 12px from the mendako, or from the band's right end.
    const W = Number(/width="(\d+)"/.exec(bandSvg)?.[1])
    expect(Number(/<text class="m" x="([\d.]+)"/.exec(bandSvg)?.[1])).toBe(W - (isShown ? 30 : 0) - 12)
  })
}

test('showMascot false: the compact panel shows a status mark per run', { options: { showMascot: false } }, async ($, on) => {
  engine(on)
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Tester', subagentType: 'test-runner', provider: 'engine', parentModel: 'm', background: false, fork: false } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  await ui.press({ key: 'compact' })
  const s = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('\n')
  await ui.unmount()
  expect(s).not.toContain('shape-rendering="crispEdges"')
  expect(s).toContain('class="live"')
})
