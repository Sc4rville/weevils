import { defineMessages } from './index'

export default defineMessages({
  fr: {
    message: 'Message',
    pageContext: 'Page de l’aperçu',
    storageUnavailable: 'Le brouillon ne peut pas être sauvegardé. Libère de l’espace dans ce navigateur, puis recharge.',
    retryOriginal: 'Le précédent envoi est encore en attente. Rétablis son texte pour le réessayer sans doublon.',
    captureUnavailable: 'Ce navigateur ne peut pas capturer automatiquement l’aperçu. Ton brouillon est conservé. Utilise Chrome sur ordinateur en partageant cet onglet, ou joins une capture dans le fil de la session.',
    captureUnreadable: 'Cette page ne donne pas accès à son URL et à sa position actuelles. Aucun message envoyé. Joins une capture dans le fil de la session en attendant la prise en charge de cet aperçu.',
    captureChanged: 'La page a changé pendant la capture. Attends qu’elle soit stable et réessaie. Ton brouillon est conservé.',
    captureFailed: 'Capture non obtenue, aucun message envoyé. Réessaie en partageant cet onglet weevils. Ton brouillon est conservé.',

    close: 'fermer le navigateur',
    address: 'adresse à afficher',
    reload: 'recharger',
    openTab: 'ouvrir dans un onglet',
    frame: 'aperçu de l’application',
    grow: 'la page en grand',
    shrink: 'revoir la session',
    /** Aucune adresse devinée (ni dans la conversation, ni de domaine de preview) : le volet n'est pas vide sans raison. */
    noUrl: 'aucune adresse trouvée dans la session : tape celle de l’appli',
  },
  en: {
    message: 'Message',
    pageContext: 'Preview page',
    storageUnavailable: 'The draft cannot be saved. Free up browser storage, then reload.',
    retryOriginal: 'The previous submission is still pending. Restore its text to retry without sending a duplicate.',
    captureUnavailable: 'This browser cannot capture the preview automatically. Your draft is kept. Use desktop Chrome and share this tab, or attach a screenshot in the session chat.',
    captureUnreadable: 'This page does not expose its current URL and scroll position. Nothing was sent. Attach a screenshot in the session chat until this preview is supported.',
    captureChanged: 'The page changed during capture. Wait for it to settle, then retry. Your draft is kept.',
    captureFailed: 'No capture obtained; nothing was sent. Retry and share this weevils tab. Your draft is kept.',

    close: 'close the browser',
    address: 'address to show',
    reload: 'reload',
    openTab: 'open in a new tab',
    frame: 'app preview',
    grow: 'page full screen',
    shrink: 'back to the session',
    noUrl: 'no address found in the session: type the app’s address',
  },
})
