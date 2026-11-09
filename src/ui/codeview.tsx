import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ExplainReply, ExplainRequest, Message } from '../../shared/api.ts'
import { api, type FileContent } from '../api'
import { useApp } from './app-context'
import { Shell } from './shell'
import { VoiceLogo } from './voice'
import { Icon } from './icons'
import { plain } from './format'
import { around, lineRange, selText, spanLines, spanWords, wordAt, type Sel } from './codesel'
import { useT } from '../i18n'
import M from '../i18n/pages'
import C from '../i18n/codeview'
import './codeview.css'

/**
 * Vue d'un fichier qu'on interroge : chaque mot répond au tap (surligné dans la couleur du projet), un glissé prend
 * plusieurs mots, la marge des numéros prend des lignes entières. Sous la sélection, une barre de mots : explique,
 * où c'est utilisé, demande. Les réponses arrivent sur place, d'un modèle rapide qui connaît la page.
 * Le logo de weevboss, en haut, écoute aussi : la question dictée porte sur la sélection, ou sur ce qui est affiché.
 */

type Mode = ExplainRequest['mode']

interface Answer {
  id: string
  mode: Mode
  loading: boolean
  reply?: ExplainReply
  err?: string
  /** Question transmise au vrai weevboss : sa réponse est le premier message après cet instant. */
  since?: number
  voice?: boolean
}

/** Bord gauche réservé au geste retour (glisser vers la droite depuis le bord). */
const EDGE = 22

const caretAt = (x: number, y: number): { node: Node; offset: number } | null => {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  const r = document.caretRangeFromPoint?.(x, y)
  return r ? { node: r.startContainer, offset: r.startOffset } : null
}

const rangeIn = (el: Element, s: number, e: number): Range | null => {
  // Retrouve les nœuds texte (la ligne peut être coupée par le surlignage) pour mesurer un mot à l'écran.
  const r = document.createRange()
  let pos = 0
  let started = false
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const len = n.textContent?.length ?? 0
    if (!started && s <= pos + len) {
      r.setStart(n, s - pos)
      started = true
    }
    if (started && e <= pos + len) {
      r.setEnd(n, e - pos)
      return r
    }
    pos += len
  }
  return null
}

/** Le point (x, y) dans le fichier : ligne, colonne, mot sous le doigt, ou la marge des numéros. */
function hit(box: HTMLElement, lines: string[], x: number, y: number): { line: number; col: number; gutter: boolean; word: [number, number] | null } | null {
  const el = document.elementFromPoint(x, y)
  const row = el?.closest<HTMLElement>('[data-l]')
  if (!row || !box.contains(row)) return null
  const line = Number(row.dataset.l)
  if (el?.closest('[data-g]')) return { line, col: 0, gutter: true, word: null }
  const ct = row.querySelector('.ct')
  const c = caretAt(x, y)
  if (!ct || !c || !ct.contains(c.node)) return { line, col: (lines[line] ?? '').length, gutter: false, word: null }
  const pre = document.createRange()
  pre.setStart(ct, 0)
  pre.setEnd(c.node, c.offset)
  const col = pre.toString().length
  // Le curseur tombe entre deux caractères : le mot retenu est celui qui est vraiment sous le doigt.
  for (const k of [col, col - 1]) {
    const w = wordAt(lines[line] ?? '', k)
    const r = w && rangeIn(ct, w[0], w[1])
    if (!w || !r) continue
    for (const rect of r.getClientRects()) if (x >= rect.left - 3 && x <= rect.right + 3 && y >= rect.top - 2 && y <= rect.bottom + 2) return { line, col: k, gutter: false, word: w }
  }
  return { line, col, gutter: false, word: null }
}

const CodeLine = memo(function CodeLine({ n, text, s, e, whole, flash }: { n: number; text: string; s: number; e: number; whole: boolean; flash: boolean }) {
  const on = e > s
  return (
    <div className={`cl${whole ? ' whole' : ''}${flash ? ' flash' : ''}`} data-l={n}>
      <span className="cg" data-g aria-hidden>
        {n + 1}
      </span>
      <span className="ct">
        {on ? (
          <>
            {text.slice(0, s)}
            <mark>{text.slice(s, e)}</mark>
            {text.slice(e)}
          </>
        ) : (
          text || ' '
        )}
      </span>
    </div>
  )
})

