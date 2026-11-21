// weevils diagram: a backend result drawn as a small product illustration a phone reads at a glance (docs/foryou.md).
// Input: a mermaid flowchart, the subset agents already write, plus a kind per part (`:::server`, `:::phone`…) and
// `:::new` on what changed (`==>` for a new or changed flow). Output: a PNG in the weevils identity: a neutral framed card
// (the same ground as weevils compare, so it reads on every theme's band), one tile per part with its icon from the
// weevils set (24 grid, square ends, right angles), right-angled flows coloured by the part they leave, and the stepped
// "staircase" shadow plus a NEW tag on what changed. Always top to bottom: a phone is taller than wide.
// Uses the same playwright-core as `weevils capture` / `weevils compare`.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { GROUND, browser } from './picture.mjs'

export const USAGE = 'usage: weevils diagram <in.mmd> [out.diagram.png]   (a mermaid flowchart; parts get :::phone :::machine :::server :::agent :::repo :::automation :::data :::cloud :::person :::page :::lock :::notify, what changed :::new, a removed part :::gone, a new flow ==>)'
export const MAX_NODES = 8
export const MAX_LABEL = 28

/** The parts: a weevils icon (src/ui/icons.tsx style: 24 grid, one stroke, square ends) and a signature colour. */
export const KINDS = {
  phone: { color: '#b39bff', icon: 'M7 2h10v20H7zM11 18h2' },
  machine: { color: '#c9b8ff', icon: 'M5 5h14v10H5zM2 19h20' },
  server: { color: '#ffc64c', icon: 'M4 3h16v7H4zM4 14h16v7H4zM8 6.5h2M8 17.5h2' },
  agent: { color: '#7fe0a0', fill: true, icon: 'M8 2h8v2h2v2h2v16h-3v-2h-2v2h-2v-2h-2v2h-2v-2H7v2H4V6h2V4h2zM8 9v4h3V9zM13 9v4h3V9z' },
  repo: { color: '#8fd3ff', icon: 'M6 3v18M18 3v5H6M3 21h6M15 8h6' },
  automation: { color: '#ff8ae0', icon: 'M4 14v6h16V4H4v6M1 7l3 3 3-3' },
  data: { color: '#ffb38a', icon: 'M5 4h14v16H5zM5 9.3h14M5 14.7h14' },
  cloud: { color: '#9fe8de', icon: 'M2 19h20v-7h-4V7h-9v4H2z' },
  person: { color: '#d9ceff', icon: 'M9 3h6v6H9zM4 21v-8h16v8' },
  page: { color: '#c8f07a', icon: 'M3 4h18v16H3zM3 9h18M7 13h6' },
  lock: { color: '#ffa65c', icon: 'M5 11h14v10H5zM8 11V5h8v6M12 15v2' },
  notify: { color: '#ffe066', icon: 'M3 4h18v12H11l-5 4v-4H3z' },
  part: { color: '#e4e0d8', icon: 'M4 4h16v16H4z' },
}
// A part without a kind gets one from its words.
const GUESS = [
  ['phone', /\b(phone|iphone|android|app|pwa|mobile|téléphone)\b/i], ['agent', /\b(agent|claude|codex|session|weevboss|model|ai)\b/i],
  ['repo', /\b(repo|git|github|branch|commit|pr)\b/i], ['automation', /\b(automation|cron|timer|schedule|nightly|job|hook)\b/i],
  ['server', /\b(server|weevilsd|api|daemon|backend|service)\b/i], ['lock', /\b(auth|token|key|secret|allow|permission|security|login)\b/i], ['cloud', /\b(hub|cloud|remote|vps|internet)\b/i],
  ['data', /\b(data|store|file|db|database|disk|history|log|jsonl|memory|cache)\b/i], ['notify', /\b(notification|push|message|mail|alert)\b/i],
  ['machine', /\b(laptop|computer|machine|pc|mac)\b/i], ['person', /\b(you|user|people|team)\b/i], ['page', /\b(page|web|site|report)\b/i],
]
const guess = (s) => (GUESS.find(([, re]) => re.test(s)) ?? ['part'])[0]

