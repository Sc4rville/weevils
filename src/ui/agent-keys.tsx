// The agent keys page (a line of the settings band): keys that let a bot or a web agent write to weevboss and read its
// replies (server/agent-api.ts, docs/agents.md). The keys in use (name, created, last used, « revoke » with a second
// tap to confirm), a field and a link to make one, the new key shown once with « copy », and what the agent needs: the
// address it posts to, built from this weevils' public address. The connector's address for ChatGPT or Claude.ai
// when it is on. Actions are coloured links in the line, never big buttons.

import { useCallback, useEffect, useState } from 'react'
import type { AgentKeyCreated, AgentKeysList, AgentKeyView } from '../../shared/agent-keys.ts'
import { noticeKey } from '../../shared/notices.ts'
import { api } from '../api'
import { getLang, useT } from '../i18n'
import M from '../i18n/agent-keys'
import { copyText } from './copy'
import { ago } from './format'
import { WeevilLoading } from './loading'
import { Notice } from './notice'
import { Shell } from './shell'
import './agent-keys.css'

const day = (at: number) => new Date(at).toLocaleDateString(getLang(), { day: 'numeric', month: 'short', year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })

/** « copy », then « copied » a moment. */
function CopyLink({ text, label }: { text: string; label?: string }) {
  const t = useT(M)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const tm = setTimeout(() => setDone(false), 1800)
    return () => clearTimeout(tm)
  }, [done])
  return (
    <button type="button" className="link inline" onClick={() => void copyText(text).then((ok) => ok && setDone(true))}>
      {done ? t.copied : (label ?? t.copy)}
    </button>
  )
}

/** One key: its name in its colour, its dates, « revoke » (a second tap confirms). */
function KeyRow({ k, onRevoke }: { k: AgentKeyView; onRevoke: () => Promise<void> }) {
  const t = useT(M)
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <div className="in ak-row">
      <span className="ak-name">
        <span className="ak-dot" style={{ background: k.color || 'var(--ink)' }} aria-hidden />
        <span className="strong">{k.name}</span>
      </span>
      <span className="meta">
        {t.created(day(k.createdAt))} · {k.lastUsedAt ? t.used(ago(Date.now() - k.lastUsedAt)) : t.neverUsed}
      </span>
      {sure ? (
        <span className="ak-sure">
          <span className="meta">{t.revokeSure(k.name)}</span>{' '}
          <button type="button" className="link inline ak-danger" disabled={busy} onClick={() => { setBusy(true); void onRevoke().finally(() => setBusy(false)) }}>{t.yes}</button>
          {' · '}
          <button type="button" className="link inline" onClick={() => setSure(false)}>{t.no}</button>
        </span>
      ) : (
        <button type="button" className="link inline ak-danger" onClick={() => setSure(true)}>{t.revoke}</button>
      )}
    </div>
  )
}

export function AgentKeysPage() {
  const t = useT(M)
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
  const revoke = async (id: string) => {
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
    <Shell slot="agent" kicker="weevils" title={t.title}>
      <div className="ipage ak-page">
        <div className="in meta">{t.intro}</div>
        {err && <Notice eventId={noticeKey('error:agent-keys', err)} className="in meta" role="alert">! {err}</Notice>}
        {!list && !err && <WeevilLoading inline />}
        {list && !list.enabled && <div className="in meta">{t.notHere}</div>}
        {fresh && (
          <div className="band invert ak-fresh" role="status">
            <div className="in">{t.newKey(fresh.name)}</div>
            <div className="in"><code className="ak-key">{fresh.key}</code></div>
            <div className="in inline-actions">
              <CopyLink text={fresh.key} />
              <CopyLink text={t.brief(endpoint, fresh.key)} label={t.copyAll} />
              <button type="button" className="link inline" onClick={() => setFresh(null)}>{t.done}</button>
            </div>
          </div>
        )}
        {list?.enabled && (
          <form className="in ak-new" onSubmit={(e) => void create(e)}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} aria-label={t.nameLabel} maxLength={40} autoCapitalize="words" autoCorrect="off" spellCheck={false} disabled={busy} enterKeyHint="done" />
            <button type="submit" className="link inline" disabled={!name.trim() || busy}>{busy ? t.creating : t.create}</button>
          </form>
        )}
        {list && list.keys.length > 0 && <div className="in label">{t.keys}</div>}
        {list?.enabled && !list.keys.length && <div className="in meta">{t.none}</div>}
        {list?.keys.map((k) => <KeyRow key={k.id} k={k} onRevoke={() => revoke(k.id)} />)}
        {list?.enabled && (
          <>
            <div className="in label">{t.howTitle}</div>
            <div className="in ak-addr"><code>{endpoint}</code> <CopyLink text={endpoint} /></div>
            <div className="in meta">{t.howSend}</div>
            <div className="in meta">{t.howRead}</div>
            <div className="in label">{t.connectorTitle}</div>
            {list.connector ? (
              <>
                <div className="in meta">{t.connectorOn}</div>
                <div className="in ak-addr"><code>{list.connector}</code> <CopyLink text={list.connector} /></div>
              </>
            ) : (
              <div className="in meta">{t.connectorOff}</div>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}
