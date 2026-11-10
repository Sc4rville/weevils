import { OutboxStatus } from './outbox-status'
import { api } from '../api'
import { useEffect, useState, type CSSProperties } from 'react'
import type { ForYouItem, ForYouMedia, VisualProposal } from '../../shared/foryou'
import { useApp } from './app-context'
import { Shell } from './shell'
import { useForYou, type ForYouStore } from './foryou-store'
import { useT } from '../i18n'
import M from '../i18n/foryou-formats'
import './foryou-formats.css'

const tone = (slot: string) => ({ '--c': `var(--${slot})`, background: `var(--${slot})` }) as CSSProperties
/** Retry same-origin media with a fresh URL; never alter signed third-party URLs. */
function mediaAttempt(url: string, attempt: number) {
  if (!attempt) return url
  try {
    const parsed = new URL(url, location.href)
    if (parsed.origin !== location.origin) return url
    parsed.searchParams.set('retry', String(attempt))
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch { return url }
}
export function FullImage({ media, description }: { media: ForYouMedia; description: string }) {
  const { push } = useApp()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const t = useT(M)
  useEffect(() => { setFailed(false); setAttempt(0) }, [media.id, media.url])
  if (failed) return <div className="formats-media-error"><p role="alert">{t.imageUnavailable}</p><button type="button" onClick={() => { setAttempt(n => n + 1); setFailed(false) }}>{t.retryImage}</button></div>
  return <button type="button" className="formats-image" onClick={() => push({ kind: 'media', url: media.url, type: 'image', name: description })} aria-label={`${t.open} · ${description}`}>
    <img key={`${media.id}:${media.url}:${attempt}`} src={mediaAttempt(media.url, attempt)} alt={description} loading="lazy" onError={() => setFailed(true)} /><span>{t.open}</span>
  </button>
}

export function PreviewClip({ media, poster, title }: { media: ForYouMedia; poster?: string; title: string }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const t = useT(M)
  useEffect(() => { setFailed(false); setAttempt(0) }, [media.id, media.url])
  if (failed) return <div className="formats-media-error"><p role="alert">{t.clipUnavailable}</p><button type="button" onClick={() => { setAttempt(n => n + 1); setFailed(false) }}>{t.retryClip}</button></div>
  return <video key={`${media.id}:${media.url}:${attempt}`} controls playsInline preload="none" poster={poster} aria-label={title} src={mediaAttempt(media.url, attempt)} onError={() => setFailed(true)} />
}

export function PictureJourney({ media, frames }: { media: ForYouMedia[]; frames: VisualProposal['frames'] }) {
  const [at, setAt] = useState(0)
  const t = useT(M)
  const count = Math.min(media.length, frames.length)
  const index = Math.min(at, count - 1)
  if (!count) return <p>{t.missing}</p>
  return <div className="formats-journey">
    <div className="formats-story-copy">
      <nav className="formats-steps" aria-label={t.storyTitle}>{frames.slice(0, count).map((f, n) => <button type="button" key={n} aria-current={n === index ? 'step' : undefined} onClick={() => setAt(n)}>{n + 1} · {f.title}</button>)}</nav>
      <div aria-live="polite"><p className="meta">{t.step(index + 1, count)}</p><h3>{frames[index].title}</h3><p>{frames[index].description}</p></div>
      <div className="formats-nav"><button type="button" disabled={index === 0} onClick={() => setAt(index - 1)}>{t.previous}</button><button type="button" disabled={index === count - 1} onClick={() => setAt(index + 1)}>{t.next}</button></div>
    </div>
    <FullImage key={media[index].id} media={media[index]} description={frames[index].description} />
  </div>
}

export function ProposalView({ item, fy }: { item: ForYouItem; fy: ForYouStore }) {
  const t = useT(M)
  const [choice, setChoice] = useState(item.visualProposal?.selected ?? '')
  const p = item.visualProposal
  useEffect(() => setChoice(item.visualProposal?.selected ?? ''), [item.id, item.visualProposal?.selected])
  if (!p) return null
  const selected = p.options.find(o => o.id === choice)
  const pending = fy.acting(item.id)
  const sent = !!p.selected || fy.leftAs(item.id) === 'sent'
  return <section className="formats-proposal in">
    {/* i18n-ignore: project name */}
    <p className="meta">TLO</p><h2>{item.title}</h2><p>{item.text}</p>
    <div className="formats-contact">{(item.media ?? []).map((m, n) => <figure key={m.id}><figcaption><strong>{n + 1} · {p.frames[n]?.title}</strong><p>{p.frames[n]?.description}</p></figcaption><FullImage media={m} description={p.frames[n]?.description ?? m.name} /></figure>)}</div>
    <fieldset disabled={pending || sent}><legend>{p.question}</legend><p>{p.recommendation}</p>
      <div className="formats-options">{p.options.map(o => <label key={o.id} className={choice === o.id ? 'selected' : ''}><input type="radio" name={`choice-${item.id}`} value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} /><span><strong>{o.label}{o.recommended ? ` · ${t.recommended}` : ''}</strong><span>{o.description}</span></span></label>)}</div>
    </fieldset>
    <p className="meta">{p.caveat}</p>
    {selected ? <details key={selected.id}><summary>{t.instruction}</summary><p className="formats-instruction">{selected.instruction}</p></details> : <p>{t.choose}</p>}
    <button type="button" className="formats-send" disabled={!selected || pending || sent} onClick={() => selected && void fy.act(item.id, `choice:${selected.id}`)}>{sent ? t.sent : pending ? t.sending : t.send}</button>
    <OutboxStatus scope={`/api/foryou/${encodeURIComponent(item.id)}/act`} />
    {fy.error(item.id) && <p role="alert">{fy.error(item.id)}</p>}
  </section>
}

