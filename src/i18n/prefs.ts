import { defineMessages } from './index'

export default defineMessages({
  fr: {
    language: 'langue',
    followsBrowser: 'comme le navigateur',
    chosen: 'choisie ici',
    followBrowser: (name: string) => `comme le navigateur (${name})`,
  },
  en: {
    language: 'language',
    followsBrowser: 'same as the browser',
    chosen: 'chosen here',
    followBrowser: (name: string) => `same as the browser (${name})`,
  },
})
