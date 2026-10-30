import { expect, test } from 'claude-code/testing'

const PLUGIN = 'crew-board'
const PROGRESS = 'mcp__crew-board__progress'

const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const plan = {
  tool: PROGRESS,
  title: 'Ship the thing',
  phase: 'Implement',
  tasks: [
    { title: 'Write the parser', subagent_type: 'general-purpose' },
    { title: 'Wire the CLI', subagent_type: 'Explore', after: [1] },
  ],
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band shows what the plan reports`, async ($, on) => {
    // Reporting a plan opens the panel by itself, once per plan.
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })

    const reported = await $.tool.call(plan as never)
    expect(reported).toMatchObject({ result: 'ok: Implement 0/2' })

    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    // Two planned tasks, none started: the crew button counts both.
    expect((await ui.find({ key: 'crew-agents' }))?.props.label).toBe('×2')

    await $.tool.call({ tool: PROGRESS, done: 1 } as never)
    expect(opened).toEqual(['crew-agents'])
    expect(await $.tool.call({ tool: PROGRESS, finished: true } as never)).toMatchObject({ result: 'ok: Done' })
  })

  // The schema's enum and bounds are advice to the model: a call outside them must still draw.
  test(`${surface}: input outside the tool's schema cannot break the drawing`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const tasks = [
      { title: 'Odd one', subagent_type: '__proto__' },
      { title: 'Odd two', subagent_type: 'constructor' },
      ...Array.from({ length: 500 }, (_, i) => ({ title: `Task ${i}`, subagent_type: 'Explore' })),
    ]
    const reported = await $.tool.call({ tool: PROGRESS, title: 'Odd input', phase: 'Implement', tasks, total: 1e9 } as never)
    expect(reported).toMatchObject({ result: 'ok: Implement 0/200' })

    const bar = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    expect((await bar.find({ key: 'crew-agents' }))?.props.label).toBe('×200')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'crew-agents', props: pane })
    // The section head is a Text on the terminal and an Svg bar (named by its alt) on the desktop.
    const heads = [...(await ui.findAll({ type: 'Text' })).map(el => String(el.text)), ...(await ui.findAll({ type: 'Svg' })).map(el => String(el.props.alt))]
    expect(heads.some(h => /Planned · 200/.test(h))).toBe(true)
    const drawn = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')
    expect(drawn).not.toContain('native code')
    expect(drawn).not.toContain('[object')
  })

  // The stored title is clipped, so the incoming one is clipped before the two are compared.
  test(`${surface}: a title past the cap is still the same plan`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const long = 'L'.repeat(500)

    const first = await $.tool.call({ tool: PROGRESS, title: long, phase: 'Implement', total: 4, done: 2 } as never)
    expect(first).toMatchObject({ result: 'ok: Implement 2/4' })

    // Repeating the long title keeps the counters instead of starting over at 0/0.
    expect(await $.tool.call({ tool: PROGRESS, title: long } as never)).toMatchObject({ result: 'ok: Implement 2/4' })

    const started = await $.tool.call({ tool: PROGRESS, title: 'Another flow', phase: 'Implement', total: 3 } as never)
    expect(started).toMatchObject({ result: 'ok: Implement 0/3' })
  })
}
