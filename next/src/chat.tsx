// weevboss's conversation in weevils next. Every display rule is the app's: its message list (bits.tsx Messages: tool
// steps with their titles, briefs one tap from their spoken line, living links, diagrams, the window of recent
// messages), its scroll-follow (follow.ts useFollow), its working line, its composer and words (i18n). Added on top,
// motion only: your message glides up the moment you send it; what arrives opens in place (the app's own Appear).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { OutboxStatus } from '../../src/ui/outbox-status.tsx'
import { ThreadPlans } from '../../src/ui/relay.tsx'
import { Chip, KeyChip, SetupChips, SetupComposer, SyncLine, useFlow, useWelcome, withoutStandIn } from '../../src/ui/setup.tsx'
import type { ChipId } from '../../src/ui/format.ts'
import type { Brick } from '../../shared/setup.ts'
import { AnimatePresence, motion } from 'motion/react'
import type { Message } from '../../shared/api.ts'
import { Composer as AppComposer, Messages, WorkingMark, spring, type Attachment } from '../../src/ui/bits.tsx'
import { useFollow } from '../../src/ui/follow.ts'
import { visible } from './data.ts'
import { userCaption, userPhotos } from '../../src/ui/format.ts'
import { stillPending, type Pending } from './pending.ts'
import { LabList, LabSwitch, useLab } from './lab.tsx'
import { api } from '../../src/api.ts'
import { useT } from '../../src/i18n/index.ts'
import LM from '../../src/i18n/lab.ts'
import { WeevilLoading } from '../../src/ui/loading.tsx'

/** weevboss's setup buttons, as in the app's weevboss band (bands.tsx): on the last message that carries each one,
 *  in its sentence ([[setup:x]]) or under it; a secret asked for is always a button. */
function bossChips(main: Message[]) {
  const lastWith = new Map<string, string>()
  for (const m of main) for (const c of m.chips ?? []) lastWith.set(c, m.id)
  return {
    after: (id: string) => {
      const m = main.find((x) => x.id === id)
      const list = (m?.chips ?? []).filter((c) => lastWith.get(c) === id && !m?.text.includes(`[[setup:${c}]]`))
      return list.length ? <SetupChips chips={list} /> : null
    },
    chip: (b: ChipId, id: string) => (b.startsWith('key:') ? <KeyChip name={b.slice(4)} /> : lastWith.get(b) === id ? <Chip brick={b as Brick} inline /> : null),
  }
}


export function Chat({ id, messages: thread, working: busy, author, placeholder, label, empty, loading, send }: {
  id: string | null
  messages: Message[] | null
  working: boolean
  author: string
  placeholder: string
  label: string
  empty?: string
  loading?: boolean
  send: (text: string, files?: Attachment[]) => Promise<unknown>
}) {
  const scroll = useRef<HTMLDivElement>(null)
  // The first run is this conversation and nothing else, as in the app (setup.tsx): a new install lands here (weevboss's
  // screen is next's first one), the hello is asked for and shown being written, never preceded by its stand-in line;
  // a setup's questions take the place of the field, one at a time, masked for a secret.
  const greeting = useWelcome()
  const flow = useFlow()
  const messages = useMemo(() => (thread ? withoutStandIn(thread, greeting) : thread), [thread, greeting])
  const working = busy || greeting
  const shown = useMemo(() => (messages ?? []).filter(visible).slice(-60), [messages])
  const [pending, setPending] = useState<Pending[]>([])
  // Your message, once the server has it, takes the place of its stand-in without moving again.
  useLayoutEffect(() => {
    if (!pending.length) return
    const left = stillPending(pending, messages ?? [])
    if (left.length !== pending.length) setPending(left)
  }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps
  const last = shown.at(-1)
  const follow = useFollow(scroll, true, 120, `${last?.id}:${last?.text.length}:${pending.length}:${working}`)
  useEffect(() => setPending([]), [id])
  const waiting = working || pending.length > 0

  // The onboarding lab, when this instance runs it (next/src/lab.tsx): on weevboss's screen only.
  const lab = useLab()
  const remarking = id === null && lab.on
  const lt = useT(LM)

  const submit = async (text: string, files?: Attachment[]) => {
    if (remarking) {
      // A remark about the onboarding, with what the screen shows: never a newcomer's message.
      const context = shown.slice(-10).map((m) => `${m.role === 'user' ? 'newcomer' : 'weevboss'}: ${m.text}`)
      await api.labRemark(text, context, files?.map((f) => ({ name: f.name, type: f.type, data: f.data })))
      return
    }
    const key = crypto.randomUUID()
    // A capture comes as its path in the library and what it shows (held-capture.ts): the stand-in shows it as the thread
    // will, its picture and your words only.
    const typed = userCaption(text)
    const photos = [...userPhotos(text).map((p) => `/api/attachments?path=${encodeURIComponent(p)}`),
      ...(files ?? []).filter((f) => f.type.startsWith('image/')).map((f) => `data:${f.type};base64,${f.data}`)]
    const known = new Set((messages ?? []).filter((m) => m.role === 'user').map((m) => m.id))
    if (typed || photos.length) setPending((p) => [...p, { key, text: typed, photos, known }])
    navigator.vibrate?.(8)
    follow.toEnd()
    try {
      await send(text, files)
    } catch (e) {
      setPending((p) => p.filter((x) => x.key !== key))
      throw e
    }
  }

  return (
    <>
      <div className="nx-scroll" ref={scroll}>
        <div className="nx-thread">
          {loading && <WeevilLoading />}
          {!loading && shown.length === 0 && !pending.length && empty && <p className="nx-empty">{empty}</p>}
          {messages && <Messages messages={messages} author={author} working={working} {...(id === null ? bossChips(messages) : {})} />}
          {id === null && <SyncLine />}
          {id === null && <ThreadPlans />}
          <AnimatePresence initial={false}>
            {pending.map((p) => (
              <motion.div key={p.key} className="nx-msg nx-me" initial={{ opacity: 0, y: 36, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0 } }} transition={spring} style={{ originX: 1, originY: 1 }}>
                {p.text && <div className="text">{p.text}</div>}
                {p.photos.length > 0 && <div className={p.photos.length > 1 ? 'user-photos row' : 'user-photos'}>{p.photos.map((src, i) => <span key={i} className="user-photo"><img src={src} alt="" /></span>)}</div>}
              </motion.div>
            ))}
            {waiting && (
              <motion.div key="working" className="nx-working working" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring}>
                <WorkingMark author={author} />
              </motion.div>
            )}
          </AnimatePresence>
          <OutboxStatus scope={id === null ? '/api/main' : `/api/sessions/${encodeURIComponent(id)}/`} />
        </div>
      </div>
      <div className={`nx-composer${remarking ? ' lab-on' : ''}`}>
        {remarking && lab.state && <LabList state={lab.state} />}
        <div className="lab-field">
        {id === null && lab.state && <LabSwitch on={lab.on} busy={lab.busy} toggle={lab.toggle} />}
        {flow && id === null && !remarking ? <SetupComposer /> : (
        <AppComposer multiline voice anyFile={id === null} sayErrors draftKey={remarking ? 'lab:remark' : `session:${id ?? '__main'}`} placeholder={remarking ? lt.remark : placeholder} label={remarking ? lt.remark : label}
          captureTo={{ to: id ?? 'weevboss', feedback: id === null }}
          onSend={(text) => submit(text).then(() => undefined)} onAttach={(text, files) => submit(text, files).then(() => undefined)} />
        )}
        </div>
      </div>
    </>
  )
}
