import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, Flow, Panel, PlannedTask } from '../types'
import { MASCOT_CSS, costumeOf, mendako } from './mendako'
import type { MascotState } from './mendako'

const flow = atom({ plugin: 'crew-board', key: 'flow' } as const, null)
const agents = atom({ plugin: 'crew-board', key: 'agents' } as const, [])
const panel = atom({ plugin: 'crew-board', key: 'panel' } as const, {
  isCompact: false,
  isDoneCollapsed: false,
  autoOpenedFor: '',
})
const now = atom({ plugin: 'crew-board', key: 'now' } as const, 0)

const TOOL = 'mcp__crew-board__progress'
const STEP_TOOL = 'mcp__crew-board__step'
// Added to the end of a subagent's brief. A request worded as a condition ("if the
// step tool appears among your tools") is skipped even with the tool listed, so the
// request itself is unconditional; the last sentence covers an agent that lacks it.
const STEP_BRIEF = `

Progress reporting: before any other work, call \`${STEP_TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar. If you cannot find this tool, skip this silently.`
const PANE = 'crew-agents'
// The tools' schemas are advice to the model, not a check: what a call may ask
// the band and the panel to draw is bounded here.
const MAX_TASKS = 200
const MAX_AFTER = 20
const MAX_TITLE = 120
const MAX_PHASE = 40
const MAX_NOTE = 80
const MAX_RUNS = 200
const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'

type ProgressInput = {
  title?: string
  total?: number
  done?: number
  phase?: string
  finished?: boolean
  tasks?: { title?: string; subagent_type?: string; after?: number[] }[]
}

// ---------------------------------------------------------------------------
// Language: the `language` option, else Claude Code's `language` setting, else the
// process locale; English when nothing says Japanese.

type Lang = 'en' | 'ja'

const STRINGS = {
  en: {
    pane: 'Crew',
    cost: 'Cost',
    tokens: 'Tokens',
    time: 'Time',
    collapse: 'Collapse',
    expand: 'Expand',
    running: 'Running',
    finished: 'Finished',
    planned: 'Planned',
    empty: 'No subagents yet.',
    round: 'round',
    failed: 'error',
    after: 'after',
    tokensWord: 'tokens',
    agentsCount: 'agents',
    isRunning: 'running',
    isFinished: 'finished',
    isFailed: 'failed',
    isPlanned: 'planned',
    opened: 'Crew panel opened.',
    closed: 'Crew panel closed.',
    done: 'Done',
    tasks: 'Tasks',
    busy: (n: number) => `${n} running`,
    ctx: 'ctx',
    unpriced: 'excluding models missing from the price table',
    guessedWindow: 'window unknown, computed against 1M tokens',
    failedToast: (d: string) => `Subagent failed: ${d}`,
    ctxToast: (d: string, ctx: string) => `${d}: ${ctx}`,
    doneToast: (t: string) => `Plan complete: ${t}`,
  },
  ja: {
    pane: 'クルー',
    cost: 'コスト',
    tokens: 'トークン',
    time: '時間',
    collapse: '縮小',
    expand: '展開',
    running: '実行中',
    finished: '終了',
    planned: '予定',
    empty: 'サブエージェントはまだいません。',
    round: 'round',
    failed: 'エラー',
    after: '待ち',
    tokensWord: 'トークン',
    agentsCount: 'エージェント',
    isRunning: '実行中',
    isFinished: '完了',
    isFailed: '失敗',
    isPlanned: '予定',
    opened: 'クルーパネルを開きました。',
    closed: 'クルーパネルを閉じました。',
    done: '完了',
    tasks: 'タスク',
    busy: (n: number) => `${n} 件実行中`,
    ctx: 'ctx',
    unpriced: '価格表にないモデルを除く',
    guessedWindow: 'ウィンドウ不明のため 100 万トークンで計算',
    failedToast: (d: string) => `サブエージェントが失敗しました: ${d}`,
    ctxToast: (d: string, ctx: string) => `${d}: ${ctx}`,
    doneToast: (t: string) => `計画が完了しました: ${t}`,
  },
} as const

// Module scope is fine here: session.start sets it again on every (re)load.
let lang: Lang = 'en'
const tr = () => STRINGS[lang]

const langOf = (v: unknown): Lang => (typeof v === 'string' && /^(ja|japanese|日本語)/i.test(v.trim()) ? 'ja' : 'en')

async function detectLang($: EngineInterface, option: unknown): Promise<Lang> {
  if (option === 'en' || option === 'ja') return option
  try {
    const settings = (await $.settings.read()) as Record<string, unknown>
    if (typeof settings.language === 'string' && settings.language.trim()) return langOf(settings.language)
  } catch {
    // No settings: fall through to the locale.
  }
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  return langOf(locale)
}

const blank = (): Flow => ({
  title: tr().pane,
  total: 0,
  done: 0,
  running: 0,
  phase: '',
  isFinished: false,
  tasks: [],
})

const isNewFlow = (prev: Flow | null, input: ProgressInput): boolean =>
  !prev || prev.isFinished || (input.title !== undefined && clip(input.title.trim(), MAX_TITLE) !== prev.title)

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const cleanTasks = (tasks: ProgressInput['tasks']): PlannedTask[] | undefined =>
  (Array.isArray(tasks) ? tasks : undefined)
    ?.filter(t => str(t?.title))
    .slice(0, MAX_TASKS)
    .map(t => ({
      title: clip(str(t.title), MAX_TITLE),
      type: clip(str(t.subagent_type), MAX_TITLE),
      after: (Array.isArray(t.after) ? t.after : []).filter(n => Number.isInteger(n) && n > 0).slice(0, MAX_AFTER),
    }))

