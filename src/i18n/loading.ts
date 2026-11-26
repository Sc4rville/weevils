import { defineMessages } from './index'

// While content is on its way (src/ui/loading.tsx): a small turning line, then, after a long wait, a calm word.
export default defineMessages({
  fr: { loading: 'synchronisation…', slow: 'ça prend un peu plus de temps que d’habitude, ça arrive' },
  en: { loading: 'syncing…', slow: 'taking a little longer than usual, it’s on its way' },
})
