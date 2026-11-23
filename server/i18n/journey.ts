// The onboarding journey's own lines (server/journey.ts, said by server/setup.ts in weevboss's name): a step offered by
// what it lets the person do, a milestone with the use case it opens and one example to try, the tour's end.
// Short, one idea each, actions as links in the sentence (never buttons). `[[win]]**…**` marks a real win (confetti once).
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    tourOffer: 'Ou d’abord, [un tour d’une minute](/#do=tour) de l’app.',
    // ---- the steps, one at a time
    offer_github: 'Prochaine étape, [connecte ton GitHub](/#do=github) : tes conversations y sont gardées, à toi pour de bon, et tes agents y rangent ton code.',
    offer_phone: 'Prochaine étape, [mets weevils sur ton téléphone](/#do=phone) : tes agents dans ta poche, tu réponds de n’importe où.',
    offer_push: 'Prochaine étape, [active les notifications](/#do=push) : je te préviens dès qu’un agent a fini ou t’attend, même app fermée.',
    offer_computer: 'Prochaine étape, [ajoute ton ordinateur](/#do=computer) : ses projets et ses conversations te rejoignent ici.',
    // ---- milestones: the win, what it opens, one example
    wonBrain: (name: string): string => `[[win]]**${name} est connecté** : tes agents peuvent construire maintenant. Essaie : [fais-moi une petite app de notes](/#do=try.notes).`,
    wonBrainJob: (name: string): string => `[[win]]**${name} est connecté** : je lance ce que tu m’as demandé.`,
    wonPhone: '[[win]]**weevils est sur ton téléphone** : tes agents dans ta poche, tu demandes et tu réponds de partout. Essaie : [qu’est-ce que font mes agents ?](/#do=try.status)',
    wonPush: '[[win]]**Notifications activées** : je te préviens dès qu’un agent a fini ou a besoin de toi. Essaie : [préviens-moi quand un petit travail d’une minute est fini](/#do=try.ping)',
    wonRecap: 'Tu peux reprendre n’importe laquelle : [sur quoi je travaillais ces derniers temps ?](/#do=try.recap)',
    wonMachine: (name: string): string => `Essaie : [qu’est-ce que je peux lancer sur ${name} ?](/#do=try.machine)`,
    // ---- the examples, as the person's own words
    try_notes: 'Fais-moi une petite app de notes',
    try_recap: 'Sur quoi je travaillais ces derniers temps ?',
    try_status: 'Qu’est-ce que font mes agents ?',
    try_ping: 'Préviens-moi sur mon téléphone quand un petit travail d’une minute est fini',
    try_machine: 'Qu’est-ce que je peux lancer sur ma nouvelle machine ?',
    // ---- the tour
    tourDone: 'Voilà, tu connais les lieux.',
    tourEnd: 'Dis-moi ce que tu veux faire : un jeu, un site, un petit outil…',
    tourSkip: 'Pas de souci : demande-moi le tour quand tu veux.',
    tourClassic: 'Le tour guidé vit dans la nouvelle interface : [ouvre-la](/?ui=next), puis touche « un tour d’une minute » dans mon fil.',
  },
  en: {
    tourOffer: 'Or first, [a one-minute tour](/#do=tour) of the app.',
    offer_github: 'Next step, [connect your GitHub](/#do=github): your conversations are kept there, yours for good, and your agents save your code to it.',
    offer_phone: 'Next step, [put weevils on your phone](/#do=phone): your agents in your pocket, you answer from anywhere.',
    offer_push: 'Next step, [turn on notifications](/#do=push): I’ll tell you the moment an agent finishes or needs you, even with the app closed.',
    offer_computer: 'Next step, [add your computer](/#do=computer): its projects and conversations join you here.',
    wonBrain: (name: string): string => `[[win]]**${name} is connected**: your agents can build now. Try it: [make me a small notes app](/#do=try.notes).`,
    wonBrainJob: (name: string): string => `[[win]]**${name} is connected**: I’m starting what you asked.`,
    wonPhone: '[[win]]**weevils is on your phone**: your agents in your pocket, ask and answer from anywhere. Try it: [what are my agents up to?](/#do=try.status)',
    wonPush: '[[win]]**Notifications are on**: I’ll tell you the moment an agent finishes or needs you. Try it: [ping me when a one-minute job is done](/#do=try.ping)',
    wonRecap: 'You can pick any of them up: [what was I working on lately?](/#do=try.recap)',
    wonMachine: (name: string): string => `Try it: [what can I run on ${name}?](/#do=try.machine)`,
    try_notes: 'Make me a small notes app',
    try_recap: 'What was I working on lately?',
    try_status: 'What are my agents up to?',
    try_ping: 'Ping my phone when a one-minute job is done',
    try_machine: 'What can I run on my new machine?',
    tourDone: 'That’s it, you know your way around.',
    tourEnd: 'Tell me what you’d like to make: a game, a website, a small tool…',
    tourSkip: 'No problem: ask me for the tour anytime.',
    tourClassic: 'The guided tour lives in the new interface: [open it](/?ui=next), then tap “a one-minute tour” in my thread.',
  },
})
