import { useState, type FormEvent } from 'react'
import { api } from '../api'

/** Connexion : un code d'accès (ou le lien QR « #k=… »). Une fois par appareil. */
export function Login({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      await api.login(code.trim())
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="stack">
      <section className="band agent" style={{ ['--c' as string]: 'var(--agent)', flex: 1 }}>
        <div className="in head">
          <span className="name">weevils</span>
        </div>
        <div className="in meta summary">connexion à ton VPS</div>
        <form className="composer band tone" onSubmit={submit}>
          <div className="in">
            <span className="prompt" aria-hidden>
              {busy ? <span className="spin">*</span> : '#'}
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="code d’accès"
              aria-label="code d’accès"
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className="send" type="submit" disabled={!code.trim() || busy} aria-label="se connecter">
              →
            </button>
          </div>
        </form>
        {err && (
          <div className="band invert" role="alert">
            <div className="in meta" style={{ paddingBlock: 12 }}>
              ! {err}
            </div>
          </div>
        )}
        <div className="in meta" style={{ paddingBlock: 16 }}>
          Le plus simple : scanne le QR code de connexion avec l’appareil photo. Une seule fois par appareil.
        </div>
      </section>
    </main>
  )
}
