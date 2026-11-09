import { useEffect } from 'react'
import { LANGS, LANG_NAMES, langIsChosen, setLang, syncServer, useLang, useT } from '../i18n'
import M from '../i18n/prefs'
import { Line } from './bits'
import { OnboardingLine } from './onboarding'
import { TipsLine } from './tips'
import { useHand } from './hand'

/** App-wide preferences shown in the bottom band: language (and, later, tips). */
export function PrefLines() {
  const t = useT(M)
  const lang = useLang()
  // weevilsd follows a language explicitly chosen here (agents, voice, notifications). An app that merely follows its
  // browser never pushes it: any browser in another language (a test, a borrowed phone) would switch the server for everyone.
  useEffect(() => {
    if (langIsChosen()) syncServer()
  }, [])
  const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]
  return (
    <>
      <Line ch="~" go={null} meta={langIsChosen() ? t.chosen : t.followsBrowser} onClick={() => setLang(next)}>
        {t.language} · {LANG_NAMES[lang]}
      </Line>
      <HandLine />
      <OnboardingLine />
      <TipsLine />
    </>
  )
}

/** Main du pouce : le logo de weevboss en bas à droite (droitier) ou en bas à gauche dans les pages. */
function HandLine() {
  const t = useT(M)
  const [hand, setHand] = useHand()
  return (
    <Line ch={hand === 'left' ? '←' : '→'} go={null} meta={hand === 'left' ? t.handLeftMeta : t.handRightMeta} onClick={() => setHand(hand === 'left' ? 'right' : 'left')}>
      {t.hand} · {hand === 'left' ? t.left : t.right}
    </Line>
  )
}
