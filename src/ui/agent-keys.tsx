// « ChatGPT and agents » (a line of the settings band), in the settings' own colour, one band per part, each one tone
// step from the one above, like the requests page:
//   1. ChatGPT or Claude.ai: the connector's address in a card with a real Copy button, and three short steps; when the
//      connector is off, one button turns it on (weevboss's « connector » brick, server/setup.ts).
//   2. A key for any other agent: a real field and a real button, each key a row (name, dates, Remove with a second
//      tap); a new key is shown once, in a card, with Copy.
//   3. For developers, folded: the API as a code block (server/agent-api.ts, docs/agents.md).

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { AgentKeyCreated, AgentKeysList, AgentKeyView } from '../../shared/agent-keys.ts'
import { noticeKey } from '../../shared/notices.ts'
import { api } from '../api'
import { getLang, useT } from '../i18n'
import M from '../i18n/agent-keys'
import { useApp } from './app-context'
import { Collapse } from './bits'
import { copyText } from './copy'
import { ago } from './format'
import { Icon } from './icons'
import { WeevilLoading } from './loading'
import { Notice } from './notice'
import { device } from './setup'
import { Shell } from './shell'
import './agent-keys.css'

const day = (at: number) => new Date(at).toLocaleDateString(getLang(), { day: 'numeric', month: 'short', year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
const step = (n: number) => ({ '--step': n }) as CSSProperties

/** A real button: Copy, then Copied with a tick for a moment. */
function CopyButton({ text, label, quiet = false }: { text: string; label?: string; quiet?: boolean }) {
  const t = useT(M)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const tm = setTimeout(() => setDone(false), 1800)
    return () => clearTimeout(tm)
  }, [done])
  return (
    <button type="button" className={`ak-btn${quiet ? ' quiet' : ''}${done ? ' done' : ''}`} onClick={() => void copyText(text).then((ok) => ok && setDone(true))}>
      <Icon name={done ? 'check' : 'copy'} />
      <span aria-live="polite">{done ? t.copied : (label ?? t.copy)}</span>
    </button>
  )
}

/** One part of the page: a band, a title, a sentence under it. */
function Part({ n, title, intro, children }: { n: number; title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="ak-part" style={step(n)}>
      <div className="in">
        <h2 className="ak-h">{title}</h2>
        {intro && <p className="ak-intro">{intro}</p>}
        {children}
      </div>
    </section>
  )
}

