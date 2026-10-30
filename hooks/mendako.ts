// The mascot: an original mendako (flapjack octopus), ported as-is from
// docs/mendako-reference.html. Canvas 22×16 cells; a rect is [x, y, w, h, color]
// in absolute cells; the body, fins and legs sit relative to `body.origin`.

type Rect = [x: number, y: number, w: number, h: number, color: string]
type Point = [x: number, y: number]
type Anim = { cls: string; delay: number; px: Rect[] }
type Costume = { hat: Rect[]; prop: { still: Rect[]; anim: Anim[] } }

export type CostumeKey = 'explorer' | 'planner' | 'carpenter' | 'detective' | 'wizard' | 'mail' | 'none'
export type MascotState = 'run' | 'done' | 'fail' | 'wait'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const C = {
  body: '#E8836A', fin: '#D06A55', blush: '#F5B3A0', leg: '#C85A48', eye: '#1F1E1D',
  sweat: '#7FB8E8', zz: '#9A9A96', gold: '#F5C542',
  ring: '#4A4A48', glass: '#A9D6F5', wood: '#7A4A26', metal: '#8E929A', dark: '#2A2A2A',
  kelp1: '#3E9B5A', kelp2: '#2E7A44', sand: '#D8C27A',
}

export const MENDAKO = {
  canvas: [22, 16] as Point,
  body: {
    origin: [1, 5] as Point,
    // m: body, p: blush, k: eye (a dot only while working), a: the type's color (belly band)
    rows: [
      '....mmmmmm....',
      '...mmmmmmmm...',
      '..mmmmmmmmmm..',
      '..mmkmmmmkmm..',
      '.mmpmmmmmmpmm.',
      '.mmmmaaaammmm.',
      'mmmmmmmmmmmmmm',
    ],
  },
  // Relative; the right side mirrors x to 13 - x.
  fins: {
    normal: [[1, -1], [2, -1], [0, 0], [1, 0], [2, 0], [1, 1]] as Point[],
    fail: [[1, 2], [0, 2], [0, 3]] as Point[],
  },
  legs: { A: [[0, 7], [4, 7], [8, 7], [12, 7]] as Point[], B: [[2, 7], [6, 7], [10, 7], [13, 7]] as Point[] },
  eyes: [[5, 8], [10, 8]] as Point[], // absolute
  stateEyes: {
    done: ([x, y]: Point): [number, number, number, number][] => [[x - 1, y, 1, 1], [x, y - 1, 1, 1], [x + 1, y, 1, 1]], // ^
    fail: ([x, y]: Point): [number, number, number, number][] => [[x - 1, y - 1, 1, 1], [x + 1, y - 1, 1, 1], [x, y, 1, 1], [x - 1, y + 1, 1, 1], [x + 1, y + 1, 1, 1]], // ×
    wait: ([x, y]: Point): [number, number, number, number][] => [[x - 1, y, 2, 1]], // closed
  },
  sweat: [[2, 4, 1, 2, C.sweat]] as Rect[],
  zz: [[14, 0, 4, 1, C.zz], [16, 1, 1, 1, C.zz], [15, 2, 1, 1, C.zz], [14, 3, 4, 1, C.zz]] as Rect[], // Z
  waitOpacity: 0.5,
  seaweed: {
    heights: { low: 2, medium: 4, high: 6, xhigh: 8, max: 10 } as Record<Effort, number>,
    baseX: 18, bottomY: 12, width: 2,
    sand: [17, 13, 5, 1, C.sand] as Rect,
    maxSparkle: [[21, 1, 1, 1, C.gold], [17, 2, 1, 1, C.gold]] as Rect[],
  },
  // The hat is drawn in every state; prop.still holds still, prop.anim moves (class and delay).
  costumes: {
    explorer: {
      hat: [[6, 2, 4, 1, '#C8A96B'], [6, 3, 4, 1, '#8A6A3A'], [4, 4, 8, 1, '#B0925A']],
      prop: { still: [], anim: [{ cls: 'p-scan', delay: 0, px: [
        [15, 8, 3, 1, C.ring], [15, 10, 3, 1, C.ring], [15, 9, 1, 1, C.ring], [17, 9, 1, 1, C.ring], [16, 9, 1, 1, C.glass], [16, 11, 1, 1, C.wood]] }] },
    },
    planner: {
      hat: [[8, 2, 1, 1, '#3A3F6E'], [6, 3, 5, 1, '#3A3F6E'], [5, 4, 7, 1, '#3A3F6E'],
        [4, 7, 3, 1, C.dark], [4, 9, 3, 1, C.dark], [4, 8, 1, 1, C.dark], [6, 8, 1, 1, C.dark],
        [9, 7, 3, 1, C.dark], [9, 9, 3, 1, C.dark], [9, 8, 1, 1, C.dark], [11, 8, 1, 1, C.dark],
        [7, 8, 2, 1, C.dark]],
      prop: { still: [[15, 11, 3, 2, '#F4F3EE'], [15, 12, 3, 1, '#CFE0FA']], anim: [{ cls: 'p-pen', delay: 0, px: [
        [16, 7, 1, 1, '#E8A0A0'], [16, 8, 1, 2, '#F2C14E'], [16, 10, 1, 1, '#3A3A3A']] }] },
    },
    carpenter: {
      hat: [[7, 1, 2, 1, C.gold], [5, 2, 6, 1, C.gold], [5, 3, 6, 1, C.gold], [7, 1, 1, 3, '#FBE08A'], [4, 4, 8, 1, '#C99A1E']],
      prop: { still: [], anim: [{ cls: 'p-swing', delay: 0, px: [[14, 7, 3, 1, C.metal], [15, 8, 1, 4, C.wood]] }] },
    },
    detective: {
      hat: [[6, 2, 4, 1, '#8A6A3A'], [7, 2, 1, 1, '#A0703F'], [9, 2, 1, 1, '#A0703F'], [5, 3, 6, 1, '#8A6A3A'],
        [6, 3, 1, 1, '#A0703F'], [8, 3, 1, 1, '#A0703F'], [10, 3, 1, 1, '#A0703F'], [4, 4, 8, 1, '#5A3519']],
      prop: { still: [[14, 10, 2, 1, '#5A3519'], [16, 8, 2, 2, '#5A3519'], [16, 8, 1, 1, '#E8604A']], anim: [
        { cls: 'p-smoke', delay: 0, px: [[16, 6, 1, 1, '#C8C8C4']] },
        { cls: 'p-smoke', delay: -0.5, px: [[17, 5, 1, 1, '#C8C8C4']] },
        { cls: 'p-smoke', delay: -1, px: [[16, 4, 1, 1, '#C8C8C4']] }] },
    },
    wizard: {
      hat: [[8, 0, 1, 1, '#6A4FB0'], [7, 1, 2, 1, '#6A4FB0'], [7, 2, 3, 1, '#6A4FB0'], [6, 3, 4, 1, '#6A4FB0'], [4, 4, 8, 1, '#4A3590'], [8, 2, 1, 1, C.gold]],
      prop: { still: [[15, 9, 1, 1, C.wood], [16, 8, 1, 1, C.wood], [17, 7, 1, 1, C.gold]], anim: [{ cls: 'p-twinkle', delay: 0, px: [
        [17, 5, 1, 1, C.gold], [15, 6, 1, 1, C.gold], [17, 9, 1, 1, '#FFF3C4']] }] },
    },
    mail: {
      hat: [[5, 3, 6, 1, '#3A6EA5'], [5, 4, 6, 1, '#3A6EA5'], [11, 4, 1, 1, '#2A5080'], [7, 3, 1, 1, C.gold]],
      prop: { still: [], anim: [{ cls: 'p-bob', delay: 0, px: [
        [15, 9, 3, 2, '#F4F3EE'], [15, 9, 1, 1, '#D8D7D2'], [16, 10, 1, 1, '#D8D7D2'], [17, 9, 1, 1, '#D0453F']] }] },
    },
    none: { hat: [], prop: { still: [], anim: [] } },
  } as Record<CostumeKey, Costume>,
}

