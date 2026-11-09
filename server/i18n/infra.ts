// Messages of server/infra.ts: advice drawn from the machine's real measurements.
import { defineMessages } from '../i18n.ts'

const frList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}` : xs[0] ?? '')
const enList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '')
const frDur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}` : `${min} min`)
const enDur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`)

export default defineMessages({
  fr: {
    memPct: (n: number) => `${n} % de mémoire`,
    saturated: (n: number, culprits: string[], peak: string, at: string) =>
      `Tu as saturé ${n === 1 ? 'une fois' : `${n} fois`} aujourd’hui${culprits.length ? ` pendant ${frList(culprits)}` : ''} (pic ${peak} à ${at}).`,
    noSwap: (gb: number) => `Ajoute ${gb} Go de swap : tu n’en as pas, un pic de mémoire tuerait une session au lieu de la ralentir.`,
    swapHigh: (pct: number) => `Swap utilisé à ${pct} % : la mémoire manque, la machine ralentit.`,
    memHigh: (min: number) => `Mémoire au-dessus de 85 % pendant ${frDur(min)} aujourd’hui.`,
    cpuHigh: (pct: number) => `CPU à ${pct} % en moyenne aujourd’hui : passe au palier supérieur.`,
    diskHigh: (pct: number, freeGb: number) => `Disque plein à ${pct} % : plus que ${freeGb} Go libres.`,
    perSession: (mb: number, cpu: number, cap: number) => `Une session prend ~${mb} Mo et ~${cpu} % d’un cœur : ici, tu en tiens ~${cap}.`,
    forN: (n: number, vcpu: number, ram: number) => `Pour ${n} sessions, il faut ${vcpu} vCPU / ${ram} Go.`,
    noToken: 'pas connecté',
    expired: 'jeton expiré, ouvre claude une fois',
  },
  en: {
    memPct: (n: number) => `${n}% memory`,
    saturated: (n: number, culprits: string[], peak: string, at: string) =>
      `You saturated ${n === 1 ? 'once' : `${n} times`} today${culprits.length ? ` during ${enList(culprits)}` : ''} (peak ${peak} at ${at}).`,
    noSwap: (gb: number) => `Add ${gb} GB of swap: you have none, a memory spike would kill a session instead of slowing it down.`,
    swapHigh: (pct: number) => `Swap ${pct}% used: memory is short, the machine slows down.`,
    memHigh: (min: number) => `Memory above 85% for ${enDur(min)} today.`,
    cpuHigh: (pct: number) => `CPU at ${pct}% on average today: move to the next tier.`,
    diskHigh: (pct: number, freeGb: number) => `Disk ${pct}% full: only ${freeGb} GB left.`,
    perSession: (mb: number, cpu: number, cap: number) => `A session takes ~${mb} MB and ~${cpu}% of a core: this machine holds ~${cap}.`,
    forN: (n: number, vcpu: number, ram: number) => `For ${n} sessions you need ${vcpu} vCPU / ${ram} GB.`,
    noToken: 'not signed in',
    expired: 'token expired, open claude once',
  },
})
