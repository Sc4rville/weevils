// Moving a conversation between machines, accounts and providers, agreed (docs/spec/07-vault.md, step 4): the one
// line weevboss says for a proposal, and the messages of `weevils weevbook proposals | agree | decline | move |
// machines` (server/weevbook/cli.ts). Machine names and ids are kept as they are.
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    usage: 'usage : weevils weevbook proposals [--json] | agree [<id>] | decline [<id>] | move <session ou fil> --to <machine> [--engine claude|codex] [--account <nom>] [--force] | machines [--json]',
    // What weevboss says, once, in its thread: one line, one yes.
    silentOne: (machine: string, minutes: number, title: string, here: string) => `**${machine}** ne répond plus depuis ${minutes} min. Je continue « ${title} » ici, sur ${here} ?`,
    silentMany: (machine: string, minutes: number, n: number, here: string) => `**${machine}** ne répond plus depuis ${minutes} min. Je continue ses ${n} conversations en cours ici, sur ${here} ?`,
    account: (title: string, account: string) => `Cet abonnement est presque épuisé. Je continue « ${title} » sur ${account || 'ton autre compte'} ?`,
    machine: (title: string, machine: string) => `« ${title} » ne peut plus avancer là où elle est. Je la continue sur ${machine} ?`,
    provider: (title: string, provider: string) => `Plus de place chez ${provider === 'codex' ? 'Claude' : 'Codex'} pour « ${title} ». Je la continue avec ${provider === 'codex' ? 'Codex' : 'Claude'} ?`,
    // The command line (weevboss reads it).
    none: 'aucun déplacement en attente de réponse',
    line: (id: string, state: string, title: string, from: string, to: string, reason: string) => `${id} · ${state} · « ${title} » : ${from} → ${to} (${reason})`,
    noSuch: (id: string) => `aucune proposition ouverte ${id}`,
    agreed: (id: string, title: string, where: string) => `${id} accepté : « ${title} » continue sur ${where}`,
    agreedLater: (id: string, title: string) => `${id} accepté : « ${title} » repart`,
    agreeFailed: (id: string, title: string, why: string) => `${id} accepté, mais « ${title} » n'a pas bougé : ${why}`,
    back: (id: string, title: string, machine: string) => `${id} retiré : ${machine} est de retour et travaille sur « ${title} »`,
    declined: (id: string, title: string) => `${id} refusé : « ${title} » reste où elle est, la question ne sera pas reposée`,
    moved: (thread: string, machine: string, turn: number | null) => (turn === null ? `${thread} continue sur ${machine} (aucun tour en attente : à toi d'écrire)` : `${thread} continue sur ${machine} : tour ${turn} repris`),
    stole: 'son bail a été repris à l’autre machine',
    continues: (title: string, machine: string) => (title ? `« ${title} » continue maintenant sur **${machine}**, avec tout son historique.` : `La conversation continue maintenant sur **${machine}**, avec tout son historique.`),
    refused: (why: string, detail: string) => `pas déplacé (${why}) : ${detail}`,
    atWork: (holder: string, detail: string) => `${holder} y travaille en ce moment (${detail}) : demande l'accord, puis relance avec --force`,
    machineLine: (name: string, id: string, here: boolean, online: boolean) => `${name}${name === id ? '' : ` (${id})`}${here ? ' · cette machine' : online ? '' : ' · éteinte ou injoignable'}`,
    noServer: (why: string) => `weevilsd ne répond pas sur cette machine : ${why}`,
    otherProvider: (provider: string) => `cette conversation tourne avec ${provider} : la continuer avec un autre moteur sur ordre n'est pas encore possible`,
    noAccount: (name: string) => `aucun compte Claude « ${name} » sur cette machine`,
  },
  en: {
    usage: 'usage: weevils weevbook proposals [--json] | agree [<id>] | decline [<id>] | move <session or thread> --to <machine> [--engine claude|codex] [--account <name>] [--force] | machines [--json]',
    silentOne: (machine: string, minutes: number, title: string, here: string) => `**${machine}** has been silent for ${minutes} min. Shall I continue “${title}” here, on ${here}?`,
    silentMany: (machine: string, minutes: number, n: number, here: string) => `**${machine}** has been silent for ${minutes} min. Shall I continue its ${n} conversations at work here, on ${here}?`,
    account: (title: string, account: string) => `This subscription is nearly used up. Shall I continue “${title}” on ${account || 'your other account'}?`,
    machine: (title: string, machine: string) => `“${title}” can't go on where it is. Shall I continue it on ${machine}?`,
    provider: (title: string, provider: string) => `No room left with ${provider === 'codex' ? 'Claude' : 'Codex'} for “${title}”. Shall I continue it with ${provider === 'codex' ? 'Codex' : 'Claude'}?`,
    none: 'no move waits for an answer',
    line: (id: string, state: string, title: string, from: string, to: string, reason: string) => `${id} · ${state} · “${title}”: ${from} → ${to} (${reason})`,
    noSuch: (id: string) => `no open proposal ${id}`,
    agreed: (id: string, title: string, where: string) => `${id} agreed: “${title}” continues on ${where}`,
    agreedLater: (id: string, title: string) => `${id} agreed: “${title}” goes on`,
    agreeFailed: (id: string, title: string, why: string) => `${id} agreed, but “${title}” did not move: ${why}`,
    back: (id: string, title: string, machine: string) => `${id} withdrawn: ${machine} is back and at work on “${title}”`,
    declined: (id: string, title: string) => `${id} declined: “${title}” stays where it is, and it will not be asked again`,
    moved: (thread: string, machine: string, turn: number | null) => (turn === null ? `${thread} continues on ${machine} (no turn was waiting: write to it)` : `${thread} continues on ${machine}: turn ${turn} resumed`),
    stole: 'its lease was taken from the other machine',
    continues: (title: string, machine: string) => (title ? `“${title}” now continues on **${machine}**, with all its history.` : `The conversation now continues on **${machine}**, with all its history.`),
    refused: (why: string, detail: string) => `not moved (${why}): ${detail}`,
    atWork: (holder: string, detail: string) => `${holder} is at work on it right now (${detail}): ask for a yes, then run it again with --force`,
    machineLine: (name: string, id: string, here: boolean, online: boolean) => `${name}${name === id ? '' : ` (${id})`}${here ? ' · this machine' : online ? '' : ' · off or unreachable'}`,
    noServer: (why: string) => `weevilsd does not answer on this machine: ${why}`,
    otherProvider: (provider: string) => `this conversation runs on ${provider}: continuing it with another engine on order is not possible yet`,
    noAccount: (name: string) => `no Claude account “${name}” on this machine`,
  },
})