// Built-in types have their costume; any other type picks one by a keyword in its
// name, first match wins. Add keywords here.
const BUILTIN: Record<string, CostumeKey> = { Explore: 'explorer', Plan: 'planner', 'general-purpose': 'carpenter' }
const KEYWORDS: [CostumeKey, string[]][] = [
  ['detective', ['research', 'investigate', 'deep']],
  ['wizard', ['review', 'audit']],
  ['mail', ['handoff', 'deliver']],
]

export const costumeOf = (type: string): CostumeKey => {
  if (Object.hasOwn(BUILTIN, type)) return BUILTIN[type] ?? 'none'
  const name = type.toLowerCase()
  return KEYWORDS.find(([, words]) => words.some(w => name.includes(w)))?.[0] ?? 'none'
}

export const isEffort = (v: unknown): v is Effort => typeof v === 'string' && Object.hasOwn(MENDAKO.seaweed.heights, v)

// The sprite's animation, all CSS: it plays only under `.run`, and
// prefers-reduced-motion stops all of it.
export const MASCOT_CSS = `<style>
.run g{transform-box:fill-box}
.run .la{animation:cb-step .5s steps(1) infinite}
.run .lb{animation:cb-step .5s steps(1) infinite -.25s}
.run .bd{animation:cb-bob .5s steps(1) infinite -.125s}
.run .fin{animation:cb-step .25s steps(1) infinite}
.run .p-scan{animation:cb-scan 1s steps(1) infinite}
.run .p-pen{animation:cb-pen .5s steps(1) infinite}
.run .p-swing{transform-origin:50% 100%;animation:cb-swing .5s steps(1) infinite}
.run .p-smoke{animation:cb-up 1.5s steps(5) infinite}
.run .p-twinkle{animation:cb-tw .5s steps(1) infinite}
.run .p-bob{animation:cb-step .5s steps(1) infinite -.25s}
.run .kelp-a{animation:cb-a .8s steps(1) infinite}
.run .kelp-b{animation:cb-b .8s steps(1) infinite}
.run .sparkle{animation:cb-tw .5s steps(1) infinite}
.zz{animation:cb-tw 1.2s steps(1) infinite}
@keyframes cb-step{50%{transform:translateY(-1px)}}
@keyframes cb-bob{50%{transform:translateY(1px)}}
@keyframes cb-scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
@keyframes cb-pen{50%{transform:translateX(-1px)}}
@keyframes cb-swing{50%{transform:rotate(-50deg)}}
@keyframes cb-up{0%{transform:translateY(0);opacity:1}100%{transform:translateY(-4px);opacity:0}}
@keyframes cb-tw{50%{opacity:.15}}
@keyframes cb-a{50%{opacity:0}}
@keyframes cb-b{0%{opacity:0}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){.run *,.zz{animation:none!important}.run .kelp-b{opacity:0}}
</style>`