const merge = (prev: Flow | null, input: ProgressInput): Flow => {
  // A new title means a new flow: never carry counters over from an earlier one.
  const base = isNewFlow(prev, input) || !prev ? blank() : { ...blank(), ...prev }
  const tasks = cleanTasks(input.tasks) ?? base.tasks
  const total = Math.min(MAX_TASKS, Math.max(0, Math.round(Number(input.total ?? (input.tasks ? tasks.length : base.total)) || 0)))
  const done = Math.min(total || Infinity, Math.max(0, Math.round(Number(input.done ?? base.done) || 0)))
  const phase = typeof input.phase === 'string' ? clip(input.phase.trim(), MAX_PHASE) : base.phase
  return {
    ...base,
    title: clip(str(input.title) || base.title, MAX_TITLE),
    total,
    done,
    phase,
    isFinished: input.finished === true,
    tasks,
  }
}

const label = (f: Flow): string => {
  const s = tr()
  if (f.isFinished) return s.done
  if (!f.total) return s.busy(f.running)
  return `${f.phase || s.tasks} ${f.done}/${f.total}`
}

const ratio = (f: Flow): number => (f.isFinished ? 1 : f.total ? f.done / f.total : 0)

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// The whole row is one SVG: the desktop wraps sibling elements onto new lines,
// so title, bar, percent and the mascot live in one drawing; only the count and
// the dismiss are Buttons beside it.
const H = 22
const BAR_H = 16
const MASCOT_W = 22
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Hiragino Sans','Segoe UI',sans-serif"

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s)

// CJK, fullwidth forms and emoji advance about 1em; at 0.56em a Japanese label is sized at half its width.
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏！-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u

// Rough advance of system UI text, in em; good enough to size the title's slot.
const charEm = (ch: string): number =>
  WIDE.test(ch) ? 1 : /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : 0.56

const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

const rowSvg = (f: Flow, W: number, isWorking: boolean): string => {
  // The title takes what it needs, up to 40% of the row; the bar takes the rest.
  const title = fitText(f.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - MASCOT_W)
  const color = f.isFinished ? DONE : ACCENT
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(f))
  const runW = f.total ? Math.round((BAR_W * Math.min(f.total, f.done + f.running)) / f.total) : 0
  const dots: string[] = []

  // Dithered fill: sparse at the start, dense toward the head.
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  // Handed to subagents, not yet done: a faint second layer.
  const faint: string[] = []
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) {
      if (noise(c + 7, r + 3) < 0.2) faint.push(`<rect class="t${Math.floor(noise(r + 5, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }

  const ticks: string[] = []
  for (let i = 1; i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }

  const text = fitText(label(f), 11, BAR_W - 18)
  const pillW = Math.min(BAR_W, Math.round(18 + textWidth(text, 11)))
  const pillX = Math.max(0, Math.min(BAR_W - pillW, fillW - pillW))
  const percent = `${Math.round(ratio(f) * 100)}%`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
/* Pixels twinkle in four out-of-phase groups; a finished bar settles to a slow glow. */
.t0,.t1,.t2,.t3{animation:tw ${f.isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${f.isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${f.isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${f.isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${f.isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="${color}">${dots.join('')}</g>
<g fill="${color}" opacity="0.45">${faint.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(text)}</text>
</g>
<text class="m" x="${W - MASCOT_W - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
${MASCOT_CSS}${mascot(W - MASCOT_W, (H - 16) / 2, 1, '', f.isFinished ? 'done' : 'run', !f.isFinished && isWorking)}
</svg>`
}

const barText = (f: Flow, width: number): string => {
  const filled = Math.round(width * ratio(f))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// ---------------------------------------------------------------------------
// Crew panel: every subagent of the session, plus the tasks the plan lists.

// One color per subagent_type, from a hash of its name: the same type always
// draws in the same color.
const hsl = (h: number, s: number, l: number): string => {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

const colorOf = (type: string): string => {
  if (!type) return '#888780'
  let h = 0x811c9dc5
  for (const ch of type) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return hsl(h % 360, 0.55, 0.5)
}

// "Opus 5.5 · high" for a run, or just the model when no effort was seen.
// The effort word stays in English in every language.
const runModel = (a: AgentRun): string => (a.effort ? `${modelName(a.model)} · ${a.effort}` : modelName(a.model))

// USD per million tokens: input, output, cache read, cache write.
// List prices from https://platform.claude.com/docs/en/about-claude/pricing as of 2026-10.
// A model is priced only when its id, version included, is in this table: no
// family-name match and no default. The engine reports one cache-write count
// with no split by lifetime; writes are priced at the 1-hour rate, which is
// what Claude Code writes on a subscription.
type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

const PRICES: Record<string, Price> = {
  'claude-fable-5-1': [10, 50, 0.25, 20],
  'claude-mythos-5-1': [10, 50, 0.25, 20],
  'claude-fable-5': [10, 50, 1, 20],
  'claude-mythos-5': [10, 50, 1, 20],
  'claude-opus-5-5': [4, 20, 0.2, 8],
  'claude-opus-5': [5, 25, 0.5, 10],
  'claude-opus-4-8': [5, 25, 0.5, 10],
  'claude-opus-4-7': [5, 25, 0.5, 10],
  'claude-opus-4-6': [5, 25, 0.5, 10],
  'claude-sonnet-5-5': [2, 10, 0.1, 4],
  'claude-sonnet-5': [2, 10, 0.2, 4],
  'claude-sonnet-4-6': [3, 15, 0.3, 6],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.2],
  'claude-haiku-4-5': [1, 5, 0.1, 2],
}

// Haiku 5.5 is priced by prompt length: a request whose prompt (input, cache reads and
// cache writes together) is over 100,000 tokens pays these prices instead.
const HAIKU_LONG_PROMPT = 100_000
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1]

// Context windows in tokens, from the same docs as of 2026-10.
const WINDOWS: Record<string, number> = {
  'claude-fable-5-1': 1_000_000,
  'claude-mythos-5-1': 1_000_000,
  'claude-fable-5': 1_000_000,
  'claude-mythos-5': 1_000_000,
  'claude-opus-5-5': 1_000_000,
  'claude-opus-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-5-5': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-5-5': 1_000_000,
  'claude-haiku-4-5': 200_000,
}
const GUESSED_WINDOW = 1_000_000

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// `claude-opus-5-5[1m]` and `claude-haiku-4-5-20251001` name the same version as
// the bare id: only the bracketed variant and the date snapshot are dropped.
const modelKey = (model: string): string =>
  model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{8}$/, '')

