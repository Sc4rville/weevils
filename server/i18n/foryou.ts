// The « for you » stream (server/foryou.ts): the one-line texts of what weevilsd computes itself (alerts, a cut
// session, the proposals band), the reasons of a refused request, and the hidden notes that go to weevboss with a
// tap or a reply. The curator's prompts (generated items) will live here too.
import { defineMessages } from '../i18n.ts'

export default defineMessages({
  fr: {
    // ---- refused requests (shown as is by the app and by « weevils post / show »)
    notFound: 'ce n’est plus dans le flux',
    localOnly: 'réservé à cette machine',
    emptyText: 'rien à dire',
    noReply: 'on ne peut pas répondre à ça',
    noAction: 'ce bouton n’existe plus',
    cardGone: 'cette proposition n’est plus là',
    mailOff: 'le mail n’est pas branché',
    noMore: 'rien de plus là-dessus pour l’instant',
    noMedia: 'les images et vidéos ne sont pas disponibles ici',
    // ---- sessions
    /** A session waits for the user and its tool gave no question. */
    waiting: 'attend ta réponse',
    /** A session cut off mid-work; `why` comes from the core catalog (cutWhy). */
    cut: (why: string) => `Coupée en plein travail : ${why}.`,
    resume: 'Reprendre',
    // ---- alerts (one sober line each)
    usage: (tool: string, window: string, percent: number) => `${tool} : ${window} à ${percent} %`,
    window_session: 'fenêtre de 5 h',
    window_week: 'semaine',
    window_model: (label: string) => `semaine ${label}`,
    saturated: (machine: string) => `${machine} est saturée`,
    diskFull: (machine: string, percent: number) => `Disque de ${machine} plein à ${percent} %`,
    offline: (machine: string) => `${machine} est hors ligne`,
    autoFailed: (title: string, note: string) => `Tâche auto échouée : ${title}${note ? ` (${note})` : ''}`,
    // ---- proposals
    proposals: (n: number) => (n > 1 ? `${n} propositions` : 'Une proposition'),
    // ---- what weevboss receives
    /** The visible message of a tapped button under a post. */
    go: (label: string) => `Vas-y : ${label}`,
    /** Hidden note joined to that message (never shown in the thread). */
    actBrief: (post: string, brief: string) => `l'utilisateur a touché ce bouton sous ton mot dans son flux « pour toi » (« ${post} »). À faire : ${brief}`,
    /** Hidden note joined to a reply typed under a post. */
    replyBrief: (post: string) => `réponds au message ci-dessus : l'utilisateur l'a écrit dans son flux « pour toi », en réponse à ton mot « ${post} »`,
  },
  en: {
    notFound: 'this is no longer in the stream',
    localOnly: 'only from this machine',
    emptyText: 'nothing to say',
    noReply: 'this cannot be replied to',
    noAction: 'this button is gone',
    cardGone: 'this proposal is gone',
    mailOff: 'mail is not set up',
    noMore: 'nothing more on this for now',
    noMedia: 'images and videos are not available here',
    waiting: 'waiting for your answer',
    cut: (why: string) => `Cut off mid-work: ${why}.`,
    resume: 'Resume',
    usage: (tool: string, window: string, percent: number) => `${tool}: ${window} at ${percent}%`,
    window_session: '5 h window',
    window_week: 'week',
    window_model: (label: string) => `${label} week`,
    saturated: (machine: string) => `${machine} is saturated`,
    diskFull: (machine: string, percent: number) => `${machine}'s disk is ${percent}% full`,
    offline: (machine: string) => `${machine} is offline`,
    autoFailed: (title: string, note: string) => `Auto task failed: ${title}${note ? ` (${note})` : ''}`,
    proposals: (n: number) => (n === 1 ? 'One proposal' : `${n} proposals`),
    go: (label: string) => `Go ahead: ${label}`,
    actBrief: (post: string, brief: string) => `the user tapped this button under your post in their "for you" stream ("${post}"). To do: ${brief}`,
    replyBrief: (post: string) => `answer the message above: the user wrote it in their "for you" stream, as a reply to your post "${post}"`,
  },
})
