// Messages of server/weevbook/cli.ts (`weevils weevbook backfill | check | compare`). Invariant numbers (THREAD-3,
// BOOK-9) and kinds of difference (said, reply, step) are names from docs/spec: never translated.
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    usage: 'usage : weevils weevbook backfill | check [--repair] | compare [--verbose]',
    locked: 'le weevbook est verrouillé par un autre processus (weevilsd écrit) : réessaie dans un instant',
    progress: (i: number, n: number) => `${i}/${n} sessions`,
    backfill: (n: number, created: number, updated: number, unchanged: number, empty: number) =>
      `${n} sessions : ${created} fils créés, ${updated} complétés, ${unchanged} déjà à jour, ${empty} sans message`,
    written: (events: number, lines: number) => `${events} événements et ${lines} lignes brutes écrits`,
    refused: (n: number) => `${n} événements refusés par le journal, gardés dans une note`,
    failed: (file: string, error: string) => `échec : ${file} : ${error}`,
    main: (commit: string | null) => (commit ? `main composé : ${commit.slice(0, 12)}` : 'main inchangé'),
    checked: (threads: number, events: number) => `${threads} fils, ${events} événements vérifiés`,
    sound: 'aucun invariant cassé',
    broken: (inv: string, n: number) => `${inv} : ${n}`,
    repaired: (n: number) => `${n} fils : thread.md ou meta.json reconstruits depuis le journal`,
    compared: (sessions: number, compared: number, identical: number, empty: number) =>
      `${sessions} sessions : ${compared} comparées, ${identical} identiques, ${empty} sans message`,
    messages: (n: number, same: number) => `${n} messages et étapes dans l'app : ${same} identiques dans le weevbook`,
    intended: (redacted: number, long: number, error: number) =>
      `différences voulues : ${redacted} masqués (secret), ${long} longs (en pièce jointe), ${error} erreurs du fournisseur (tour échoué)`,
    withoutThread: (n: number) => `${n} sessions avec des messages et sans fil`,
    missing: (kind: string, n: number) => `manquants (${kind}) : ${n}`,
    altered: (kind: string, n: number) => `modifiés (${kind}) : ${n}`,
    extra: (kind: string, n: number) => `en plus dans le weevbook (${kind}) : ${n}`,
    unread: (n: number) => `${n} lignes pas encore lues (un tour en cours)`,
    losses: (n: number) => `PERTES : ${n}`,
    noLoss: 'aucune perte',
  },
  en: {
    usage: 'usage: weevils weevbook backfill | check [--repair] | compare [--verbose]',
    locked: 'the weevbook is locked by another process (weevilsd is writing): try again in a moment',
    progress: (i: number, n: number) => `${i}/${n} sessions`,
    backfill: (n: number, created: number, updated: number, unchanged: number, empty: number) =>
      `${n} sessions: ${created} threads created, ${updated} extended, ${unchanged} already up to date, ${empty} without a message`,
    written: (events: number, lines: number) => `${events} events and ${lines} raw lines written`,
    refused: (n: number) => `${n} events refused by the journal, kept in a note`,
    failed: (file: string, error: string) => `failed: ${file}: ${error}`,
    main: (commit: string | null) => (commit ? `main composed: ${commit.slice(0, 12)}` : 'main unchanged'),
    checked: (threads: number, events: number) => `${threads} threads, ${events} events checked`,
    sound: 'no invariant broken',
    broken: (inv: string, n: number) => `${inv}: ${n}`,
    repaired: (n: number) => `${n} threads: thread.md or meta.json rebuilt from the journal`,
    compared: (sessions: number, compared: number, identical: number, empty: number) =>
      `${sessions} sessions: ${compared} compared, ${identical} identical, ${empty} without a message`,
    messages: (n: number, same: number) => `${n} messages and steps in the app: ${same} identical in the weevbook`,
    intended: (redacted: number, long: number, error: number) =>
      `intended differences: ${redacted} redacted (secret), ${long} long (as an attachment), ${error} provider errors (failed turn)`,
    withoutThread: (n: number) => `${n} sessions with messages and no thread`,
    missing: (kind: string, n: number) => `missing (${kind}): ${n}`,
    altered: (kind: string, n: number) => `altered (${kind}): ${n}`,
    extra: (kind: string, n: number) => `extra in the weevbook (${kind}): ${n}`,
    unread: (n: number) => `${n} lines not read yet (a turn in progress)`,
    losses: (n: number) => `LOSSES: ${n}`,
    noLoss: 'no loss',
  },
})