const priceOf = (model: string, prompt: number): Price | null => {
  const id = modelKey(model)
  if (id === 'claude-haiku-5-5' && prompt > HAIKU_LONG_PROMPT) return HAIKU_LONG
  return Object.hasOwn(PRICES, id) ? (PRICES[id] ?? null) : null
}

// `isRequest` says the usage is one model request, which is what a prompt-length price
// is set by; a turn's sum is priced at the model's ordinary prices. null: not priced.
const costOf = (model: string, u: Usage, isRequest: boolean): number | null => {
  const prompt = isRequest ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0
  const price = priceOf(model, prompt)
  if (!price) return null
  const [i, o, r, w] = price
  return (
    ((u.input_tokens || 0) * i +
      (u.output_tokens || 0) * o +
      (u.cache_read_input_tokens || 0) * r +
      (u.cache_creation_input_tokens || 0) * w) /
    1e6
  )
}

const addCost = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a + b)

const windowOf = (model: string): { max: number; isGuessed: boolean } => {
  const id = modelKey(model)
  const max = Object.hasOwn(WINDOWS, id) ? WINDOWS[id] : undefined
  return max ? { max, isGuessed: false } : { max: GUESSED_WINDOW, isGuessed: true }
}

const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

const fmtUsd = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

// A run's cost, or "—" when its model is not in the price table.
const fmtCost = (usd: number | null): string => (usd === null ? '—' : `≈${fmtUsd(usd)}`)

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const elapsed = (a: AgentRun, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

type Planned = PlannedTask & { n: number }

const plannedOf = (f: Flow | null, list: AgentRun[]): Planned[] => {
  if (!f || f.isFinished) return []
  const started = new Set(list.map(a => a.taskNo))
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => !started.has(t.n))
}

// `#N ` at the start of an Agent description names the plan's task N; without it the
// description is matched against the task titles. The number is taken off the title.
const TASK_NO = /^#(\d+)\s+/

const linkTask = (f: Flow | null, description: string): { description: string; taskNo?: number } => {
  const tasks = f && !f.isFinished ? f.tasks : []
  const m = TASK_NO.exec(description)
  if (m) {
    const n = Number(m[1])
    return { description: description.slice(m[0].length), taskNo: n >= 1 && n <= tasks.length ? n : undefined }
  }
  const i = tasks.findIndex(t => norm(t.title) === norm(description))
  return { description, taskNo: i >= 0 ? i + 1 : undefined }
}

// The same task run again: by its number, or by its description when it has none.
const isSameTask = (a: AgentRun, taskNo: number | undefined, description: string): boolean =>
  taskNo !== undefined ? a.taskNo === taskNo : !!description && a.taskNo === undefined && norm(a.description) === norm(description)

// Subagents only: the main session's own spend is not counted. The cost sums
// what could be priced; `isPartial` says some run could not, so it is a floor.
const totals = (list: AgentRun[], at: number) => {
  const cost = list.reduce((s, a) => s + (a.costUsd ?? 0), 0)
  const isPartial = list.some(a => a.costUsd === null)
  const tokens = list.reduce((s, a) => s + a.tokens, 0)
  const start = Math.min(...list.map(a => a.startedAt))
  const end = Math.max(...list.map(a => a.endedAt ?? Math.max(at, a.startedAt)))
  return { cost, isPartial, tokens, time: list.length ? end - start : 0 }
}

type Totals = ReturnType<typeof totals>

const fmtTotal = (t: Totals): string => `≈${fmtUsd(t.cost)}${t.isPartial ? '+' : ''}`

// --- desktop drawings: each row is one SVG, as the band above the prompt is.