export function CodeFile({ projectId, repo, path, machine, line, file, err }: { projectId: string; repo: string; path: string; machine: string; line?: number; file: FileContent | null; err: string | null }) {
  const { colors, snap, push } = useApp()
  const t = useT(M)
  const c = useT(C)
  const prose = /\.(md|markdown|txt)$/i.test(path)
  const lines = useMemo(() => (file && !file.binary ? file.content.replace(/\n$/, '').split('\n') : []), [file])
  const box = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState<Sel | null>(null)
  const [dragging, setDragging] = useState(false)
  /** Ligne sous laquelle s'ouvre la question quand rien n'est sélectionné (logo vocal). */
  const [spot, setSpot] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [copied, setCopied] = useState(false)
  const [flash, setFlash] = useState<number | null>(null)
  const heard = useRef('')
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  const reset = useCallback(() => {
    seq.current++
    setAnswer(null)
    setAsking(false)
    setDraft('')
    setCopied(false)
  }, [])

  // ---- Gestes : tap = un mot ; glissé horizontal = des mots ; marge = des lignes ; glissé vertical = défilement.
  const selRef = useRef(sel)
  selRef.current = sel
  const spotRef = useRef(spot)
  spotRef.current = spot
  /** Pendant un geste, la barre reste où elle était : rien ne bouge sous le doigt. Elle rejoint la sélection au lâcher. */
  const frozen = useRef<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    let g: { id: number; x: number; y: number; at: NonNullable<ReturnType<typeof hit>>; mode: 'pending' | 'words' | 'lines' | 'off' } | null = null
    const hold = () => {
      frozen.current = selRef.current ? selRef.current.end.line : spotRef.current
      setDragging(true)
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('.qa')) return
      if (e.clientX < EDGE) return // le geste retour garde le bord
      const h = hit(el, lines, e.clientX, e.clientY)
      if (!h) return
      // Sur un mot ou dans la marge, le geste est à nous : la page ne part pas en arrière.
      if (h.word || h.gutter) e.stopPropagation()
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, at: h, mode: h.gutter ? 'lines' : 'pending' }
      if (h.gutter) {
        el.setPointerCapture(e.pointerId)
        hold()
        setSel(spanLines(lines, h.line, h.line))
      }
    }
    const move = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id || g.mode === 'off') return
      const dx = e.clientX - g.x
      const dy = e.clientY - g.y
      if (g.mode === 'pending') {
        const mouse = e.pointerType === 'mouse'
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && !(mouse && Math.hypot(dx, dy) > 4)) return
        // Au doigt, un départ vertical fait défiler ; un départ horizontal sur un mot sélectionne.
        if (!g.at.word || (!mouse && Math.abs(dy) > Math.abs(dx))) {
          g.mode = 'off'
          return
        }
        g.mode = 'words'
        el.setPointerCapture(e.pointerId)
        hold()
      }
      e.stopPropagation()
      const h = hit(el, lines, e.clientX, e.clientY)
      if (!h) return
      if (g.mode === 'lines') setSel(spanLines(lines, g.at.line, h.line))
      else setSel(spanWords(lines, { line: g.at.line, col: g.at.col }, { line: h.line, col: h.col }))
    }
    const up = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return
      const was = g
      g = null
      setDragging(false)
      if (was.mode === 'off') return
      reset()
      setSpot(null)
      if (was.mode !== 'pending') return
      // Tap : le mot sous le doigt, ou rien (tap à côté = tout ferme).
      const w = was.at.word
      const cur = selRef.current
      if (w && !(cur && !cur.lines && cur.start.line === was.at.line && cur.end.line === was.at.line && cur.start.col === w[0] && cur.end.col === w[1])) {
        setSel({ start: { line: was.at.line, col: w[0] }, end: { line: was.at.line, col: w[1] } })
      } else setSel(null)
    }
    const cancel = (e: PointerEvent) => {
      if (g && e.pointerId === g.id) {
        g = null
        setDragging(false)
      }
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
    }
  }, [lines, reset])

  // ---- Arrivée depuis « où c'est utilisé » : la ligne visée, au centre, un éclair de couleur.
  const goLine = useCallback((n: number) => {
    const row = box.current?.querySelector<HTMLElement>(`[data-l="${n}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    setFlash(null)
    requestAnimationFrame(() => setFlash(n))
  }, [])
  useLayoutEffect(() => {
    if (line && lines.length) goLine(Math.min(line, lines.length) - 1)
  }, [line, lines.length, goLine])

  /** Lignes affichées à l'écran (0-based), pour une question sans sélection. */
  const visible = (): [number, number] => {
    const el = box.current
    const sc = el?.closest('[data-scroll]')
    if (!el || !sc || !lines.length) return [0, Math.min(lines.length - 1, 30)]
    const { top, bottom } = sc.getBoundingClientRect()
    const rows = el.querySelectorAll<HTMLElement>('[data-l]')
    const find = (y: number) => {
      let lo = 0
      let hi = rows.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (rows[mid].getBoundingClientRect().bottom < y) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    return [find(top + 8), find(bottom - 8)]
  }

  // ---- Questions
  const ask = async (mode: Mode, question?: string, voice = false) => {
    const id = `${++seq.current}`
    const [from, to] = sel ? [sel.start.line, sel.end.line] : spot != null ? [spot, spot] : visible()
    const body: ExplainRequest = {
      mode,
      repo,
      path,
      machine,
      selection: sel ? selText(lines, sel) : '',
      from: from + 1,
      to: to + 1,
      around: around(lines, from, to),
      question,
    }
    setAnswer({ id, mode, loading: true, voice })
    try {
      const reply = await api.explain(body)
      if (seq.current !== Number(id)) return
      setAnswer({ id, mode, loading: !!reply.forwarded, reply, since: reply.forwarded ? Date.now() - 2000 : undefined, voice })
    } catch (e) {
      if (seq.current === Number(id)) setAnswer({ id, mode, loading: false, err: (e as Error).message, voice })
    }
  }
  const submit = (voice = false) => {
    const q = draft.trim()
    if (!q) return
    setAsking(false)
    setDraft('')
    void ask('ask', q, voice)
  }
  const copy = () => {
    if (!sel) return
    void navigator.clipboard?.writeText(selText(lines, sel)).then(() => setCopied(true)).catch(() => undefined)
  }

  // Une demande d'action est partie au vrai weevboss : sa réponse, dès qu'elle arrive dans son fil, s'affiche ici aussi.
  const forwardedReply: Message | undefined = answer?.since ? snap.main.find((m) => m.role === 'assistant' && m.at >= answer.since!) : undefined
  const shown = forwardedReply ? plain(forwardedReply.text) : answer?.reply?.text
  const waiting = answer ? (answer.reply?.forwarded ? !forwardedReply : answer.loading) : false

  useEffect(() => {
    if (asking) input.current?.focus({ preventScroll: true })
  }, [asking])

  // ---- Logo vocal : le texte entendu remplit la question, sous la sélection ou sous la première ligne affichée.
  const voiceText = (x: string) => {
    heard.current = heard.current ? `${heard.current} ${x}` : x
    if (!sel && spot == null) setSpot(visible()[0])
    seq.current++
    setAnswer(null)
    setAsking(true)
    setDraft(heard.current)
  }
  const voiceSend = () => {
    const q = (heard.current || draft).trim()
    heard.current = ''
    if (!q) return
    setAsking(false)
    setDraft('')
    void ask('ask', q, true)
  }

  const anchor = dragging ? frozen.current : sel ? sel.end.line : spot
  const panel =
    anchor != null ? (
      <div className={dragging ? 'qa held' : 'qa'}>
        {sel && (
          <div className="words qa-bar" role="group">
            <button className={`word ${answer?.mode === 'explain' ? 'on' : ''}`} onClick={() => void ask('explain')}>
              {c.explain}
            </button>
            <button className={`word ${answer?.mode === 'usage' ? 'on' : ''}`} onClick={() => void ask('usage')}>
              {c.usage}
            </button>
            <button className={`word ${asking || answer?.mode === 'ask' ? 'on' : ''}`} onClick={() => (setAnswer(null), setAsking(true))}>
              {c.ask}
            </button>
            <button className={`word ${copied ? 'on' : ''}`} onClick={copy}>
              {copied ? c.copied : c.copy}
            </button>
          </div>
        )}
        {asking && (
          <form
            className="qa-ask"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <span className="strong" aria-hidden>
              <Icon name="chevron" dir="right" />
            </span>
            <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAsking(false)} aria-label={c.askLabel} enterKeyHint="send" />
          </form>
        )}
        {answer && (
          <div className="qa-answer" aria-live="polite">
            {waiting && !shown && (
              <span className="spin fluo">
                <Icon name="star" />
              </span>
            )}
            {answer.err && <div className="strong">! {answer.err}</div>}
            {shown && <p className="qa-text">{shown}</p>}
            {answer.reply?.hits && (
              <div className="qa-hits">
                {answer.reply.hits.length === 0 && <div className="meta">{c.nowhere}</div>}
                {answer.reply.hits.map((h, i) => (
                  <button
                    key={`${h.path}:${h.line}:${i}`}
                    className="qa-hit"
                    onClick={() => (h.path === path ? goLine(h.line - 1) : push({ kind: 'file', projectId, repo, path: h.path, line: h.line }))}
                  >
                    <span className="strong">
                      {h.path === path ? '' : h.path}:{h.line}
                    </span>
                    <span className="qa-snip">{h.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    ) : null

  const replyKey = answer?.voice ? (forwardedReply?.id ?? (answer.reply && !answer.reply.forwarded ? answer.id : undefined)) : undefined
  return (
    <Shell
      slot={colors[projectId] ?? 'agent'}
      kicker={`${repo}/${path.split('/').slice(0, -1).join('/')}`}
      title={path.split('/').pop()}
      meta={file ? `${t.size(file.size)}${file.truncated ? t.truncated : ''}` : t.reading}
      action={
        file && !file.binary ? (
          <div className="page-voice">
            <VoiceLogo take={() => ''} onText={voiceText} onSend={voiceSend} replyKey={replyKey} replyText={shown} working={waiting} />
          </div>
        ) : undefined
      }
    >
      {err && (
        <div className="band invert" role="alert">
          <div className="in meta" style={{ paddingBlock: 12 }}>
            ! {err}
          </div>
        </div>
      )}
      {file?.binary && <div className="in meta empty">{t.binary}</div>}
      {file && !file.binary && (
        <div ref={box} className={`in code lines ${prose ? '' : 'mono'}`} style={{ ['--gw' as string]: `${String(lines.length).length}ch` }}>
          {lines.map((text, i) => {
            const r = lineRange(sel, i, text.length)
            return (
              <Fragment key={i}>
                <CodeLine n={i} text={text} s={r ? r[0] : 0} e={r ? r[1] : 0} whole={!!sel?.lines && !!r} flash={flash === i} />
                {i === anchor && panel}
              </Fragment>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

