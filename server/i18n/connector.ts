// The connector's consent page (server/connector/consent.ts). The tools' own texts are for the chat app's model
// and stay in English (server/connector/tools.ts, docs/spec/05-connector.md).
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    title: (app: string) => `Connecter ${app} à weevils`,
    asks: (app: string) => `${app} demande l’accès à ton weevbook, le carnet de tes conversations.`,
    can: 'Il pourra :',
    save: (app: string) => `enregistrer des conversations de ${app} dans ton weevbook`,
    read: 'retrouver et lire les fils de ton weevbook',
    agent: 'demander à un agent de tes machines de reprendre un fil',
    cannot: 'Il ne pourra ni lire tes fichiers, ni lancer de commande, ni changer tes réglages.',
    back: (host: string) => `Ensuite, retour sur ${host}.`,
    signedIn: 'Ce navigateur est connecté à weevils.',
    code: 'code d’accès',
    allow: 'Autoriser',
    deny: 'Refuser',
    wrongCode: 'Mauvais code. Réessaie.',
    tooMany: 'Trop de mauvais codes : réessaie dans un quart d’heure.',
    expired: 'Cette demande a expiré. Relance la connexion depuis l’app de chat.',
    invalid: 'Cette demande de connexion n’est pas valide. Relance-la depuis l’app de chat.',
    revoke: 'Pour la retirer plus tard, demande-le à weevboss.',
  },
  en: {
    title: (app: string) => `Connect ${app} to weevils`,
    asks: (app: string) => `${app} asks to reach your weevbook, the notebook of your conversations.`,
    can: 'It will be able to:',
    save: (app: string) => `save chats from ${app} in your weevbook`,
    read: 'find and read your weevbook’s threads',
    agent: 'ask an agent on your machines to continue a thread',
    cannot: 'It cannot read your files, run commands or change your settings.',
    back: (host: string) => `Then you go back to ${host}.`,
    signedIn: 'This browser is signed in to weevils.',
    code: 'access code',
    allow: 'Allow',
    deny: 'Cancel',
    wrongCode: 'Wrong code. Try again.',
    tooMany: 'Too many wrong codes: try again in a quarter of an hour.',
    expired: 'This request has expired. Start the connection again from the chat app.',
    invalid: 'This connection request is not valid. Start it again from the chat app.',
    revoke: 'To take it back later, ask weevboss.',
  },
})