// The pane's backdrop: a dotted grid as tall as the content laid over it; the
// row SVGs are transparent, so it shows through between their marks.
const GRID_STEP = 16
// A Text or Button row on the desktop is about 20px; the grid errs taller.
const LINE_H = 24
// The engine refuses an Svg taller than 4096px, so a long grid is stacked from
// tiles of at most this height; a multiple of GRID_STEP keeps the dots aligned.
const GRID_TILE = 4096
const gridTiles = (H: number) => Array.from({ length: Math.ceil(H / GRID_TILE) }, (_, i) => Math.min(GRID_TILE, H - i * GRID_TILE))
const gridSvg = (W: number, H: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>.d{fill:#d9d8d4}@media (prefers-color-scheme: dark){.d{fill:#3a3a38}}</style>
<defs><pattern id="g" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse"><circle class="d" cx="${GRID_STEP / 2}" cy="${GRID_STEP / 2}" r="1"/></pattern></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>`

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

// The mendako on its 22×16 grid, `scale` pixels a cell, at (x, y). The band's has no
// type: no costume, and the belly band in the bar's own color.
const mascot = (x: number, y: number, scale: number, type: string, state: MascotState, isMoving = state === 'run', effort?: string): string =>
  `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges">${mendako(type ? costumeOf(type) : 'none', state, type ? colorOf(type) : ACCENT, effort, isMoving)}</g>`

const stateOf = (status: AgentRun['status']): MascotState => (status === 'running' ? 'run' : status === 'done' ? 'done' : 'fail')

// Panel sprites draw two pixels per cell: 44×32.
const SPRITE_SCALE = 2
const TEXT_X = 52

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${MASCOT_CSS}${body}</svg>`

// The pane's own title already says "Crew": the header names the plan, if any.
const headerSvg = (W: number, title: string, t: Totals): string => {
  const s = tr()
  const gap = 6
  const tw = (W - gap * 2) / 3
  const top = title ? 28 : 0
  const tile = (i: number, k: string, v: string) =>
    `<rect class="tile" x="${i * (tw + gap)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s" x="${i * (tw + gap) + 9}" y="${top + 16}" font-family="${FONT}" font-size="11">${k}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="${top + 33}" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${v}</text>`
  return svg(
    W,
    headerHeight(title),
    `${title ? `<text class="t" x="0" y="15" font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}
${tile(0, s.cost, fmtTotal(t))}${tile(1, s.tokens, fmtTokens(t.tokens))}${tile(2, s.time, fmtTime(t.time))}`,
  )
}

const headerHeight = (title: string): number => (title ? 72 : 44)

// The task's own progress when the subagent reports steps; a finished run is full.
const progressOf = (a: AgentRun): number | null => {
  if (a.status === 'done') return 1
  if (a.stepTotal) return Math.min(1, (a.stepDone ?? 0) / a.stepTotal)
  return null
}

// Context fill against the model's window; `isGuessed` when the window table lacks the model.
const ctxOf = (a: AgentRun): { percent: number; isGuessed: boolean } => {
  const w = windowOf(a.model)
  return { percent: Math.min(100, Math.round((a.contextTokens / w.max) * 100)), isGuessed: w.isGuessed }
}

const fmtCtx = (a: AgentRun): string => {
  const c = ctxOf(a)
  return `${tr().ctx} ${c.percent}%${c.isGuessed ? '?' : ''}`
}

// What the alt text adds for the figures a sighted reader sees marked `+` or `?`.
const runAlt = (a: AgentRun, state: string): string => {
  const s = tr()
  const notes = [`${a.taskNo ? `#${a.taskNo} ` : ''}${a.description || a.type}: ${runModel(a)}, ${state}`, fmtCtx(a), fmtCost(a.costUsd)]
  if (ctxOf(a).isGuessed) notes.push(s.guessedWindow)
  return notes.join(', ')
}

const agentSvg = (W: number, a: AgentRun, at: number): string => {
  const s = tr()
  const color = colorOf(a.type)
  const ctx = ctxOf(a)
  const textW = W - TEXT_X - 22
  const meta = [runModel(a)]
  if (a.round > 1) meta.push(`${s.round} ${a.round}`)
  if (a.status === 'failed') meta.push(s.failed)
  const barW = textW
  const progress = progressOf(a)
  const stats = `${fmtCtx(a)} · ${fmtTokens(a.contextTokens)}  ${fmtCost(a.costUsd)}  ${fmtTime(elapsed(a, at))}`
  const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' · ' + a.stepNote : ''}` : ''
  const stepsW = Math.max(0, barW - textWidth(stats, 11) - 12)
  // Without reported steps the bar falls back to the context, drawn grey.
  const fillW = Math.round(barW * (progress ?? ctx.percent / 100))
  return svg(
    W,
    66,
    `${mascot(0, 17, SPRITE_SCALE, a.type, stateOf(a.status), a.status === 'running', a.effort)}
<text class="t" x="${TEXT_X}" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description || a.type, 13, textW))}</text>
<text x="${TEXT_X}" y="34" font-family="${FONT}" font-size="11">${a.taskNo ? `<tspan class="s">#${a.taskNo}  </tspan>` : ''}<tspan fill="${color}">${xml(a.type)}</tspan><tspan class="s">  ${xml(meta.join('  ·  '))}</tspan></text>
${steps && stepsW > 30 ? `<text class="t" x="${TEXT_X}" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
<text class="s" x="${TEXT_X + barW}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(stats)}</text>
<rect class="k" x="${TEXT_X}" y="55" width="${barW}" height="4" rx="2"/><rect${progress === null ? ' class="m"' : ''} x="${TEXT_X}" y="55" width="${fillW}" height="4" rx="2"${progress === null ? '' : ` fill="${color}"`}/>
${statusMark(W - 8, 16, a.status, color)}
<line class="ln" x1="0" y1="65.5" x2="${W}" y2="65.5"/>`,
  )
}

