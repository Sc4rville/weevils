import { defineMessages } from './index'
export default defineMessages({
  fr: { close: 'fermer la notification', closeAbout: (about: string) => `fermer la notification : ${about}` },
  en: { close: 'dismiss notification', closeAbout: (about: string) => `dismiss notification: ${about}` },
})
