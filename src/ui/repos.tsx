import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import type { GithubRepo } from '../../shared/api.ts'
import { api } from '../api'
import { useApp } from './app-context'
import { Shell } from './shell'
import { plural } from './format'

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
/** Couleur pop stable par repo ; deux repos voisins tombent rarement sur la même puisque la grille mélange 16 teintes. */
const tint = (name: string) => ({ '--c': `var(--p${hash(name) % 16})` }) as CSSProperties

function RepoIcon() {
  return (
    <svg className="repo-ic" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"
      />
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
        {repos?.map((r) => {
          const on = pinned.has(r.name)
          return (
            <div key={r.name} className="repo-card" style={tint(r.name)} role="button" tabIndex={0} aria-label={r.name} onClick={() => push({ kind: 'files', projectId: r.name.split(/[-_.]/)[0].toLowerCase(), repo: r.name })} onKeyDown={(e) => e.key === 'Enter' && push({ kind: 'files', projectId: r.name.split(/[-_.]/)[0].toLowerCase(), repo: r.name })}>
              <RepoIcon />
              <span className="repo-name">{r.name}</span>
              {r.description && <span className="repo-desc">{r.description}</span>}
              <button
                className={`repo-pin ${on ? 'on' : ''}`}
                aria-label={on ? `retirer ${r.name} du fil` : `épingler ${r.name} au fil`}
                aria-pressed={on}
                onClick={(e) => {
                  e.stopPropagation()
                  void pin(r.name, !on)
                }}
              >
                {on ? '✓' : '+'}
              </button>
            </div>
          )
        })}
      </div>
    </Shell>
  )
}
