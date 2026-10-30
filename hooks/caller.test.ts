import { expect, test } from 'claude-code/testing'

const PLUGIN = 'crew-board'
const PROGRESS = 'mcp__crew-board__progress'
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }

// The flow is the main session's to report: a subagent that calls `progress` could
// otherwise rename it, mark it finished or wipe the finished workers from the panel.
test('caller: a subagent cannot report the plan', async $ => {
  await $.tool.call({ tool: PROGRESS, title: 'Ship the thing', phase: 'Implement', total: 3, done: 1 } as never)

  const hijack = await $.tool.call({ tool: PROGRESS, agentId: 'a1', title: 'Hijacked', total: 9, done: 9, finished: true } as never)
  expect(hijack).toMatchObject({ result: 'ignored: only the main session reports the plan' })

  // Nothing moved: the band still draws the same plan.
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band })
  const row = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(row).toContain('Ship the thing')
  expect(row).toContain('Implement 1/3')
  expect(row).not.toContain('Hijacked')

  // The main session still can.
  expect(await $.tool.call({ tool: PROGRESS, done: 2 } as never)).toMatchObject({ result: 'ok: Implement 2/3' })
})

test('caller: a subagent cannot start a plan either', async $ => {
  const started = await $.tool.call({ tool: PROGRESS, agentId: 'a1', title: 'Hijacked', phase: 'Implement', total: 2 } as never)
  expect(started).toMatchObject({ result: 'ignored: only the main session reports the plan' })
  // The main session's first report starts at its own counts.
  expect(await $.tool.call({ tool: PROGRESS, title: 'Real flow', phase: 'Implement', total: 4 } as never)).toMatchObject({ result: 'ok: Implement 0/4' })
})
