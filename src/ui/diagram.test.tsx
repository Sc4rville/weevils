// @vitest-environment happy-dom
// Diagrams in a conversation: the mermaid flowcharts agents write and plain « A → B → C » flows are drawn; the rest stays text.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MotionGlobalConfig } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flowLines, flowParagraph, mermaidFlow, ranks } from './diagram'
import { Prose } from './bits'
import { setLang } from '../i18n'

describe('reading a diagram', () => {
  it('a mermaid flowchart: nodes, shapes, labelled and dashed arrows, chains', () => {
    const d = mermaidFlow('flowchart TD\n  A[Phone] -->|brief| B(weevboss)\n  B --> C{Long?}\n  C -- yes --> D[One line] -.-> E((Agent))\n  %% a comment\n  style A fill:#f00')!
    expect(d.dir).toBe('down')
    expect(d.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([['A', 'Phone', 'box'], ['B', 'weevboss', 'round'], ['C', 'Long?', 'decision'], ['D', 'One line', 'box'], ['E', 'Agent', 'round']])
    expect(d.edges).toEqual([{ from: 'A', to: 'B', label: 'brief' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D', label: 'yes' }, { from: 'D', to: 'E', dashed: true }])
    expect(ranks(d)).toEqual([['A'], ['B'], ['C'], ['D'], ['E']])
  })
  it('left to right, branches share a rank, a loop back does not break the order', () => {
    const d = mermaidFlow('graph LR; A-->B; A-->C; B-->D; C-->D; D-->A')!
    expect(d.dir).toBe('right')
    expect(ranks(d)).toEqual([['A'], ['B', 'C'], ['D']])
  })
  it('anything else stays code', () => {
    expect(mermaidFlow('sequenceDiagram\n A->>B: hi')).toBeNull()
    expect(mermaidFlow('graph TD\n this is not a graph line ???')).toBeNull()
  })
  it('a flow line, and a paragraph that is only a flow', () => {
    expect(flowLines('Phone → weevils → agent')).toMatchObject({ dir: 'right', edges: [{ from: 'Phone', to: 'weevils' }, { from: 'weevils', to: 'agent' }] })
    expect(flowParagraph('Brief -> short line -> thread')).not.toBeNull()
    expect(flowParagraph('I moved it → done')).toBeNull()
    expect(flowParagraph('See **this** → that → there')).toBeNull()
    expect(flowParagraph('This sentence is far too long to be a step in any flow, really it is → b → c')).toBeNull()
  })
})

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
beforeEach(() => { setLang('en'); MotionGlobalConfig.skipAnimations = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null) })

it('a reply draws its diagram in place of the code, and a tap opens it full screen', async () => {
  const text = '**Done:** briefs read as one line.\n\n```mermaid\nflowchart TD\n A[weevboss brief] --> B[Agent gets it all]\n A --> C[Thread shows one line]\n```\n\n```python\nprint(1)\n```'
  await act(async () => root.render(<Prose text={text} />))
  expect(host.querySelector('strong')?.textContent).toBe('Done:')
  expect([...host.querySelectorAll('.dg-node')].map((n) => n.textContent)).toEqual(['weevboss brief', 'Agent gets it all', 'Thread shows one line'])
  expect(host.textContent).not.toContain('flowchart')
  expect(host.querySelector('pre')?.textContent).toBe('print(1)')
  await act(async () => host.querySelector<HTMLButtonElement>('.dg-open')!.click())
  expect(document.querySelector('.dg-full [data-node="A"]')).not.toBeNull()
  await act(async () => document.querySelector<HTMLButtonElement>('.dg-close')!.click())
  expect(document.querySelector('.dg-full')).toBeNull()
})
