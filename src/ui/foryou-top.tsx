// The top band's two words, « weevboss · pour toi », and the preview of the stream shown under them (docs/foryou.md §4.1).
// Both only exist when the server sends snap.foryou: on an older server or a secondary machine the band is unchanged.
import { AnimatePresence, motion } from 'motion/react'
import { useSyncExternalStore } from 'react'
import type { ForYouItem } from '../../shared/foryou.ts'
import { useT } from '../i18n'
import M from '../i18n/bands'
import { useApp } from './app-context'
import { useAuthors } from './bits'
import { itemSlot, itemWho, useForYou } from './foryou-store'
import { Icon } from './icons'
import './foryou-top.css'

export type Top = 'boss' | 'foryou'

const KEY = 'weevils-top'
const CHANGE = 'weevils-top-change'
/** How many items the preview shows: a glance, the page has the rest. */
export const PEEK_ITEMS = 8

const read = (): Top => {
  try {
    return localStorage.getItem(KEY) === 'foryou' ? 'foryou' : 'boss'
  } catch {
    return 'boss'
  }
}

export function setTop(top: Top) {
  try {
    localStorage.setItem(KEY, top)
  } catch {
    /* storage unavailable: the choice lasts as long as nothing re-reads it */
  }
  window.dispatchEvent(new Event(CHANGE))
}

const subscribe = (f: () => void) => {
  window.addEventListener(CHANGE, f)
  window.addEventListener('storage', f)
  return () => {
    window.removeEventListener(CHANGE, f)
    window.removeEventListener('storage', f)
  }
}

/** Which of the two words is chosen on this device. Without a stream on this server it is always weevboss. */
export function useTop(): [Top, (top: Top) => void] {
  const { snap } = useApp()
  const stored = useSyncExternalStore<Top>(subscribe, read, () => 'boss')
  return [snap.foryou ? stored : 'boss', setTop]
}

/** The two small words. `active` is the one in full ink; a tap on either calls onPick (the band decides what it does). */
export function TopWords({ active, onPick }: { active: Top; onPick: (top: Top) => void }) {
  const t = useT(M)
  const { snap } = useApp()
  const { unseen } = useForYou()
  if (!snap.foryou) return null
  return (
    <div className="fyt-words">
      <button type="button" className={`fyt-word ${active === 'boss' ? 'on' : ''}`} aria-pressed={active === 'boss'} onClick={() => onPick('boss')}>
        weevboss
      </button>
      <span className="fyt-sep" aria-hidden>
        ·
      </span>
      <button type="button" className={`fyt-word ${active === 'foryou' ? 'on' : ''}`} aria-pressed={active === 'foryou'} onClick={() => onPick('foryou')}>
        {t.forYou}
        {unseen > 0 && <span className="fyt-dot" role="img" aria-label={t.forYouUnseen(unseen)} />}
      </button>
    </div>
  )
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** What a strip says after the speaker: the item's words, else its title, else the name of what it shows.
 * Proposals: the first card's title (the strip already leads with « + n »; the item's own text would repeat the count). */
function lineOf(item: ForYouItem): string {
  if (item.cards?.length) return oneLine(item.cards[0].title)
  return oneLine(item.text) || oneLine(item.title ?? '') || oneLine(item.cards?.[0]?.title ?? '') || (item.media?.[0]?.name ?? '')
}

const soft = { type: 'spring', stiffness: 160, damping: 26, mass: 1 } as const

/**
 * The stream's first items as thin strips, in the box the thread preview uses. It scrolls in place; a tap anywhere
 * opens the stream full screen. The order comes from the store, which holds newcomers back while a finger is down.
 */
export function ForYouPeek() {
  const t = useT(M)
  const { snap, colors, push } = useApp()
  const { items } = useForYou()
  const authorOf = useAuthors()
  const shown = items.slice(0, PEEK_ITEMS)
  const open = () => push({ kind: 'foryou' })
  return (
    <motion.div layoutScroll className="fyt-peek" role="button" tabIndex={0} aria-label={t.forYouOpen} onClick={open} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open()}>
      <div className="fyt-list">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((item) => {
            const who = itemWho(item, authorOf, snap.projects.find((p) => p.id === item.projectId)?.name)
            const media = item.media?.[0]
            const cards = item.cards?.length ?? 0
            return (
              <motion.div
                key={item.id}
                layout="position"
                className={`fyt-item ${item.kind === 'alert' ? 'fyt-alert' : ''} ${item.seen ? '' : 'fyt-new'}`}
                style={itemSlot(item, colors, authorOf)}
                initial={{ opacity: 0, y: -14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={soft}
              >
                <div className="in">
                  {media &&
                    (media.type === 'image' ? (
                      <img className="fyt-thumb" src={media.url} alt="" loading="lazy" draggable={false} />
                    ) : (
                      <span className="fyt-thumb fyt-play" aria-hidden>
                        <Icon name="play" />
                      </span>
                    ))}
                  <span className="fyt-txt">
                    <span className="strong">{who}</span> {cards > 0 && <span className="fyt-n">+ {cards} </span>}
                    {lineOf(item)}
                  </span>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
        {shown.length === 0 && <div className="in fyt-empty">{t.forYouEmpty}</div>}
      </div>
    </motion.div>
  )
}
