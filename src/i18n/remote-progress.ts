import { defineMessages } from './index'
export default defineMessages({
 fr: {
  source: 'travail distant', working: 'progression constatée', waiting: 'en attente de nouveau progrès', done: 'terminé', error: 'erreur signalée', stale: 'suivi interrompu', offline: 'connexion au suivi interrompue', idle: 'agent au repos', active: 'agent en activité',
  reported: (n: number) => `${n} images annoncées`, fraction: (n: number, total: number) => `${n} / ${total} images annoncées`, observed: (time: string) => `dernier relevé à ${time}`, advanced: (time: string) => `dernier progrès à ${time}`, unknown: 'heure du dernier relevé indisponible',
 },
 en: {
  source: 'remote work', working: 'progress observed', waiting: 'waiting for further progress', done: 'completed', error: 'error reported', stale: 'tracking interrupted', offline: 'tracking connection interrupted', idle: 'agent idle', active: 'agent active',
  reported: (n: number) => `${n} reported frames`, fraction: (n: number, total: number) => `${n} / ${total} reported frames`, observed: (time: string) => `last observation at ${time}`, advanced: (time: string) => `last progress at ${time}`, unknown: 'last observation time unavailable',
 },
})
