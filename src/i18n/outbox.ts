import { defineMessages } from './index'
export default defineMessages({
 fr: {
  storageFailed: 'Le stockage local est indisponible. Ton brouillon est conservé ; aucun envoi lancé.',
  sending: 'confirmation en cours', accepted: 'enregistré, en attente de transmission', delivering: 'transmission en cours', delivered: 'transmis à l’agent', uncertain: 'réception incertaine — aucun renvoi automatique', failed: 'transmission échouée', trackingLost: 'suivi momentanément indisponible', unconfirmed: 'Confirmation indisponible. Ton brouillon est conservé ; réessayer vérifiera le même envoi.', recover: 'copier le texte', copied: 'texte copié', dismiss: 'masquer cet état', open: 'ouvrir la conversation',
 },
 en: {
  storageFailed: 'Local storage is unavailable. Your draft is saved; nothing was submitted.',
  sending: 'awaiting confirmation', accepted: 'saved, waiting to be forwarded', delivering: 'forwarding', delivered: 'forwarded to the agent', uncertain: 'receipt uncertain — no automatic resend', failed: 'forwarding failed', trackingLost: 'tracking temporarily unavailable', unconfirmed: 'Confirmation unavailable. Your draft is saved; retrying will check the same submission.', recover: 'copy the text', copied: 'text copied', dismiss: 'dismiss this status', open: 'open conversation',
 },
})
