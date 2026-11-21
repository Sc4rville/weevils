import { defineMessages } from './index'
export default defineMessages({
  fr: {
    browseImages: 'Explorer ces vues', openClip: 'Ouvrir la vidéo entière',
    imageUnavailable: 'L’image ne s’est pas chargée.', retryImage: 'Recharger l’image', clipUnavailable: 'Le clip ne s’est pas chargé.', retryClip: 'Recharger le clip',
    title: 'Essayer de vrais formats', intro: 'Des exemples tirés de ton propre flux, à regarder à ton rythme. Choisis le format à garder ; seul le bouton de transmission d’une proposition envoie une consigne.',
    result: '01 · Résultat visuel', resultTitle: 'Une image en grand', resultText: 'Un rendu déjà publié dans ton flux, montré en entier pour le juger d’un coup d’œil.',
    story: '02 · Parcours en images', storyTitle: 'Une suite d’images', storyText: 'Plusieurs moments du même travail, à faire défiler dans l’ordre.',
    clip: '03 · Mouvement', clipTitle: 'Un clip', clipText: 'Une vidéo déjà publiée dans ton flux. Lance-la pour juger le mouvement.',
    proposal: '04 · À toi de choisir', open: 'Ouvrir l’image complète', step: (n: number, total: number) => `Image ${n} sur ${total}`,
    recommended: 'Recommandé', instruction: 'ce qui sera envoyé', send: 'Transmettre mon choix', sending: 'Transmission en cours…', sent: 'Choix transmis',
    keep: 'Garder ce format', kept: 'Format retenu sur cet appareil', preference: 'Ton choix de format est conservé sur cet appareil. Tu peux le changer.', missing: 'Cet exemple n’est pas disponible dans le flux actuel.',
  },
  en: {
    browseImages: 'Explore these views', openClip: 'Open full video',
    imageUnavailable: 'The image did not load.', retryImage: 'Reload image', clipUnavailable: 'The clip did not load.', retryClip: 'Reload clip',
    title: 'Try real formats', intro: 'Examples from your own feed, to explore at your own pace. Pick a format to keep; only a proposal’s send button transmits instructions.',
    result: '01 · Visual result', resultTitle: 'One picture, full size', resultText: 'A render already published in your feed, shown whole so you can judge it at a glance.',
    story: '02 · Picture journey', storyTitle: 'A picture journey', storyText: 'Several moments of the same work, to go through in order.',
    clip: '03 · Motion', clipTitle: 'A clip', clipText: 'A video already published in your feed. Play it to judge the movement.',
    proposal: '04 · Your choice', open: 'Open full image', step: (n: number, total: number) => `Image ${n} of ${total}`,
    recommended: 'Recommended', instruction: 'what will be sent', send: 'Send my choice', sending: 'Sending…', sent: 'Choice sent',
    keep: 'Keep this format', kept: 'Format selected on this device', preference: 'Your format choice is saved on this device. You can change it.', missing: 'This example is unavailable in the current feed.',
  },
})