export function FormatsPage() {
  const t = useT(M)
  const fy = useForYou()
  const items = fy.feed?.items ?? []
  const media = items.flatMap(i => i.media ?? [])
  const alcove = media.find(m => m.id === 'b442c5405b86603a')
  const clip = media.find(m => m.id === '241bbd0062433326')
  const [example, setExample] = useState<ForYouItem | null>(null)
  useEffect(() => { let live = true; void api.foryouFormats().then(r => { if (live) setExample(r.proposal) }).catch(() => {}); return () => { live = false } }, [])
  const proposal = items.find(i => i.visualProposal) ?? example
  const [kept, setKept] = useState(() => { try { return localStorage.getItem('weevils:format-choice') ?? '' } catch { return '' } })
  const keep = (id: string) => { setKept(id); try { localStorage.setItem('weevils:format-choice', id) } catch { /* storage unavailable */ } }
  const pick = (id: string) => <button type="button" className="formats-keep" aria-pressed={kept === id} onClick={() => keep(id)}>{kept === id ? t.kept : t.keep}</button>
  return <Shell slot="agent" kicker="weevils · TLO" title={t.title}>
    <div className="formats-gallery">
      <div className="in formats-intro"><p>{t.intro}</p><p className="meta">{t.preference}</p></div>
      <section className="band formats-section" style={tone('p3')}><div className="in">
        <p className="meta">{t.result}</p><div className="formats-result"><div><h2>{t.resultTitle}</h2><p>{t.resultText}</p>{pick('result')}</div>{alcove ? <FullImage media={alcove} description={t.resultText} /> : <p>{t.missing}</p>}</div>
      </div></section>
      <section className="band formats-section" style={tone('p6')}><div className="in">
        <p className="meta">{t.story}</p><h2>{t.storyTitle}</h2><p>{t.storyText}</p>
        {proposal?.visualProposal ? <PictureJourney media={proposal.media ?? []} frames={proposal.visualProposal.frames} /> : <p>{t.missing}</p>}{pick('story')}
      </div></section>
      <section className="band formats-section" style={tone('p10')}><div className="in">
        <p className="meta">{t.clip}</p><h2>{t.clipTitle}</h2><p>{t.clipText}</p>
        {clip ? <PreviewClip media={clip} poster={media.find(m => m.id === '341ba5be815fb245')?.url} title={t.clipTitle} /> : <p>{t.missing}</p>}{pick('clip')}
      </div></section>
      <section className="band formats-section" style={tone('agent')}><p className="in meta">{t.proposal}</p>{proposal ? <ProposalView item={proposal} fy={fy} /> : <p className="in">{t.missing}</p>}<div className="in">{pick('proposal')}</div></section>
    </div>
  </Shell>
}
