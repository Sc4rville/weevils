import { defineMessages } from './index'
export default defineMessages({
  fr: {
    imageUnavailable: 'L’image ne s’est pas chargée.', retryImage: 'Recharger l’image', clipUnavailable: 'Le clip ne s’est pas chargé.', retryClip: 'Recharger le clip',
    title: 'Essayer de vrais formats', intro: 'Des exemples TLO à regarder à ton rythme. Choisis le format à garder ; seul le bouton de transmission d’une proposition envoie une consigne.',
    result: '01 · Résultat visuel', resultTitle: 'Une alcôve pour se poser', resultText: 'TLO · Deux fauteuils, une petite table et une lumière chaude sous la voûte. Ce rendu existant permet de juger l’atmosphère de ce lieu de rencontre.',
    story: '02 · Parcours en images', storyTitle: 'Du café au couloir', storyText: 'Trois moments du même déplacement existant. Regarde comment le rideau fait passer de la salle chaleureuse aux arches de pierre.',
    clip: '03 · Mouvement', clipTitle: 'Entrer dans le café', clipText: 'TLO · Un premier aperçu existant du trajet rue → café, ralenti pour observer le mouvement. Lance-le pour juger la transition.',
    proposal: '04 · À toi de choisir', open: 'Ouvrir l’image complète', previous: 'Image précédente', next: 'Image suivante', step: (n: number, total: number) => `Image ${n} sur ${total}`,
    recommended: 'Recommandé', instruction: 'Voir la consigne prête à transmettre', send: 'Transmettre mon choix à TLO', sending: 'Transmission en cours…', sent: 'Choix transmis à TLO', choose: 'Choisis une option avant de transmettre.',
    keep: 'Garder ce format', kept: 'Format retenu sur cet appareil', preference: 'Ton choix de format est conservé sur cet appareil. Tu peux le changer.', missing: 'Cet exemple n’est pas disponible dans le flux actuel.',
  },
  en: {
    imageUnavailable: 'The image did not load.', retryImage: 'Reload image', clipUnavailable: 'The clip did not load.', retryClip: 'Reload clip',
    title: 'Try real formats', intro: 'TLO examples to explore at your own pace. Pick a format to keep; only a proposal’s send button transmits instructions.',
    result: '01 · Visual result', resultTitle: 'An alcove to settle into', resultText: 'TLO · Two armchairs, a small table and warm light beneath the vault. This existing render lets you assess the atmosphere of this meeting place.',
    story: '02 · Picture journey', storyTitle: 'From café to corridor', storyText: 'Three moments from the same existing movement. See how the curtain leads from the warm room into the stone arches.',
    clip: '03 · Motion', clipTitle: 'Entering the café', clipText: 'TLO · An existing early preview of the street → café journey, slowed down to observe the movement. Play it to assess the transition.',
    proposal: '04 · Your choice', open: 'Open full image', previous: 'Previous image', next: 'Next image', step: (n: number, total: number) => `Image ${n} of ${total}`,
    recommended: 'Recommended', instruction: 'Read the instructions to send', send: 'Send my choice to TLO', sending: 'Sending…', sent: 'Choice sent to TLO', choose: 'Choose an option before sending.',
    keep: 'Keep this format', kept: 'Format selected on this device', preference: 'Your format choice is saved on this device. You can change it.', missing: 'This example is unavailable in the current feed.',
  },
})