const plannedSvg = (W: number, p: Planned): string => {
  const color = colorOf(p.type)
  const textW = W - TEXT_X - 22
  const meta: string[] = []
  if (p.after.length) meta.push(`${tr().after} ${p.after.join(', ')}`)
  return svg(
    W,
    46,
    `${mascot(0, 7, SPRITE_SCALE, p.type, 'wait')}
<text class="s" x="${TEXT_X}" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${p.n}. ${p.title}`, 13, textW))}</text>
<text x="${TEXT_X}" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(p.type)}</tspan><tspan class="m">  ${xml(meta.join('  ·  '))}</tspan></text>
${statusMark(W - 8, 16, 'planned', color)}
<line class="ln" x1="0" y1="45.5" x2="${W}" y2="45.5"/>`,
  )
}

const compactSvg = (W: number, list: AgentRun[], planned: Planned[], t: Totals): string => {
  const icons = [
    ...list.filter(a => a.status === 'running').map(a => ({ type: a.type, state: stateOf(a.status) })),
    ...list.filter(a => a.status !== 'running').map(a => ({ type: a.type, state: stateOf(a.status) })),
    ...planned.map(p => ({ type: p.type, state: 'wait' as const })),
  ]
  const fit = Math.max(1, Math.floor((W - 150) / 36))
  const shown = icons.slice(0, fit)
  const more = icons.length - shown.length
  const body = shown
    .map(
      (ic, i) =>
        mascot(i * 36, 4, 1.5, ic.type, ic.state) +
        (ic.state === 'run' ? `<circle class="live" cx="${i * 36 + 32}" cy="4" r="3" fill="${colorOf(ic.type)}"/>` : ''),
    )
    .join('')
  const x = shown.length * 36 + (more ? 4 : 0)
  return svg(
    W,
    32,
    `${body}${more ? `<text class="s" x="${x}" y="21" font-family="${FONT}" font-size="12">+${more}</text>` : ''}
<text class="s" x="${W}" y="21" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">${fmtTotal(t)} · ${fmtTokens(t.tokens)} · ${fmtTime(t.time)}</text>`,
  )
}

// --- terminal drawing: the same rows in text.

const ctxBar = (pct: number, width: number): string => {
  const filled = Math.round((width * pct) / 100)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', planned: '◷' }

// Opens the crew pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: tr().pane })
  return true
}

// --- step brief: which subagents are asked to report steps.

// `stepInclude` / `stepExclude` are comma-separated type names.
const typeList = (v: unknown): string[] =>
  typeof v === 'string'
    ? v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : []

// The frontmatter keys an agent file gives as a list: `tools: Read, Grep`,
// `tools: [Read, Grep]` or a YAML list on the lines below the key.
type Frontmatter = { name?: string; tools?: string[]; disallowedTools?: string[] }

const parseFrontmatter = (text: string): Frontmatter | null => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const out: Frontmatter = {}
  let key = ''
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const item = /^\s+-\s*(.+)$/.exec(line)
    if (item && (key === 'tools' || key === 'disallowedTools')) {
      ;(out[key] ??= []).push(unquote(item[1] ?? ''))
      continue
    }
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    key = kv[1] ?? ''
    const value = (kv[2] ?? '').trim()
    if (key === 'name') out.name = unquote(value)
    if (key === 'tools' || key === 'disallowedTools') {
      out[key] = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(unquote)
        .filter(Boolean)
    }
  }
  return out
}

