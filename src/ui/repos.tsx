import { useEffect, useState, type FormEvent } from 'react'
import type { GithubRepo } from '../../shared/api.ts'
import { api } from '../api'
import { useApp } from './app-context'
import { Shell } from './shell'
import { plural } from './format'

/** Couleur par position : un pas de 7 sur les 16 teintes, donc deux icônes voisines (à côté ou dessous) n'ont jamais une teinte proche. */
const tint = (i: number) => `var(--p${(i * 7) % 16})`

function RepoIcon({ color }: { color: string }) {
  // Une grande icône de repo, plate, pleine de sa couleur : le dos arrondi, la tranche, le marque-page.
  return (
    <svg className="repo-big" viewBox="0 0 96 96" aria-hidden focusable="false">
      <path fill={color} d="M20 12a12 12 0 0 1 12-12h46a6 6 0 0 1 6 6v74a6 6 0 0 1-6 6H32a12 12 0 0 1-12-12Z" />
      <path fill="var(--ink)" opacity="0.22" d="M32 70h46v4H32a6 6 0 0 0 0 12h46v4H32a10 10 0 0 1 0-20Z" />
      <path fill="var(--ink)" opacity="0.22" d="M58 0h12v30l-6-4-6 4Z" />
    </svg>
  )
}

export function ReposPage() {
  const { snap, push, refresh } = useApp()
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const pinned = new Set(snap.pinnedRepos)

  useEffect(() => {
    let off = false
    api
      .githubRepos()
      .then((r) => !off && setRepos(r.repos))
      .catch((e) => !off && setErr((e as Error).message))
    return () => {
      off = true
    }
  }, [])

  const pin = async (repo: string, on: boolean) => {
    setErr(null)
    try {
      await api.pinRepo(repo, on)
      refresh()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    setErr(null)
    try {
      await api.newRepo(n, desc.trim())
      setName('')
      setDesc('')
      setRepos((await api.githubRepos(true)).repos)
      refresh()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell slot="agent" kicker="weevils" title="repos" meta={repos ? plural(repos.length, 'repo', 'repos') : '…'}>
      {err && (
        <div className="band invert" role="alert">
          <div className="in meta" style={{ paddingBlock: 12 }}>
            ! {err}
          </div>
        </div>
      )}
      <form className="band tone" onSubmit={create}>
        <div className="in repo-new">
          <span className="prompt h2" aria-hidden>
            +
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nom" aria-label="nom du repo" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={busy} />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="une phrase" aria-label="description du repo" enterKeyHint="done" disabled={busy} />
          <button type="submit" className="send" aria-label="créer le repo" disabled={!name.trim() || busy}>
            {busy ? <span className="spin">*</span> : '↑'}
          </button>
        </div>
      </form>
      <div className="in repo-grid">
        {repos?.map((r, i) => {
          const on = pinned.has(r.name)
          const open = () => push({ kind: 'files', projectId: r.name.split(/[-_.]/)[0].toLowerCase(), repo: r.name })
          return (
            <div key={r.name} className="repo">
              <button className="repo-open" aria-label={r.name} onClick={open}>
                <RepoIcon color={tint(i)} />
                <span className="repo-name">{r.name}</span>
              </button>
              <button className={`repo-pin ${on ? 'on' : ''}`} aria-label={on ? `retirer ${r.name} du fil` : `épingler ${r.name} au fil`} aria-pressed={on} onClick={() => void pin(r.name, !on)}>
                {on ? '✓' : '+'}
              </button>
            </div>
          )
        })}
      </div>
    </Shell>
  )
}
