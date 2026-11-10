import { useEffect, useState } from 'react'
import { LANGS, LANG_NAMES, browserLang, langIsChosen, setLang, syncServer, useLang, useT, type Lang } from '../i18n'
import M from '../i18n/prefs'
import { Line } from './bits'
import { TourLine } from './tour'
import { TipsLine } from './tips'

/** App-wide preferences shown in the bottom band: language, intro, tips (devil mode: the devil next to the logo). */
export function PrefLines() {
  const t = useT(M)
  const lang = useLang()
  const [picking, setPicking] = useState(false)
  // weevilsd follows a language explicitly chosen here (agents, voice, notifications). An app that merely follows its
  // browser never pushes it: any browser in another language (a test, a borrowed phone) would switch the server for everyone.
  useEffect(() => {
    if (langIsChosen()) syncServer()
  }, [])
  const chosen = langIsChosen()
  // Never switched by a single tap (a stray tap in the bottom band once left the whole app in English): the line opens
  // the choices, and only a tap on one of them changes the language.
  const pick = (l: Lang | null) => {
    setPicking(false)
    if (l === null ? chosen : !chosen || l !== lang) setLang(l)
  }
  return (
    <>
      <Line ch="~" go={null} meta={chosen ? t.chosen : t.followsBrowser} onClick={() => setPicking((p) => !p)}>
        {t.language} · {LANG_NAMES[lang]}
      </Line>
      {picking && (
        <div className="lang-pick" role="group" aria-label={t.language}>
          <Line ch={chosen ? '' : '✓'} go={null} onClick={() => pick(null)}>
            {t.followBrowser(LANG_NAMES[browserLang()])}
          </Line>
          {LANGS.map((l: Lang) => (
            <Line key={l} ch={chosen && l === lang ? '✓' : ''} go={null} onClick={() => pick(l)}>
              <span lang={l}>{LANG_NAMES[l]}</span>
            </Line>
          ))}
        </div>
      )}
      <TourLine />
      <TipsLine />
    </>
  )
}
