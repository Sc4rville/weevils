// What an agent reads with a capture from the app's camera (server/captures.ts): where it was taken, so the person
// never has to explain what the picture shows.
import { defineMessages } from '../i18n.ts'
import type { Capture } from '../captures.ts'

const size = (c: Capture) => (c.viewport ? `${c.viewport.w}×${c.viewport.h} @${c.viewport.dpr}x` : '')
const part = (c: Capture, whole: string, region: string) => (c.region ? `${region} ${c.region.x},${c.region.y} ${c.region.w}×${c.region.h}` : whole)

export default defineMessages({
  fr: {
    notImage: 'ce n’est pas une image',
    note: (c: Capture, library: string) => [
      `Capture d’écran prise dans l’app weevils${c.ui ? ` (${c.ui})` : ''} par la personne, avec l’appareil photo de l’app`,
      `écran : ${c.screen ?? '?'}`,
      c.sessionTitle || c.sessionId ? `session « ${c.sessionTitle ?? ''} » (${c.sessionId ?? ''})` : '',
      c.project ? `projet : ${c.project}` : '',
      c.page ? `page : ${c.page.kind}${c.page.title ? ` « ${c.page.title} »` : ''}${c.page.id ? ` (${c.page.id})` : ''}` : '',
      c.theme ? `thème : ${c.theme}` : '',
      size(c) ? `écran du téléphone : ${size(c)}` : '',
      part(c, 'tout l’écran', 'zone choisie'),
      new Date(c.at).toISOString(),
      c.build ? `build ${c.build}` : '',
      c.tags.includes('ui') ? `retour sur l’interface de weevils (tag ui), rangée dans ${library} (weevils captures --ui)` : `rangée dans ${library} (weevils captures)`,
    ].filter(Boolean).join(' ; '),
  },
  en: {
    notImage: 'not an image',
    note: (c: Capture, library: string) => [
      `Screen capture the person took inside the weevils app${c.ui ? ` (${c.ui})` : ''}, with the app's camera`,
      `screen: ${c.screen ?? '?'}`,
      c.sessionTitle || c.sessionId ? `session "${c.sessionTitle ?? ''}" (${c.sessionId ?? ''})` : '',
      c.project ? `project: ${c.project}` : '',
      c.page ? `page: ${c.page.kind}${c.page.title ? ` "${c.page.title}"` : ''}${c.page.id ? ` (${c.page.id})` : ''}` : '',
      c.theme ? `theme: ${c.theme}` : '',
      size(c) ? `phone screen: ${size(c)}` : '',
      part(c, 'whole screen', 'selected region'),
      new Date(c.at).toISOString(),
      c.build ? `build ${c.build}` : '',
      c.tags.includes('ui') ? `feedback on the weevils interface (tag ui), kept in ${library} (weevils captures --ui)` : `kept in ${library} (weevils captures)`,
    ].filter(Boolean).join('; '),
  },
})