const clean = (s) => String(s).replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, ' ').trim()
const NODE = /^\s*([A-Za-z0-9_](?:\w|-(?![-.>=]))*)\s*(\(\(([^)]*)\)\)|\(\[([^\]]*)\]\)|\[\(([^)]*)\)\]|\[\[([^\]]*)\]\]|\{\{([^}]*)\}\}|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?((?::::[\w-]+)*)/
const ARROW = /^\s*(?:(--|==|-\.)\s+([^|>=-][^>]*?)\s*(-->|==>|\.->)|(-->|---|==>|===|-\.->|-\.-)(?:\s*\|([^|]*)\|)?)/

/** The flowchart → { title, nodes, edges }; throws a plain sentence when it can't be drawn well. */
export function parseDiagram(src) {
  let text = String(src).replace(/\r/g, '')
  let title = ''
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (fm) { title = clean((/^title:\s*(.+)$/m.exec(fm[1]) ?? [])[1] ?? ''); text = text.slice(fm[0].length) }
  const lines = text.replace(/%%.*$/gm, '').split(/\n|;/).map((l) => l.trim()).filter(Boolean)
  if (!/^(?:graph|flowchart)\b/i.test(lines[0] ?? '')) throw new Error('start with « flowchart TD » (a mermaid flowchart)')
  const nodes = new Map()
  const edges = []
  const classes = (s) => s.split(':::').filter(Boolean)
  const node = (s) => {
    const m = NODE.exec(s)
    if (!m || !m[0].trim()) return null
    const id = m[1]
    const raw = [m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10]].find((x) => x !== undefined)
    const known = nodes.get(id) ?? { id, label: id, sub: '', kind: '', state: '' }
    if (raw !== undefined) {
      const [label, ...sub] = raw.split(/<br\s*\/?>|\\n/i).map(clean)
      Object.assign(known, { label: label || id, sub: sub.join(' ') })
    }
    for (const c of classes(m[11] ?? '')) {
      if (c === 'new' || c === 'changed' || c === 'gone') known.state = c
      else if (KINDS[c]) known.kind = c
    }
    nodes.set(id, known)
    return [id, s.slice(m[0].length)]
  }
  for (const line of lines.slice(1)) {
    if (/^(subgraph|end$|style|classDef|linkStyle|click|direction)\b/i.test(line)) continue
    const cls = /^class\s+([\w,\s-]+?)\s+([\w-]+)$/i.exec(line)
    if (cls) { for (const id of cls[1].split(',')) node(`${id.trim()}:::${cls[2]}`); continue }
    const first = node(line)
    if (!first) throw new Error(`can't read « ${line} »`)
    let [from, rest] = first
    while (rest.trim()) {
      const a = ARROW.exec(rest)
      if (!a) throw new Error(`can't read « ${line} »`)
      const next = node(rest.slice(a[0].length))
      if (!next) throw new Error(`can't read « ${line} »`)
      const op = a[1] ?? a[4] ?? ''
      const label = clean(a[2] ?? a[5] ?? '')
      edges.push({ from, to: next[0], label, fresh: op.startsWith('=') || (a[3] ?? '').startsWith('='), dashed: op.includes('.') })
      ;[from, rest] = next
    }
  }
  const all = [...nodes.values()]
  if (!all.length) throw new Error('no parts to draw')
  if (all.length > MAX_NODES) throw new Error(`${all.length} parts: keep ${MAX_NODES} at most, the ones that tell the story`)
  for (const n of all) {
    if (!n.kind) n.kind = guess(`${n.id} ${n.label} ${n.sub}`)
    for (const s of [n.label, n.sub, ...edges.filter((e) => e.from === n.id).map((e) => e.label)]) {
      if (s.length > MAX_LABEL) throw new Error(`« ${s} » is too long: ${MAX_LABEL} characters at most, plain words`)
      if (/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,}\b/i.test(s)) throw new Error(`« ${s} » has an id: say what it is in plain words`)
    }
  }
  return { title, nodes: all, edges }
}

