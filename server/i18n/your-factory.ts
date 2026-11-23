// Messages of server/your-factory.ts (Your factory): refusals shown in the app, and the hidden context of a machine's own
// conversation (never shown: the app strips « ⟦weevils … ⟧ »).
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    unknownMachine: 'Machine inconnue.',
    cantSwitch: 'Ceci ne se coupe pas d’ici.',
    noRejoin: 'Cette machine n’est pas joignable par SSH depuis un autre ordinateur : demande à weevboss d’ajouter une machine.',
    server: 'un serveur',
    serverAt: (host: string) => `un serveur chez ${host}`,
    pc: 'un ordinateur de la personne',
    machine: 'une machine',
    talkContext: (name: string, what: string) =>
      `⟦weevils — Cette conversation est celle de la machine « ${name} » (${what}), où tu tournes : sa santé, ses services, son disque, ses mises à jour et son entretien. Reste sur cette machine ; demande avant tout ce qui redémarre, supprime ou coûte.⟧`,
  },
  en: {
    unknownMachine: 'Unknown machine.',
    cantSwitch: 'This one can’t be switched from here.',
    noRejoin: 'Other computers can’t reach this one over SSH: ask weevboss to add a machine.',
    server: 'a server',
    serverAt: (host: string) => `a server at ${host}`,
    pc: 'a computer of the person’s',
    machine: 'a machine',
    talkContext: (name: string, what: string) =>
      `⟦weevils — This conversation belongs to the machine “${name}” (${what}) you run on: its health, services, disk, updates and upkeep. Stay on this machine; ask before anything that restarts, deletes or costs money.⟧`,
  },
})
