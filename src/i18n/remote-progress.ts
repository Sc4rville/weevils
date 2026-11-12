import { defineMessages } from './index'
export default defineMessages({
 fr: {
  details: 'Détails du rendu', historical: 'Ancien relevé du rendu ; il ne décrit pas l’activité actuelle de la session.',
  source: 'Progression du rendu', working: 'Rendu en cours', waiting: 'En attente du rendu', done: 'Rendu terminé', error: 'Rendu en pause', stale: 'Suivi du rendu indisponible', offline: 'Connexion au suivi interrompue',
  workerStopped: 'Serveur arrêté ; un nouveau serveur est nécessaire pour reprendre.', capacity: 'Capacité du fournisseur atteinte ; libérer de la capacité avant de reprendre.', retryStopped: 'La tentative a échoué ; vérifier la cause avant de relancer.', pausedUnknown: 'Vérifier la cause de l’arrêt avant de relancer.',
  independent: 'Le rendu avance indépendamment de la conversation.',
  reported: (n: string) => `${n} image${n === '1' ? '' : 's'} annoncée${n === '1' ? '' : 's'}`, verified: (n: string) => `${n} image${n === '1' ? '' : 's'} vérifiée${n === '1' ? '' : 's'} et récupérée${n === '1' ? '' : 's'}`, fraction: (n: string, total: string) => `${n} / ${total} images annoncées`, observed: (time: string) => `Dernier relevé à ${time}`, advanced: (time: string) => `Dernier progrès à ${time}`, unknown: 'Heure du dernier relevé indisponible',
 },
 en: {
  details: 'Render details', historical: 'Earlier render observation; this does not describe the session’s current activity.',
  source: 'Render progress', working: 'Rendering', waiting: 'Waiting for render progress', done: 'Render completed', error: 'Render paused', stale: 'Render updates unavailable', offline: 'Tracking connection lost',
  workerStopped: 'The render worker stopped. Resume with a new worker.', capacity: 'Provider capacity reached. Free capacity before resuming.', retryStopped: 'The attempt failed. Check the cause before restarting.', pausedUnknown: 'Check why the render stopped before restarting.',
  independent: 'The render continues independently of the conversation.',
  reported: (n: string) => `${n} reported frame${n === '1' ? '' : 's'}`, verified: (n: string) => `${n} frame${n === '1' ? '' : 's'} verified and downloaded`, fraction: (n: string, total: string) => `${n} / ${total} reported frames`, observed: (time: string) => `Last observation at ${time}`, advanced: (time: string) => `Last progress at ${time}`, unknown: 'Last observation time unavailable',
 },
})