/** Rows from the top: each part one row below the parts that lead to it (loops ignored), then ordered to cross less. */
export function rows(d) {
  const ids = d.nodes.map((n) => n.id)
  const into = new Map(ids.map((i) => [i, []]))
  const seen = new Set(), stack = new Set(), back = new Set()
  const out = (i) => d.edges.filter((e) => e.from === i)
  const visit = (i) => {
    seen.add(i); stack.add(i)
    for (const e of out(i)) {
      if (stack.has(e.to)) back.add(e)
      else { into.get(e.to).push(i); if (!seen.has(e.to)) visit(e.to) }
    }
    stack.delete(i)
  }
  for (const i of ids) if (!seen.has(i) && !d.edges.some((e) => e.to === i && e.from !== i)) visit(i)
  for (const i of ids) if (!seen.has(i)) visit(i)
  const rank = new Map()
  const r = (i, guard = 0) => {
    if (rank.has(i)) return rank.get(i)
    const v = guard > ids.length ? 0 : Math.max(-1, ...into.get(i).map((p) => r(p, guard + 1))) + 1
    rank.set(i, v)
    return v
  }
  const grid = []
  for (const i of ids) (grid[r(i)] ??= []).push(i)
  // At most 3 a row: a phone card is narrow. Extra parts wrap to a row of their own.
  const wrapped = grid.flatMap((row) => Array.from({ length: Math.ceil(row.length / 3) }, (_, k) => row.slice(k * 3, k * 3 + 3)))
  for (let k = 1; k < wrapped.length; k++) {
    const pos = new Map(wrapped[k - 1].map((id, j) => [id, j]))
    const bary = (id) => { const p = d.edges.filter((e) => e.to === id && pos.has(e.from)).map((e) => pos.get(e.from)); return p.length ? p.reduce((a, b) => a + b, 0) / p.length : 99 }
    wrapped[k].sort((a, b) => bary(a) - bary(b))
  }
  return wrapped
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
// Darker shades of the kind colours for lines and chips on the light ground (≥ 4.5:1 on GROUND).
export const INK = { phone: '#5b36d6', machine: '#5b36d6', server: '#8a5a00', agent: '#137a3c', repo: '#0b62a3', automation: '#b0178a', data: '#b14a12', cloud: '#0b7368', person: '#5b36d6', page: '#4d7a00', lock: '#a84a00', notify: '#7a6200', part: '#333333' }
export const FRESH = '#128f00'
// The official weevils mark (docs/branding.md), the light-theme tone.
const LOGO_FILE = new URL('../public/branding/weevboss.svg', import.meta.url)
const LOGO = fs.existsSync(LOGO_FILE) ? LOGO_FILE.href : ''

/** The page that draws the card: tiles laid out by CSS, flows drawn after layout by a small script. */
export function diagramPage(d) {
  const grid = rows(d)
  const byId = new Map(d.nodes.map((n) => [n.id, n]))
  const icon = (k) => `<svg viewBox="0 0 24 24" ${KINDS[k].fill ? 'fill="#111" fill-rule="evenodd" shape-rendering="crispEdges"' : 'fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="square" stroke-linejoin="miter"'}><path d="${KINDS[k].icon}"/></svg>`
  const tile = (n, wide) => `<div class="tile ${wide ? 'wide' : ''} ${n.state}" data-node="${esc(n.id)}" style="--k:${KINDS[n.kind].color}">`
    + `${n.state === 'new' || n.state === 'changed' ? `<b class="flag">${n.state === 'new' ? 'NEW' : 'CHANGED'}</b>` : ''}` // i18n-ignore: fixed English tags (app UI language)
    + `<i class="badge">${icon(n.kind)}</i><span class="txt"><span class="label">${esc(n.label)}</span>${n.sub ? `<span class="sub">${esc(n.sub)}</span>` : ''}</span></div>`
  const rowOf = new Map(grid.flatMap((r, i) => r.map((id) => [id, i])))
  const loops = d.edges.some((e) => e.from !== e.to && rowOf.get(e.to) <= rowOf.get(e.from))
  const edges = d.edges.map((e) => ({ ...e, color: e.fresh ? FRESH : INK[byId.get(e.from)?.kind ?? 'part'] }))
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;background:${GROUND};font-family:Inter,-apple-system,'Segoe UI',Roboto,'Liberation Sans',Helvetica,Arial,system-ui,sans-serif;color:#111;display:inline-block}
.card{width:390px;padding:20px 22px 30px;border:4px solid #111;background:radial-gradient(circle,rgb(0 0 0 / .09) 1.2px,transparent 1.6px) 0 0/18px 18px,${GROUND};position:relative}
header{display:flex;align-items:center;gap:10px;margin:0 0 22px;padding-right:44px}
header img{width:38px;height:38px;flex:none}
header h1{font-size:22px;line-height:1.15;font-weight:900;margin:0;letter-spacing:-.01em}
main{position:relative;display:flex;flex-direction:column;gap:58px}
.row{display:flex;justify-content:center;gap:16px;position:relative;z-index:1}
main.loops{padding:0 26px 34px 0}
main.loops .tile:not(.wide){width:auto;flex:0 1 104px}main.loops .tile.wide{width:230px}
.tile{position:relative;z-index:2;background:#fff;border:3px solid #111;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 8px 11px;width:104px;text-align:center;box-shadow:4px 4px 0 #111}
.tile.wide{flex-direction:row;width:250px;text-align:left;gap:12px;padding:10px 12px}
.badge{width:46px;height:46px;flex:none;background:var(--k);border:3px solid #111;display:grid;place-items:center}
.badge svg{width:26px;height:26px}
.txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.label{font-size:17px;font-weight:850;line-height:1.12;overflow-wrap:anywhere}
.wide .label{font-size:19px}
.sub{font-size:13px;font-weight:600;color:#444;line-height:1.2}
.tile.new,.tile.changed{z-index:1;border-width:4px;box-shadow:3px 3px 0 #111,6px 6px 0 ${FRESH},9px 9px 0 #111,0 0 28px 10px rgb(31 214 10 / .42)}
.flag{position:absolute;top:-15px;right:-10px;background:#1fd60a;color:#000;font-size:13px;font-weight:900;letter-spacing:.08em;padding:3px 8px;border:2px solid #111}
.tile.gone{background:transparent;border-style:dashed;box-shadow:none;opacity:.55}
.tile.gone .label{text-decoration:line-through}
svg.flows{position:absolute;left:0;top:0;overflow:visible;z-index:0}
.chip{position:absolute;z-index:2;transform:translate(-50%,-50%);background:#fff;border:2.5px solid var(--c);color:var(--c);font-size:13px;font-weight:800;padding:2px 8px;white-space:nowrap}
.chip.fresh{background:#1fd60a;border-color:#111;color:#000}
</style></head><body><div class="card">
${d.title ? `<header>${LOGO ? `<img src="${LOGO}" alt="">` : ''}<h1>${esc(d.title)}</h1></header>` : ''}
<main class="${loops ? 'loops' : ''}">${grid.map((row) => `<div class="row">${row.map((id) => tile(byId.get(id), row.length === 1)).join('')}</div>`).join('')}</main>
</div><script>
const edges = ${JSON.stringify(edges)}
const main = document.querySelector('main')
const o = main.getBoundingClientRect()
const at = (id) => { const r = document.querySelector('[data-node="' + CSS.escape(id) + '"]').getBoundingClientRect(); return { l: r.left - o.left, r: r.right - o.left, t: r.top - o.top, b: r.bottom - o.top, x: (r.left + r.right) / 2 - o.left, y: (r.top + r.bottom) / 2 - o.top } }
const NS = 'http://www.w3.org/2000/svg'
const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'flows'); svg.setAttribute('width', o.width); svg.setAttribute('height', o.height)
main.prepend(svg)
const used = new Map()
// Several flows leaving or entering one side spread out instead of sharing a line.
const slot = (key, n) => { const k = used.get(key) ?? 0; used.set(key, k + 1); return k }
const count = (pick) => { const m = new Map(); for (const e of edges) { const k = pick(e); m.set(k, (m.get(k) ?? 0) + 1) } return m }
const outs = count((e) => e.from), ins = count((e) => e.to)
const spread = (box, i, n) => n <= 1 ? box.x : box.l + ((box.r - box.l) * (i + 1)) / (n + 1)
for (const e of edges) {
  const a = at(e.from), b = at(e.to)
  let d, lx, ly
  const head = (x, y, dir) => dir === 'down' ? 'M' + (x - 7) + ',' + (y - 9) + 'L' + x + ',' + y + 'L' + (x + 7) + ',' + (y - 9) : dir === 'up' ? 'M' + (x - 7) + ',' + (y + 9) + 'L' + x + ',' + y + 'L' + (x + 7) + ',' + (y + 9) : 'M' + (x + 9) + ',' + (y - 7) + 'L' + x + ',' + y + 'L' + (x + 9) + ',' + (y + 7)
  let tip
  if (b.t > a.b) {
    const x1 = spread(a, slot('o' + e.from), outs.get(e.from)), x2 = spread(b, slot('i' + e.to), ins.get(e.to))
    const y1 = a.b + 2, y2 = b.t - 4, m = Math.round((y1 + y2) / 2)
    d = Math.abs(x1 - x2) < 2 ? 'M' + x1 + ',' + y1 + 'V' + y2 : 'M' + x1 + ',' + y1 + 'V' + m + 'H' + x2 + 'V' + y2
    tip = head(x2, y2, 'down'); lx = x2; ly = Math.abs(x1 - x2) < 2 ? m : Math.round((m + y2) / 2)
  } else if (e.from === e.to) {
    continue
  } else {
    // Back up to an earlier part (a loop or a reply): around the right-hand side, at right angles.
    // Out under the part, then up the right-hand gutter, clear of every tile.
    const side = Math.max(...[...document.querySelectorAll('.tile')].map((t) => t.getBoundingClientRect().right - o.left)) + 14 + slot('side') * 10
    const x1 = spread(a, slot('o' + e.from), outs.get(e.from)), y1 = a.b + 18
    d = 'M' + x1 + ',' + (a.b + 2) + 'V' + y1 + 'H' + side + 'V' + b.y + 'H' + (b.r + 8)
    tip = head(b.r + 8, b.y, 'left'); lx = Math.round((x1 + side) / 2); ly = y1
  }
  for (const [p, w] of [[d, e.fresh ? 7 : 4.5], [tip, e.fresh ? 7 : 4.5]]) {
    const path = document.createElementNS(NS, 'path'); path.setAttribute('d', p); path.setAttribute('fill', 'none')
    path.setAttribute('stroke', e.color); path.setAttribute('stroke-width', w); path.setAttribute('stroke-linecap', 'square'); path.setAttribute('stroke-linejoin', 'miter')
    if (e.dashed && p === d) path.setAttribute('stroke-dasharray', '9 7')
    svg.append(path)
  }
  if (e.label) {
    const c = document.createElement('span'); c.className = 'chip' + (e.fresh ? ' fresh' : ''); c.style.setProperty('--c', e.color)
    c.textContent = e.label; c.style.left = lx + 'px'; c.style.top = ly + 'px'; main.append(c)
  }
}
document.body.dataset.ready = '1'
</script></body></html>`
}

/** Draws the flowchart file into a PNG (3× for a crisp phone picture). */
export async function renderDiagram(src, out) {
  const d = parseDiagram(fs.readFileSync(src, 'utf8'))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-diagram-'))
  const html = path.join(tmp, 'diagram.html')
  fs.writeFileSync(html, diagramPage(d))
  const b = await browser()
  try {
    const page = await b.newPage({ deviceScaleFactor: 3 })
    await page.goto(pathToFileURL(html).href)
    await page.waitForSelector('body[data-ready]')
    await page.locator('.card').screenshot({ path: out })
  } finally {
    await b.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  return out
}

/** in.mmd → in.diagram.png next to it. */
export const defaultOut = (src) => src.replace(/\.(mmd|mermaid)$/i, '') + '.diagram.png'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [src, out] = process.argv.slice(2)
  try {
    if (!src || src === '--help') throw new Error(USAGE)
    const dest = path.resolve(out ?? defaultOut(src))
    if (!/\.png$/i.test(dest)) throw new Error('the output is a .png')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    console.log(await renderDiagram(path.resolve(src), dest))
  } catch (e) {
    console.error(`weevils diagram: ${e.message}`)
    process.exit(1)
  }
}