const unquote = (s: string): string => s.trim().replace(/^["']|["']$/g, '')

// Where Claude Code looks for agent files, the project's first: the
// definition there wins over the user's of the same name.
async function agentFile($: EngineInterface, type: string): Promise<Frontmatter | null> {
  const home = await $.env.get('HOME').catch(() => undefined)
  for (const dir of ['.claude/agents', ...(home ? [`${home}/.claude/agents`] : [])]) {
    let entries: { name: string }[] = []
    try {
      entries = await $.fs.list(dir)
    } catch {
      continue
    }
    for (const entry of entries.filter(x => x.name.endsWith('.md'))) {
      try {
        const fm = parseFrontmatter(await $.fs.read(`${dir}/${entry.name}`))
        if (fm?.name === type) return fm
      } catch {
        // An unreadable file names no agent we can check.
      }
    }
  }
  return null
}

const namesStep = (tool: string): boolean => tool === STEP_TOOL || tool === 'mcp__crew-board' || tool === 'mcp__crew-board__*'

// An agent file whose `tools:` leaves the step tool out, or whose
// `disallowedTools:` names it, would get a request it cannot follow.
const fileAllowsStep = (fm: Frontmatter): boolean => {
  if (fm.disallowedTools?.some(namesStep)) return false
  if (fm.tools?.length && !fm.tools.some(t => namesStep(t) || t === '*')) return false
  return true
}

// Built-in and the person's own agent types (no ":") are asked; a plugin's
// (`plugin:agent`, a name an agent file cannot have) are someone else's and left
// alone, unless `stepInclude` names them. `stepExclude` stops any type.
async function shouldBrief($: EngineInterface, type: string, prompt: string, options: Record<string, unknown>): Promise<boolean> {
  if (prompt.includes(STEP_TOOL)) return false
  if (typeList(options.stepExclude ?? 'Explore').includes(type)) return false
  if (type.includes(':') && !typeList(options.stepInclude).includes(type)) return false
  const fm = await agentFile($, type)
  return !fm || fileAllowsStep(fm)
}

async function autoOpen($: EngineInterface, key: string): Promise<void> {
  const p = await read($, panel)
  if (p.autoOpenedFor === key) return
  await update($, panel, prev => ({ ...prev, autoOpenedFor: key }))
  void $.ui.open({ id: PANE, title: tr().pane })
}

export const register: Register = (on, options) => {
  const warnPercent = Number.isFinite(Number(options.contextWarnPercent)) ? Number(options.contextWarnPercent) : 80
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    lang = await detectLang($, options.language)
    await $.tool.register({
      name: 'progress',
      description:
        'Report the plan for work you delegate to subagents, for the progress bar above the prompt and the crew panel. ' +
        'Call it after presenting the plan (title, tasks, optional phase), each time a task is done (done), ' +
        'when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value. ' +
        'Start the description of each Agent call for a planned task with `#N ` (the task\'s number in tasks, e.g. "#2 Write the parser") so the panel can match runs to tasks. ' +
        'Write title, task titles and phase in the language you are using with the user. ' +
        'For the main session only: a call from a subagent is ignored (subagents report with `step`).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the overall task, a few words.' },
          total: { type: 'integer', minimum: 0, description: 'Number of planned subagent tasks; defaults to the length of tasks.' },
          done: { type: 'integer', minimum: 0, description: 'Number of tasks done.' },
          phase: { type: 'string', description: 'The current phase in a word or two, e.g. "Implement".' },
          finished: { type: 'boolean', description: 'True once the plan is complete.' },
          tasks: {
            type: 'array',
            description: 'The planned subagent tasks in order, numbered from 1.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'A few words; reused as the Agent description.' },
                subagent_type: { type: 'string', description: 'The Agent subagent_type the task will run as.' },
                after: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the tasks this one waits for.' },
              },
              required: ['title'],
            },
          },
        },
      },
    })
    await $.tool.register({
      name: 'step',
      description:
        'For subagents: report progress on your own task to the crew panel. ' +
        'Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
        'call it again as each step finishes. Write `note` in the language the brief is written in. Cheap and silent: it only draws a bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      // In every agent's tool list, not behind ToolSearch: subagents do not go looking for it.
      isDeferred: false,
    })
    await $.command.register({
      name: 'crew',
      description: 'Show or hide the crew panel: running, finished and planned subagents with model, context, cost and time',
    })

    // Ticks the running agents' clocks; quiet when nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        if (!list.some(a => a.status === 'running')) return
        const at = await $.clock.now()
        await update($, now, () => at)
      })()
    })
    return started
  })

  on('command.run', { command: 'crew' }, async ($, e) => {
    // `/crew open` opens the panel, or brings it forward from behind another tab, without toggling it.
    if ((e.args ?? '').trim() === 'open') {
      const at = await $.clock.now()
      await update($, now, () => at)
      await $.ui.open({ id: PANE, title: tr().pane })
      return { text: tr().opened }
    }
    const isOpen = await togglePane($)
    return { text: isOpen ? tr().opened : tr().closed }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // The plan is the main session's: a call from a subagent's loop carries its agentId
    // and changes nothing, or any subagent could rename, finish or reset the plan.
    if (e.agentId) return { result: 'ignored: only the main session reports the plan' }
    const input = e as unknown as ProgressInput
    const prev = await read($, flow)
    if (isNewFlow(prev, input) && input.title !== undefined) {
      // A new plan starts with a clean list; agents still running stay.
      await update($, agents, list => list.filter(a => a.status === 'running'))
    }
    const next = await update($, flow, p => merge(p, input))
    if (next && input.tasks?.length) await autoOpen($, next.title)
    if (next?.isFinished && !prev?.isFinished) void $.ui.toast(tr().doneToast(next.title))
    return { result: `ok: ${label(next ?? blank())}` }
  })

  // A subagent's own progress: the call runs in its loop, so agentId names it.
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    let matched = false
    await update($, agents, list =>
      list.map(a => {
        if (a.agentId !== agentId) return a
        matched = true
        const total = Math.max(0, Math.round(Number(input.total ?? a.stepTotal ?? 0) || 0))
        const done = Math.max(0, Math.round(Number(input.done ?? a.stepDone ?? 0) || 0))
        const note = clip(str(input.note), MAX_NOTE)
        return { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: note || undefined }
      }),
    )
    return { result: matched ? 'ok' : `ignored: no panel row for agent ${agentId}` }
  })

  // Safety net: every Agent launch moves the faint layer even if the orchestrator forgets to report.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    // With no plan reported, the first launch starts a blank one: the band shows "N running".
    await update($, flow, prev => {
      const base = prev && !prev.isFinished ? prev : blank()
      return { ...base, running: base.running + 1 }
    })
    try {
      return await next(e)
    } finally {
      await update($, flow, prev => (prev ? { ...prev, running: Math.max(0, prev.running - 1) } : prev))
    }
  })

  on('agent.spawn', async ($, e, next) => {
    // A resumed run or a workflow agent keeps the prompt it has.
    const isBriefed = !e.resume && !e.workflow && (await shouldBrief($, e.subagentType, e.prompt, options))
    const started = await next(isBriefed ? { ...e, prompt: e.prompt + STEP_BRIEF } : e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    const task = linkTask(await read($, flow), e.description)
    await update($, agents, list => {
      const round = 1 + list.filter(a => isSameTask(a, task.taskNo, task.description)).length
      const run: AgentRun = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        type: e.subagentType,
        description: task.description,
        taskNo: task.taskNo,
        model: started.model,
        status: 'running',
        startedAt: at,
        contextTokens: 0,
        tokens: 0,
        costUsd: 0,
        steps: 0,
        round,
      }
      return [...list.filter(a => a.id !== run.id), run].slice(-MAX_RUNS)
    })
    await update($, now, () => at)
    if (options.autoOpen === 'any') await autoOpen($, 'any-agent')
    return started
  })

  // Each model request of a subagent: live context, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result

    const model = usage.model || e.model
    await update($, agents, list =>
      list.map((a): AgentRun =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              effort: typeof e.effort === 'string' ? e.effort : a.effort,
              status: 'running',
              endedAt: undefined,
              contextTokens:
                (usage.input_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.output_tokens || 0),
              tokens:
                a.tokens +
                (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0),
              costUsd: addCost(a.costUsd, costOf(model, usage, true)),
              steps: a.steps + 1,
            },
      ),
    )
    // Once per run: the fill crossed contextWarnPercent (against the 1M guess too).
    const run = (await read($, agents)).find(a => a.agentId === agentId)
    if (run && !run.isCtxWarned && ctxOf(run).percent > warnPercent) {
      await update($, agents, list => list.map(a => (a.agentId === agentId ? { ...a, isCtxWarned: true } : a)))
      void $.ui.toast(tr().ctxToast(run.description || run.type, fmtCtx(run)))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      const at = await $.clock.now()
      const wasRunning = (await read($, agents)).find(a => a.agentId === agentId && a.status === 'running')
      if (wasRunning && e.reason !== 'answer') void $.ui.toast(tr().failedToast(wasRunning.description || wasRunning.type))
      await update($, agents, list =>
        list.map((a): AgentRun => {
          if (a.agentId !== agentId) return a
          // A run whose steps went unseen still gets the turn's own sum.
          const fallback = a.steps === 0 && e.usage
          return {
            ...a,
            status: e.reason === 'answer' ? 'done' : 'failed',
            endedAt: at,
            ...(fallback && e.usage
              ? {
                  model: e.usage.model || a.model,
                  tokens:
                    e.usage.input_tokens +
                    e.usage.output_tokens +
                    e.usage.cache_read_input_tokens +
                    e.usage.cache_creation_input_tokens,
                  costUsd: costOf(e.usage.model || a.model, e.usage, false),
                }
              : {}),
          }
        }),
      )
      await update($, now, () => at)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = tr()
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const f = await read($, flow)
    const p: Panel = await read($, panel)
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const planned = plannedOf(f, list)
    const t = totals(list, at)
    // The pane's title says "Crew"; inside, only the plan's own name.
    const title = f && !f.isFinished ? f.title : ''

    const toggleCompact = (
      <Button
        key="compact"
        label={p.isCompact ? s.expand : s.collapse}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))}
      />
    )
    const toggleDone = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? '▸' : '▾'} ${s.finished} · ${finished.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )
    const isEmpty = list.length === 0 && planned.length === 0
    const summary = `${fmtTotal(t)}${t.isPartial ? ` (${s.unpriced})` : ''}, ${fmtTokens(t.tokens)} ${s.tokensWord}, ${fmtTime(t.time)}`

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      const section = (key: string, text: string) => (
        <Text key={key} dimColor>
          {text}
        </Text>
      )

      if (p.isCompact) {
        return (
          <Box flexDirection="column" gap={1}>
            <Svg source={compactSvg(W, list, planned, t)} alt={`${list.length} ${s.agentsCount}, ${summary}`} width={W} height={32} />
            {toggleCompact}
          </Box>
        )
      }
      const shownDone = p.isDoneCollapsed ? 0 : finished.length
      const lines = 1 + (isEmpty ? 1 : 0) + (running.length > 0 ? 1 : 0) + (finished.length > 0 ? 1 : 0) + (planned.length > 0 ? 1 : 0)
      const gridH = headerHeight(title) + lines * LINE_H + (running.length + shownDone) * 66 + planned.length * 46
      return (
        <Box flexDirection="column">
          {/* The grid sizes the pane; the content is placed over it, as an
              absolute Box paints over the siblings before it. */}
          {gridTiles(gridH).map((tileH, i) => (
            <Svg key={`grid-${i}`} source={gridSvg(W, tileH)} alt="dotted grid" width={W} height={tileH} />
          ))}
          <Box flexDirection="column" position="absolute" top={0} left={0} right={0}>
            <Svg source={headerSvg(W, title, t)} alt={title ? `${title}: ${summary}` : summary} width={W} height={headerHeight(title)} />
            {toggleCompact}
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {running.length > 0 && section('h-run', `${s.running} · ${running.length}`)}
            {running.map(a => (
              <Svg key={a.id} source={agentSvg(W, a, at)} alt={runAlt(a, s.isRunning)} width={W} height={66} />
            ))}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed &&
              finished.map(a => (
                <Svg
                  key={a.id}
                  source={agentSvg(W, a, at)}
                  alt={runAlt(a, a.status === 'failed' ? s.isFailed : s.isFinished)}
                  width={W}
                  height={66}
                />
              ))}
            {planned.length > 0 && section('h-plan', `${s.planned} · ${planned.length}`)}
            {planned.map(pl => (
              <Svg key={`plan-${pl.n}`} source={plannedSvg(W, pl)} alt={`${pl.n}. ${pl.title}: ${s.isPlanned}`} width={W} height={46} />
            ))}
          </Box>
        </Box>
      )
    }

    // Terminal: the same content in text rows.
    const cols = Math.max(24, e.props.bodyColumns || 40)
    const barW = Math.max(6, Math.min(20, cols - 34))
    const row = (a: AgentRun) => {
      const color = colorOf(a.type)
      const ctx = ctxOf(a)
      const progress = progressOf(a)
      const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' ' + a.stepNote : ''} · ` : ''
      return (
        <Box key={a.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={color}>▣</Text>
            <Text bold wrap="truncate-end">
              {a.description || a.type}
            </Text>
            <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>{STATUS_GLYPH[a.status]}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {'  '}
            {a.taskNo ? `#${a.taskNo} · ` : ''}
            {a.type} · {runModel(a)}
            {a.round > 1 ? ` · ${s.round} ${a.round}` : ''}
          </Text>
          <Text wrap="truncate-end">
            {'  '}
            {progress === null ? <Text dimColor>{ctxBar(ctx.percent, barW)}</Text> : <Text color={color}>{ctxBar(progress * 100, barW)}</Text>}
            <Text dimColor>
              {' '}
              {steps}
              {fmtCtx(a)} · {fmtTokens(a.contextTokens)} {fmtCost(a.costUsd)} {fmtTime(elapsed(a, at))}
            </Text>
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate-end">
            {title}
          </Text>
          {toggleCompact}
        </Box>
        <Text dimColor>
          {fmtTotal(t)} · {fmtTokens(t.tokens)} {s.tokensWord} · {fmtTime(t.time)}
        </Text>
        {p.isCompact ? (
          <Text wrap="truncate-end">
            {[...running, ...finished].map(a => (
              <Text key={a.id} color={colorOf(a.type)}>
                {STATUS_GLYPH[a.status]}{' '}
              </Text>
            ))}
            {planned.map(pl => (
              <Text key={`plan-${pl.n}`} dimColor>
                ◷{' '}
              </Text>
            ))}
          </Text>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {running.length > 0 && (
              <Text dimColor>
                {s.running} · {running.length}
              </Text>
            )}
            {running.map(row)}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed && finished.map(row)}
            {planned.length > 0 && (
              <Text dimColor>
                {s.planned} · {planned.length}
              </Text>
            )}
            {planned.map(pl => (
              <Box key={`plan-${pl.n}`} flexDirection="column" marginBottom={1}>
                <Text dimColor wrap="truncate-end">
                  <Text color={colorOf(pl.type)}>▢</Text> {pl.n}. {pl.title} ◷
                </Text>
                <Text dimColor wrap="truncate-end">
                  {'  '}
                  {pl.type}
                  {pl.after.length ? ` · ${s.after} ${pl.after.join(', ')}` : ''}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, flow)
    if (f === null || e.props.hasSurvey) return next(e)
    // Draw this row with the other mods' bands beneath it. Claude Code's own placeholder ({ type: 'engine' }) is
    // never nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const crew = list.length + plannedOf(f, list).length
    const isWorking = list.some(a => a.status === 'running')
    const crewButton = <Button key="crew-agents" label={`×${crew}`} plain onPress={() => void togglePane($)} />
    const percent = `${Math.round(ratio(f) * 100)}%`
    const dismiss = <Button key="crew-dismiss" label="✕" plain role="dismiss" onPress={() => update($, flow, () => null)} />

    // The terminal's element table is completed with an `Svg` that draws nothing: test the surface too.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      // About 8 CSS px per reported column; the rest is the count, the dismiss
      // and their gaps. No floor above the slot: a row wider than it would wrap.
      const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Svg source={rowSvg(f, width, isWorking)} alt={`${f.title}: ${label(f)}, ${percent}`} width={width} height={H} />
            {crewButton}
            {dismiss}
          </Box>
          {below}
        </Box>
      )
    }

    const cols = e.props.bodyColumns
    const titleW = Math.max(8, Math.min(30, f.title.length + 2, Math.floor(cols / 3)))
    const width = Math.max(6, Math.min(40, cols - titleW - 32))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box width={titleW} flexShrink={0}>
            <Text color={f.isFinished ? DONE : ACCENT}>● </Text>
            <Text wrap="truncate-end">{f.title}</Text>
          </Box>
          <Text color={f.isFinished ? DONE : ACCENT}>{barText(f, width)}</Text>
          <Text bold>{label(f)}</Text>
          <Text dimColor>{percent}</Text>
          <Text color="#E8836A">▣</Text>
          {crewButton}
          {dismiss}
        </Box>
        {below}
      </Box>
    )
  })
}
