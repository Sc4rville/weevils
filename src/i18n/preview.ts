import { defineMessages } from './index'

export default defineMessages({
  fr: {
    feedback: 'Discuter de cet aperçu',
    target: 'Session destinataire',
    chooseSession: 'Choisir une session existante',
    noSession: 'Aucune session disponible pour ce projet.',
    writeFeedback: 'Que souhaites-tu modifier ?',
    includeCurrent: 'Joindre cette page',
    includeOpened: 'Joindre l’adresse ouverte (navigation interne inaccessible)',
    pageContext: 'Page de l’aperçu',
    accepted: 'Envoi pris en charge. La réponse apparaîtra ici.',

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
    feedback: 'Chat about this preview',
    target: 'Target session',
    chooseSession: 'Choose an existing session',
    noSession: 'No session is available for this project.',
    writeFeedback: 'What would you like to change?',
    includeCurrent: 'Include this page',
    includeOpened: 'Include the opened address (navigation inside is unavailable)',
    pageContext: 'Preview page',
    accepted: 'Submission accepted. Replies will appear here.',

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
