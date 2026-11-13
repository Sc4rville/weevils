import { defineMessages } from './index'

export default defineMessages({
  fr: {
    language: 'langue',
    closeLanguage: 'fermer le choix de langue',
    followsDefault: 'par défaut',
    chosen: 'choisie ici',
    followDefault: (name: string) => `par défaut (${name})`,
  },
  en: {
    language: 'language',
    closeLanguage: 'close language choices',
    followsDefault: 'default',
    chosen: 'chosen here',
    followDefault: (name: string) => `default (${name})`,
  },
})
