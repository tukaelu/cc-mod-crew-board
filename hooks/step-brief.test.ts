import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const STEP = 'mcp__crew-board__step'
const SKIP = 'If you cannot find this tool, skip this silently.'

// Agent files on disk, by path; `.claude/agents` is the project's, `/home/me/...` the user's.
// The engine may hand a hook the project path made absolute, so paths match by their tail.
const same = (asked: string, path: string) =>
  asked === path || (!path.startsWith('/') && !asked.startsWith('/home/me/') && asked.endsWith('/' + path))

const disk = (on: On, files: Record<string, string>) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/me' })
  on('fs.list', (_$, e) => {
    const dir = Object.keys(files)
      .map(p => p.slice(0, p.lastIndexOf('/')))
      .find(d => same(e.path, d))
    if (dir === undefined) throw new Error('ENOENT')
    const names = Object.keys(files)
      .filter(p => p.startsWith(dir + '/'))
      .map(p => ({ name: p.slice(dir.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false }))
    return { value: names } as never
  })
  on('fs.read', (_$, e) => {
    const path = Object.keys(files).find(p => same(e.path, p))
    if (path === undefined) throw new Error('ENOENT')
    return { value: files[path] } as never
  })
  // The prompt each type's subagent would start with.
  const briefs = new Map<string, string>()
  on('agent.spawn', (_$, e) => {
    briefs.set(e.subagentType, e.prompt)
    return { model: 'claude-opus-5-5', agentId: `a-${e.subagentType}` }
  })
  return briefs
}

// Spawns `type` and returns the prompt its subagent starts with.
const briefOf = async ($: Engine, briefs: Map<string, string>, type: string, prompt = 'Do the task.') => {
  await $.agent.spawn({ tool_use_id: `t-${type}`, prompt, description: 'Task', subagentType: type, provider: 'engine', parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
  return briefs.get(type)
}

for (const type of ['general-purpose', 'Plan', 'my-writer']) {
  test(`brief: ${type} has no ":" and is asked for steps`, async ($, on) => {
    const briefs = disk(on, {})
    const brief = await briefOf($, briefs, type)
    expect(brief).toContain(STEP)
    expect(brief).toContain(SKIP)
  })
}

test('brief: a plugin agent (with ":") is left alone', async ($, on) => {
  const briefs = disk(on, {})
  expect(await briefOf($, briefs, 'my-plugin:reviewer')).toBe('Do the task.')
})

test('brief: Explore is excluded by default', async ($, on) => {
  const briefs = disk(on, {})
  expect(await briefOf($, briefs, 'Explore')).toBe('Do the task.')
})

test('brief: stepInclude asks a plugin agent, stepExclude stops an own agent', { options: { stepInclude: 'mine:writer, other:x', stepExclude: 'my-writer' } }, async ($, on) => {
  const briefs = disk(on, {})
  expect(await briefOf($, briefs, 'mine:writer')).toContain(STEP)
  expect(await briefOf($, briefs, 'my-writer')).toBe('Do the task.')
  // An explicit stepExclude replaces the default, so Explore is asked again.
  expect(await briefOf($, briefs, 'Explore')).toContain(STEP)
})

test('brief: a brief that already mentions the tool is not asked twice', async ($, on) => {
  const briefs = disk(on, {})
  const prompt = `Report with ${STEP} as you go.`
  expect(await briefOf($, briefs, 'general-purpose', prompt)).toBe(prompt)
})

// Agents narrowed by `tools:` in their file do not have the step tool.
const FILES: Record<string, string> = {
  '.claude/agents/reader.md': '---\nname: reader\ndescription: Reads.\ntools: Read, Grep\n---\nRead things.',
  '.claude/agents/lister.md': '---\nname: lister\ndescription: Lists.\ntools:\n  - Read\n  - mcp__crew-board__step\n---\nList things.',
  '.claude/agents/banned.md': '---\nname: banned\ndescription: No steps.\ndisallowedTools: [mcp__crew-board__step]\n---\nWork.',
  '/home/me/.claude/agents/free.md': '---\nname: free\ndescription: All tools.\n---\nWork.',
  '/home/me/.claude/agents/reader.md': '---\nname: reader\ndescription: Shadowed by the project.\n---\nWork.',
}

test('brief: an agent whose tools leave the step tool out is not asked', async ($, on) => {
  const briefs = disk(on, FILES)
  expect(await briefOf($, briefs, 'reader')).toBe('Do the task.')
  expect(await briefOf($, briefs, 'banned')).toBe('Do the task.')
})

test('brief: an agent that lists the step tool, or has every tool, is asked', async ($, on) => {
  const briefs = disk(on, FILES)
  expect(await briefOf($, briefs, 'lister')).toContain(SKIP)
  expect(await briefOf($, briefs, 'free')).toContain(SKIP)
})
