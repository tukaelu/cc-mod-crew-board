import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'crew-board'
const PROGRESS = 'mcp__crew-board__progress'
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

// A session whose Claude Code `language` setting and locale are as given.
const session = async ($: Engine, on: On, settings: Record<string, unknown>, locale: string) => {
  mock.clock(on)
  mock.env(on, { LANG: locale })
  on('settings.read', async () => ({ value: settings }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
}

// What the UI's fixed words come out as: the count label and the empty panel.
const words = async ($: Engine) => {
  const reported = (await $.tool.call({ tool: PROGRESS, title: 'T', total: 3, done: 1 } as never)) as { result: string }
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'crew-agents', props: pane })
  const collapse = (await ui.find({ key: 'compact' }))?.props.label
  await ui.unmount()
  return { label: reported.result, collapse }
}

const EN = { label: 'ok: Tasks 1/3', collapse: 'Collapse' }
const JA = { label: 'ok: タスク 1/3', collapse: '縮小' }

test('language en: English whatever the setting and locale say', { options: { language: 'en' } }, async ($, on) => {
  await session($, on, { language: '日本語' }, 'ja_JP.UTF-8')
  expect(await words($)).toEqual(EN)
})

test('language ja: Japanese whatever the setting and locale say', { options: { language: 'ja' } }, async ($, on) => {
  await session($, on, { language: 'english' }, 'en_US.UTF-8')
  expect(await words($)).toEqual(JA)
})

test('language auto: Claude Code\'s language setting comes before the locale', async ($, on) => {
  await session($, on, { language: 'japanese' }, 'en_US.UTF-8')
  expect(await words($)).toEqual(JA)
})

test('language auto: with no language setting, the locale decides', async ($, on) => {
  await session($, on, {}, 'ja_JP.UTF-8')
  expect(await words($)).toEqual(JA)
})

test('language auto: English when nothing says Japanese', async ($, on) => {
  await session($, on, {}, 'fr_FR.UTF-8')
  expect(await words($)).toEqual(EN)
})

// The pill is sized from the label's width with CJK at 1em; at the Latin 0.56em a
// Japanese label would spill out of its pill.
for (const columns of [100, 30]) {
  test(`language ja: the label fits its pill and the pill fits the bar at ${columns} columns`, { options: { language: 'ja' } }, async ($, on) => {
    await session($, on, {}, 'ja_JP.UTF-8')
    await $.tool.call({ tool: PROGRESS, title: '日本語のとても長い計画のタイトル', phase: '実装中', total: 3, done: 1 } as never)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...band, bodyColumns: columns } })
    const row = String((await ui.find({ type: 'Svg' }))?.props.source)
    const barW = Number(/<rect class="k" width="([\d.]+)"/.exec(row)?.[1])
    const [, pillX, pillW] = /<rect x="([\d.]+)" width="([\d.]+)" height="16" rx="8"/.exec(row) ?? []
    const label = />([^<]*)<\/text>\n<\/g>/.exec(row)?.[1] ?? ''
    // 11px text: each CJK character takes at least 11px, plus the pill's 18px of padding.
    const cjk = [...label].filter(ch => /[　-鿿]/.test(ch)).length
    expect(cjk).toBeGreaterThan(0)
    expect(Number(pillW)).toBeGreaterThanOrEqual(18 + cjk * 11)
    expect(Number(pillX) + Number(pillW)).toBeLessThanOrEqual(barW)
  })
}
