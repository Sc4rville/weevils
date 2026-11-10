import { defineMessages } from './index'

// The memory page (src/ui/memory.tsx): what weevils remembers about the user.
export default defineMessages({
  fr: {
    title: '# mémoire',
    count: (n: number) => `${n} souvenir${n > 1 ? 's' : ''}`,
    add: 'ajouter',
    addLabel: 'ajouter un souvenir',
    edit: 'souvenir',
    close: 'refermer',
    byHand: 'à la main',
    quote: (q: string) => `« ${q} »`,
    forget: 'oublier',
    sure: 'vraiment ?',
    empty: 'rien encore',
  },
  en: {
    title: '# memory',
    count: (n: number) => `${n} ${n === 1 ? 'memory' : 'memories'}`,
    add: 'add',
    addLabel: 'add a memory',
    edit: 'memory',
    close: 'close',
    byHand: 'by hand',
    quote: (q: string) => `“${q}”`,
    forget: 'forget',
    sure: 'really?',
    empty: 'nothing yet',
  },
})
