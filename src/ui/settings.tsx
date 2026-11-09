import { useEffect, useState } from 'react'
import type { SessionSettings, Tool } from '../../shared/api.ts'
import { Line } from './bits'

/** Réglages manuels d'une session : ils partent en commandes slash (/model, /effort, /fast, /compact, /clear, /approvals). */

const MODELS: Record<Tool, string[]> = { claude: ['opus', 'sonnet', 'haiku'], codex: [] }
const EFFORTS = ['low', 'medium', 'high', 'max']

/** « claude-opus-4-1 » → « opus » ; un modèle codex est gardé tel quel. */
export function shortModel(model?: string): string | undefined {
  if (!model) return undefined
  const m = /opus|sonnet|haiku|fable/i.exec(model)
  return m ? m[0].toLowerCase() : model
}

interface Local {
  model?: string
  effort?: string
  fast?: boolean
}
const KEY = (id: string) => `weevils-settings:${id}`
const load = (id: string): Local => {
  try {
    return JSON.parse(localStorage.getItem(KEY(id)) ?? '{}') as Local
  } catch {
    return {}
  }
}

/** Ce que l'app a réglé elle-même (effort et mode rapide ne se lisent pas dans le transcript) : mémorisé par session. */
export function useLocalSettings(id: string) {
  const [local, setLocal] = useState<Local>(() => load(id))
  useEffect(() => setLocal(load(id)), [id])
  const update = (patch: Local) =>
    setLocal((s) => {
      const next = { ...s, ...patch }
      try {
        localStorage.setItem(KEY(id), JSON.stringify(next))
      } catch {
        /* stockage indisponible */
      }
      return next
    })
  return [local, update] as const
}

function Choice({ label, options, value, onPick, known }: { label: string; options: string[]; value?: string; onPick: (v: string) => void; known: boolean }) {
  return (
    <div className="in settings-row">
      <span className="meta settings-label">
        {label}
        {value && !known && <span className="settings-hint"> · réglé d’ici</span>}
      </span>
      <div className="opts" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o} className={`opt ${value === o ? 'on' : ''}`} aria-pressed={value === o} onClick={() => onPick(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Settings({
  id,
  tool,
  settings,
  canCommand,
  run,
  onPicker,
}: {
  id: string
  tool: Tool
  settings?: SessionSettings
  /** La session tourne dans une pane weevils : on peut lui taper des commandes. */
  canCommand: boolean
  run: (command: string) => Promise<unknown>
  /** Codex ouvre un menu dans le terminal (/model, /approvals) : montrer l'écran pour choisir avec les touches. */
  onPicker?: () => void
}) {
  const [local, setLocal] = useLocalSettings(id)
  const [err, setErr] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const send = async (command: string, after?: () => void) => {
    setErr(null)
    setBusy(command)
    try {
      await run(command)
      after?.()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const model = shortModel(settings?.model) ?? local.model
  const modelKnown = !!settings?.model
  const models = model && !MODELS.claude.includes(model) ? [model, ...MODELS.claude] : MODELS.claude

  if (!canCommand) {
    return <div className="in meta empty">Réglages indisponibles : la session ne tourne pas dans une pane weevils (relance-la avec wv, ou envoie-lui un message).</div>
  }

  return (
    <div className="settings">
      {err && (
        <div className="in meta" role="alert">
          ! {err}
        </div>
      )}
      {tool === 'claude' ? (
        <>
          <Choice label="modèle" options={models} value={model} known={modelKnown} onPick={(m) => void send(`/model ${m}`, () => setLocal({ model: m }))} />
          <Choice label="effort" options={EFFORTS} value={local.effort} known={false} onPick={(e) => void send(`/effort ${e}`, () => setLocal({ effort: e }))} />
          <div className="in settings-row">
            <span className="meta settings-label">
              mode rapide
              {local.fast != null && <span className="settings-hint"> · réglé d’ici</span>}
            </span>
            <div className="opts" role="group" aria-label="mode rapide">
              <button className={`opt ${local.fast ? 'on' : ''}`} aria-pressed={!!local.fast} onClick={() => void send('/fast', () => setLocal({ fast: !local.fast }))}>
                {local.fast == null ? 'basculer' : local.fast ? 'activé' : 'désactivé'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="in settings-row">
            <span className="meta settings-label">modèle{settings?.model ? ` · ${settings.model}` : ''}</span>
            <div className="opts">
              <button className="opt" onClick={() => void send('/model', onPicker)}>
                choisir dans le terminal
              </button>
            </div>
          </div>
          <div className="in settings-row">
            <span className="meta settings-label">approvals{settings?.approval ? ` · ${settings.approval}` : ''}</span>
            <div className="opts">
              <button className="opt" onClick={() => void send('/approvals', onPicker)}>
                choisir dans le terminal
              </button>
            </div>
          </div>
        </>
      )}
      <Line ch="⇣" go={null} meta="résume le contexte pour libérer de la place" onClick={() => void send('/compact')} disabled={busy === '/compact'}>
        /compact
      </Line>
      {confirm ? (
        <Line ch="!" go={null} className="invert" meta="tout le fil de cette session est oublié, c’est définitif" onClick={() => void send(tool === 'codex' ? '/new' : '/clear', () => setConfirm(null))}>
          confirmer {tool === 'codex' ? '/new' : '/clear'} · appuie encore
        </Line>
      ) : (
        <Line ch="×" go={null} meta="repartir de zéro (demande confirmation)" onClick={() => setConfirm('clear')}>
          {tool === 'codex' ? '/new' : '/clear'}
        </Line>
      )}
      {confirm && (
        <Line ch=" " go={null} onClick={() => setConfirm(null)}>
          <span className="meta">annuler</span>
        </Line>
      )}
    </div>
  )
}
