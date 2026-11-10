import { defineMessages } from './index'

// The memory page (src/ui/memory.tsx): what weevils remembers about the user.
export default defineMessages({
  fr: {
    title: '# mémoire',
    count: (n: number) => `${n} souvenir${n > 1 ? 's' : ''}`,
    add: 'ajouter',
    addLabel: 'ajouter un souvenir',
    edit: 'souvenir',
    open: (text: string) => `ouvrir le souvenir : ${text}`,
    close: 'refermer',
    byHand: 'à la main',
    quote: (q: string) => `« ${q} »`,
    forget: 'oublier',
    sure: 'oublier pour de bon',
    empty: 'rien encore',
  },
  en: {
    title: '# memory',
    count: (n: number) => `${n} ${n === 1 ? 'memory' : 'memories'}`,
    add: 'add',
    addLabel: 'add a memory',
    edit: 'memory',
    open: (text: string) => `open the memory: ${text}`,
    close: 'close',
    byHand: 'by hand',
    quote: (q: string) => `“${q}”`,
    forget: 'forget',
    sure: 'forget for good',
    empty: 'nothing yet',
  },
})
