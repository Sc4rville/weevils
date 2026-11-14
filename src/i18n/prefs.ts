import { defineMessages } from './index'

export default defineMessages({
  fr: {
    language: 'langue',
    closeLanguage: 'fermer le choix de langue',
    followsDefault: 'par défaut',
    chosen: 'choisie ici',
    followDefault: (name: string) => `par défaut (${name})`,
    updates: 'mises à jour',
    updatesOn: 'automatiques',
    updatesOff: 'coupées',
    updatesOnMeta: 'toutes seules, quand rien ne travaille',
    updatesOffMeta: 'weevils reste sur sa version',
  },
  en: {
    language: 'language',
    closeLanguage: 'close language choices',
    followsDefault: 'default',
    chosen: 'chosen here',
    followDefault: (name: string) => `default (${name})`,
    updates: 'updates',
    updatesOn: 'automatic',
    updatesOff: 'off',
    updatesOnMeta: 'by itself, when nothing is working',
    updatesOffMeta: 'weevils stays on its version',
  },
})