/** ChatGPT or Claude.ai: the address and three steps, or the button that turns the connector on. */
function ChatPart({ connector, reload }: { connector: string | null; reload: () => Promise<unknown> }) {
  const t = useT(M)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const turnOn = async () => {
    setBusy(true)
    try {
      await api.setupAsk('connector', device())
      await reload()
    } catch {
      /* weevboss says why in its thread */
    } finally {
      setBusy(false)
      setTried(true)
    }
  }
  return (
    <Part n={0} title={t.chatTitle} intro={t.chatIntro}>
      {connector ? (
        <>
          <div className="ak-card">
            <div className="ak-card-label">{t.chatAddress}</div>
            <div className="ak-card-row">
              <code className="ak-mono">{connector}</code>
              <CopyButton text={connector} />
            </div>
          </div>
          <ol className="ak-steps">
            <li>{t.step1}</li>
            <li>
              <span>{t.step2}</span>
              {/* i18n-ignore: product names, the same in every language */}
              <span className="ak-app"><strong>Claude.ai</strong> {t.step2Claude}</span>
              {/* i18n-ignore: product names, the same in every language */}
              <span className="ak-app"><strong>ChatGPT</strong> {t.step2Gpt}</span>
            </li>
            <li>{t.step3}</li>
          </ol>
        </>
      ) : (
        <div className="ak-card">
          <p className="ak-card-text">{tried ? t.chatNeedsHttps : t.chatOff}</p>
          {!tried && (
            <div className="ak-actions">
              <button type="button" className="ak-btn" disabled={busy} onClick={() => void turnOn()}>
                <Icon name="check" />
                <span>{busy ? t.chatTurningOn : t.chatTurnOn}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </Part>
  )
}

/** One key: its colour, its name, its dates; Remove asks once more in the row itself. */
function KeyRow({ k, onRemove }: { k: AgentKeyView; onRemove: () => Promise<void> }) {
  const t = useT(M)
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <li className="ak-key">
      <div className="ak-key-line">
        <span className="ak-dot" style={{ background: k.color || 'var(--ink)' }} aria-hidden />
        <span className="ak-key-text">
          <span className="ak-key-name">{k.name}</span>
          <span className="ak-key-meta">
            {t.created(day(k.createdAt))} · {k.lastUsedAt ? t.used(ago(Date.now() - k.lastUsedAt)) : t.neverUsed}
          </span>
        </span>
        {!sure && (
          <button type="button" className="ak-btn quiet small" onClick={() => setSure(true)}>
            {t.remove}
          </button>
        )}
      </div>
      {sure && (
        <div className="ak-sure" role="group">
          <span>{t.removeSure(k.name)}</span>
          <span className="ak-actions">
            <button type="button" className="ak-btn small" disabled={busy} onClick={() => { setBusy(true); void onRemove().finally(() => setBusy(false)) }}>
              {t.yes}
            </button>
            <button type="button" className="ak-btn quiet small" onClick={() => setSure(false)}>
              {t.keep}
            </button>
          </span>
        </div>
      )}
    </li>
  )
}

/** The API, for whoever writes the agent: a code block, never prose. */
function DevPart({ endpoint }: { endpoint: string }) {
  const t = useT(M)
  const [open, setOpen] = useState(false)
  const code = [
    `# ${t.devSend}`,
    `POST ${endpoint}`,
    `Authorization: Bearer ${t.devKey}`,
    'Content-Type: application/json',
    '',
    `{"text": "${t.devHello}"}`,
    `→ 202 {"id": "msg_…", "status": "sent"}`,
    '',
    `# ${t.devRead}`,
    `GET ${endpoint}/<id>?wait=25`,
    `Authorization: Bearer ${t.devKey}`,
    `→ {"status": "working" | "answered", "reply": "…"}`,
  ].join('\n')
  return (
    <section className="ak-part ak-dev" style={step(2)}>
      <div className="in">
        <button type="button" className="ak-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name="chevron" dir={open ? 'down' : 'right'} />
          <span>{t.devTitle}</span>
        </button>
        <Collapse open={open}>
          <div className="ak-code">
            <pre>{code}</pre>
            <div className="ak-actions">
              <CopyButton text={code} quiet />
            </div>
            <p className="ak-key-meta">{t.devMore}</p>
          </div>
        </Collapse>
      </div>
    </section>
  )
}

export function AgentKeysPage() {
  const t = useT(M)
  const { colors } = useApp()
  const [list, setList] = useState<AgentKeysList | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState<AgentKeyCreated | null>(null)
  const load = useCallback(() => api.agentKeys().then(setList).catch((e) => setErr((e as Error).message)), [])
  useEffect(() => void load(), [load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      setFresh(await api.createAgentKey(name.trim()))
      setName('')
      await load()
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string) => {
    try {
      await api.revokeAgentKey(id)
      if (fresh?.id === id) setFresh(null)
    } catch (x) {
      setErr((x as Error).message)
    }
    await load()
  }

  // The address the agent posts to: the server's (its public address first), else the one this page came from.
  const endpoint = list?.endpoint || `${location.origin}/agent/v1/messages`
  return (
    // The settings' own colour, like the requests page opened from the same band.
    <Shell slot={colors.__foot ?? 'p3'} kicker="weevils" title={t.title}>
      <div className="ak-page">
        {err && <Notice eventId={noticeKey('error:agent-keys', err)} className="band tone calm-note" role="alert"><div className="in">{err}</div></Notice>}
        {!list && !err && <WeevilLoading inline />}
        {list && !list.enabled && <Part n={0} title={t.title} intro={t.notHere}>{null}</Part>}
        {list?.enabled && (
          <>
            <ChatPart connector={list.connector} reload={load} />
            <Part n={1} title={t.keysTitle} intro={t.keysIntro}>
              {fresh && (
                <div className="ak-card ak-fresh" role="status">
                  <div className="ak-card-title">{t.newKey(fresh.name)}</div>
                  <code className="ak-mono ak-secret">{fresh.key}</code>
                  <p className="ak-card-text">{t.newKeyOnce}</p>
                  <div className="ak-actions">
                    <CopyButton text={fresh.key} />
                    <CopyButton text={t.brief(endpoint, fresh.key)} label={t.copyWithHelp} quiet />
                    <button type="button" className="ak-btn quiet" onClick={() => setFresh(null)}>{t.done}</button>
                  </div>
                </div>
              )}
              <form className="ak-new" onSubmit={(e) => void create(e)}>
                <input className="ak-field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} aria-label={t.nameLabel}
                  maxLength={40} autoCapitalize="words" autoCorrect="off" spellCheck={false} disabled={busy} enterKeyHint="done" />
                <button type="submit" className="ak-btn" disabled={!name.trim() || busy}>
                  <Icon name="plus" />
                  <span>{busy ? t.creating : t.create}</span>
                </button>
              </form>
              {list.keys.length ? (
                <ul className="ak-keys">
                  {list.keys.map((k) => <KeyRow key={k.id} k={k} onRemove={() => remove(k.id)} />)}
                </ul>
              ) : (
                <div className="ak-empty">
                  <Icon name="bubble" />
                  <p>
                    <strong>{t.emptyTitle}</strong> {t.emptyText}
                  </p>
                </div>
              )}
            </Part>
            <DevPart endpoint={endpoint} />
          </>
        )}
      </div>
    </Shell>
  )
}