const R = ([x, y, w, h, c]: Rect): string => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`
const rects = (list: Rect[]): string => list.map(R).join('')
const rel = (pts: Point[], color: string): string =>
  pts.map(([x, y]) => R([x + MENDAKO.body.origin[0], y + MENDAKO.body.origin[1], 1, 1, color])).join('')
const mirror = (pts: Point[]): Point[] => pts.map(([x, y]) => [13 - x, y])

const kelp = (h: number, phase: number): string => {
  const s = MENDAKO.seaweed
  let out = ''
  for (let i = 0; i < h; i++) {
    const off = (Math.floor(i / 2) + phase) % 2
    out += R([s.baseX + off, s.bottomY - i, s.width, 1, i % 2 ? C.kelp2 : C.kelp1])
  }
  return out
}

// The sprite's marks on its 22×16 grid, as the reference's sprite() draws them.
// `isMoving` plays the animation; a working mendako may also be drawn still (the
// band when nothing runs). The seaweed grows with `effort`; none when unknown or waiting.
export const mendako = (costume: CostumeKey, state: MascotState, accent: string, effort?: string, isMoving = state === 'run'): string => {
  const M = MENDAKO
  const cos = M.costumes[costume]
  const [ox, oy] = M.body.origin
  const run = state === 'run'
  let body = ''
  M.body.rows.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      const color = ({ m: C.body, p: C.blush, a: accent, k: run ? C.eye : C.body } as Record<string, string>)[ch]
      if (color) body += R([dx + ox, dy + oy, 1, 1, color])
    }),
  )
  const fins =
    state === 'fail'
      ? rel(M.fins.fail, C.fin) + rel(mirror(M.fins.fail), C.fin)
      : `<g class="fin">${rel(M.fins.normal, C.fin)}${rel(mirror(M.fins.normal), C.fin)}</g>`
  const eyes = state === 'run' ? '' : M.eyes.flatMap(M.stateEyes[state]).map(([x, y, w, h]) => R([x, y, w, h, C.eye])).join('')
  let props = ''
  if (run || state === 'done') {
    props += rects(cos.prop.still)
    props += cos.prop.anim.map(a => `<g class="${a.cls}" style="animation-delay:${a.delay}s">${rects(a.px)}</g>`).join('')
  }
  const sweat = state === 'fail' ? rects(M.sweat) : ''
  const legs = `<g class="la">${rel(M.legs.A, C.leg)}</g><g class="lb">${rel(M.legs.B, C.leg)}</g>`
  let weed = ''
  if (isEffort(effort) && state !== 'wait') {
    const h = M.seaweed.heights[effort]
    weed = R(M.seaweed.sand) + (isMoving ? `<g class="kelp-a">${kelp(h, 0)}</g><g class="kelp-b">${kelp(h, 1)}</g>` : kelp(h, 0))
    if (effort === 'max') weed += `<g class="sparkle">${rects(M.seaweed.maxSparkle)}</g>`
  }
  let s = `${weed}<g class="bd">${body}${fins}${rects(cos.hat)}${eyes}${props}${sweat}</g>${legs}`
  if (isMoving) s = `<g class="run">${s}</g>`
  if (state === 'wait') s = `<g opacity="${M.waitOpacity}">${s}</g><g class="zz">${rects(M.zz)}</g>`
  return s
}
