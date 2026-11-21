/**
 * Small diagrams in a conversation, drawn natively (src/ui/diagram-view.tsx): a mermaid flowchart (the subset agents
 * actually write: nodes, labels, shapes, arrows with labels) or a plain flow line « A → B → C ». No mermaid library:
 * it weighs more than the whole app, and a thread only needs boxes and arrows. Anything else stays code.
 */
export type Shape = 'box' | 'round' | 'decision'
export interface DNode { id: string; label: string; shape: Shape }
export interface DEdge { from: string; to: string; label?: string; dashed?: boolean }
export interface Diagram { dir: 'down' | 'right'; nodes: DNode[]; edges: DEdge[] }

const MAX_NODES = 24
const clean = (s: string) => s.replace(/^["'`]|["'`]$/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()

// A node reference: id, then an optional label in [..], (..), ((..)), ([..]), [(..)], {..}, {{..}}, >..].
const NODE = /^\s*([A-Za-z0-9_](?:\w|-(?![-.>]))*)\s*(\(\(([^)]*)\)\)|\(\[([^\]]*)\]\)|\[\(([^)]*)\)\]|\[\[([^\]]*)\]\]|\{\{([^}]*)\}\}|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}|>([^\]]*)\])?/
// An arrow, with an optional label: -->|x|, -- x -->, -.->, ==>, ---, -.-, ===.
const ARROW = /^\s*(?:(--|==|-\.)\s+([^|>-][^>]*?)\s*(-->|==>|\.->)|(-->|---|==>|===|-\.->|-\.-|--o|--x)(?:\s*\|([^|]*)\|)?)/

function node(src: string, nodes: Map<string, DNode>): [string, string] | null {
  const m = NODE.exec(src)
  if (!m) return null
  const id = m[1]
  const label = [m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11]].find((x) => x !== undefined)
  const shape: Shape = m[10] !== undefined || m[7] !== undefined ? 'decision' : m[9] !== undefined || m[3] !== undefined || m[4] !== undefined ? 'round' : 'box'
  const known = nodes.get(id)
  if (!known) nodes.set(id, { id, label: clean(label ?? id) || id, shape })
  else if (label !== undefined) Object.assign(known, { label: clean(label) || id, shape })
  return [id, src.slice(m[0].length)]
}

/** A mermaid flowchart (graph / flowchart, any direction), or null when it is something else or too big to read. */
export function mermaidFlow(code: string): Diagram | null {
  const lines = code.replace(/%%.*$/gm, '').split(/\n|;/).map((l) => l.trim()).filter(Boolean)
  const head = /^(?:graph|flowchart)(?:\s+(TD|TB|BT|LR|RL))?\s*$/i.exec(lines[0] ?? '')
  if (!head) return null
  const nodes = new Map<string, DNode>()
  const edges: DEdge[] = []
  for (const line of lines.slice(1)) {
    if (/^(subgraph|end$|style|classDef|class|linkStyle|click|direction)\b/i.test(line)) continue
    let rest = line
    const first = node(rest, nodes)
    if (!first) return null
    let [from, after] = first
    rest = after.replace(/^:::\w+/, '')
    while (rest.trim()) {
      const a = ARROW.exec(rest)
      if (!a) return null
      const label = clean(a[2] ?? a[5] ?? '')
      const next = node(rest.slice(a[0].length), nodes)
      if (!next) return null
      edges.push({ from, to: next[0], ...(label ? { label } : {}), ...(/\./.test(a[1] ?? a[3] ?? a[4] ?? '') ? { dashed: true } : {}) })
      ;[from, rest] = [next[0], next[1].replace(/^:::\w+/, '')]
    }
  }
  if (!nodes.size || nodes.size > MAX_NODES) return null
  return { dir: /LR|RL/i.test(head[1] ?? '') ? 'right' : 'down', nodes: [...nodes.values()], edges }
}

const FLOW_ARROW = /\s*(?:→|->|=>|⟶)\s*/
/** « A → B → C », one chain per line (a ```flow block, or a paragraph that is only that). */
export function flowLines(text: string): Diagram | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return null
  const nodes = new Map<string, DNode>()
  const edges: DEdge[] = []
  for (const line of lines) {
    const steps = line.split(FLOW_ARROW).map(clean)
    if (steps.length < 2 || steps.some((s) => !s || s.length > 48)) return null
    steps.forEach((s, i) => {
      if (!nodes.has(s)) nodes.set(s, { id: s, label: s, shape: 'box' })
      if (i) edges.push({ from: steps[i - 1], to: s })
    })
  }
  if (nodes.size > MAX_NODES) return null
  // A single short chain reads across; anything with branches reads down.
  return { dir: lines.length === 1 && nodes.size <= 3 ? 'right' : 'down', nodes: [...nodes.values()], edges }
}

/** A paragraph that is just a flow (« Phone → weevils → agent »), at least three steps: drawn, not written. */
export function flowParagraph(text: string): Diagram | null {
  if (/[*`[\]]/.test(text) || text.split(FLOW_ARROW).length < 3) return null
  return flowLines(text)
}

/** Ranks for a top-down layout: the longest path from a start, back edges (cycles) ignored. */
export function ranks(d: Diagram): string[][] {
  const order = new Map(d.nodes.map((n, i) => [n.id, i]))
  const rank = new Map<string, number>(d.nodes.map((n) => [n.id, 0]))
  const forward = d.edges.filter((e) => e.from !== e.to && order.get(e.from)! < order.get(e.to)!)
  for (let pass = 0; pass < d.nodes.length; pass++) {
    let moved = false
    for (const e of forward) if (rank.get(e.to)! < rank.get(e.from)! + 1) { rank.set(e.to, rank.get(e.from)! + 1); moved = true }
    if (!moved) break
  }
  const rows: string[][] = []
  for (const n of d.nodes) (rows[rank.get(n.id)!] ??= []).push(n.id)
  return rows.filter(Boolean)
}
