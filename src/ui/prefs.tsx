import { useEffect } from 'react'
import { LANGS, LANG_NAMES, langIsChosen, setLang, syncServer, useLang, useT } from '../i18n'
import M from '../i18n/prefs'
import { Line } from './bits'
import { OnboardingLine } from './onboarding'

/** App-wide preferences shown in the bottom band: language (and, later, tips). */
export function PrefLines() {
  const t = useT(M)
  const lang = useLang()
  // weevilsd follows the app's language for what it writes (agents, notifications), even before any choice.
  useEffect(() => syncServer(), [])
  const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]
  return (
    <>
      <Line ch="~" go={null} meta={langIsChosen() ? t.chosen : t.followsBrowser} onClick={() => setLang(next)}>
        {t.language} · {LANG_NAMES[lang]}
      </Line>
      <OnboardingLine />
    </>
  )
}
