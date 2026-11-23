import { defineMessages } from './index'

// The guided tour of weevils next (next/src/tour.tsx): one line per stop, in weevboss's voice, what the place gives you.
export default defineMessages({
  fr: {
    menu: 'Tout ce que tu fais tourner est à un tap d’ici. Touche ici.',
    projects: 'Tes projets. Chaque conversation d’agent vit sous son projet : touches-en une pour suivre ou reprendre la main.',
    projectsNone: 'Tes projets arriveront ici, chacun avec les conversations de ses agents. Demande-moi quelque chose et le premier apparaît.',
    autonomous: 'Autonome : ce qui tourne tout seul, même pendant que tu dors.',
    factory: 'Ta fabrique : tes machines, tes abonnements IA et le rythme de tes agents. Des interrupteurs, rien à configurer.',
    foryou: 'Pour toi : ce que tes agents ont fait pendant ton absence, prêt à regarder.',
    composer: 'Écris-moi ou parle-moi ici. Je brief les agents, je suis leur travail et je te dis quand c’est fini.',
    camera: 'Un truc cloche à l’écran ? Touche l’appareil photo puis tape deux fois : je vois ce que tu vois.',
    next: 'suivant',
    done: 'terminer',
    skip: 'passer le tour',
    tapIt: 'touche-le',
    count: (i: number, n: number) => `${i} / ${n}`,
    label: 'Tour guidé',
  },
  en: {
    menu: 'Everything you run is one tap away. Tap here.',
    projects: 'Your projects. Each agent’s conversation sits under its project: tap one to read along or step in.',
    projectsNone: 'Your projects land here, each with its agents’ conversations. Ask me to make something and the first one appears.',
    autonomous: 'Autonomous: what runs on its own, even while you sleep.',
    factory: 'Your factory: your machines, your AI subscriptions and the pace your agents work at. Switches, nothing to configure.',
    foryou: 'For you: what your agents made while you were away, ready to look at.',
    composer: 'Write or talk to me here. I brief the agents, follow their work and tell you when it’s done.',
    camera: 'Something looks off? Tap the camera, then double tap: I see what you see.',
    next: 'next',
    done: 'done',
    skip: 'skip the tour',
    tapIt: 'tap it',
    count: (i: number, n: number) => `${i} / ${n}`,
    label: 'Guided tour',
  },
})
