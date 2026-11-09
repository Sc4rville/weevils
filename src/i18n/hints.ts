import { defineMessages } from './index'

// First-tap hints (src/ui/hints.tsx): what the element is, then what to do with it. Short, generic.
export default defineMessages({
  fr: {
    devil: 'le diable envoie tes messages à un autre modèle, sans filtre. tape encore pour l’essayer, une fois de plus pour revenir',
    devilOff: 'le diable envoie tes messages à un autre modèle, sans filtre. branche-le d’abord : DEVIL_API_URL dans ~/.config/weevils/env',
    voice: 'le logo, c’est la voix de weevboss. tape pour lui parler, encore pour arrêter, une dernière fois pour envoyer',
    machine: 'tes machines, un carré chacune. sa couleur dit si elle va bien, chauffe (orange) ou sature (rouge). tape pour le détail',
    fs: 'tout le disque de la machine. tape un fichier : on t’explique à quoi il sert',
    quota: 'le cerveau se remplit avec ton quota claude. tape pour voir les 5 h, la semaine et ce qui consomme',
    star: 'l’étoile tourne quand un agent travaille. elle s’arrête quand il a fini ou qu’il t’attend',
    newSession: 'le + lance une session claude ou codex dans ce projet. tape encore pour la décrire',
    attention: 'le ! mène à la session qui attend ta réponse',
    h24: 'la bande h24 : ce qui tourne en continu, même téléphone éteint. tape encore pour l’ouvrir',
    repos: 'tous tes repos github. le + en met un dans le fil, un nom l’ouvre',
    calm: 'le mode conversation : rien que les messages. tape-en une pour y entrer, pince encore pour revenir',
  },
  en: {
    devil: 'the devil sends your messages to another model, unfiltered. tap again to try it, once more to come back',
    devilOff: 'the devil sends your messages to another model, unfiltered. plug it in first: DEVIL_API_URL in ~/.config/weevils/env',
    voice: 'the logo is weevboss’s voice. tap to talk, again to stop, once more to send',
    machine: 'your machines, one square each. its color says fine, busy (orange) or saturated (red). tap for details',
    fs: 'the whole disk of the machine. tap a file: you get what it is for',
    quota: 'the brain fills up with your claude quota. tap for the 5 h window, the week and what uses it',
    star: 'the star spins while an agent works. it stops when it is done or waiting for you',
    newSession: 'the + starts a claude or codex session in this project. tap again to describe it',
    attention: 'the ! takes you to the session waiting for your answer',
    h24: 'the 24/7 band: what runs around the clock, even with your phone off. tap again to open it',
    repos: 'all your github repos. the + puts one in the feed, a name opens it',
    calm: 'conversation mode: just the messages. tap one to step in, pinch again to come back',
  },
})
