// The « pages » band (server/page-band.ts, docs/LINKS.md « Pages »): what the agent that builds a page is told, in the
// folder it works in (CLAUDE.md, AGENTS.md).
import { defineMessages } from '../i18n.ts'

type Brief = { title: string; url: string; slug: string; data: string }

export default defineMessages({
  fr: {
    tooLong: 'idée trop longue',
    empty: 'il faut une idée',
    notPage: 'page introuvable',
    brief: ({ title, url, slug, data }: Brief) => `# Ton travail : une page, « ${title} »

Ce dossier est une page de la personne, dans la bande « pages » de son weevils. Son adresse : ${url}. Elle s'affiche sur
son téléphone à côté de cette conversation et se recharge toute seule à chaque fichier modifié ici : rien à publier,
aucun serveur à lancer.

- Construis ce qu'elle demande, dans \`index.html\` (et des fichiers à côté). Tout est permis : un visualiseur, un
  studio, un outil, un jeu. Une seule page, pensée d'abord pour un téléphone (390 px de large), qui tient aussi sur un
  ordinateur.
- Le style, sauf si elle en veut un autre : celui de weevils. \`weevils.css\` (déjà lié) donne les couleurs de son thème
  en variables CSS : \`--ink\` (le texte), \`--bg\`, \`--agent\`, \`--h24\`, \`--p0\` … \`--p15\` (16 teintes vives), \`--font\`.
  Des bandes de couleur pleine largeur, des titres en gras, le reste en petit, des angles vifs ; ni ombre, ni cadre,
  ni soulignement, ni texte d'aide.
- Ses données weevils, en lecture seule : \`fetch('weevils.json')\` (adresse relative) renvoie
  \`{ sessions, automations, requests, projects, theme, at }\` ; pour une page vivante, relis-le au plus toutes les 10
  secondes. Ce n'est pas un fichier de ce dossier : weevils le sert à l'adresse de la page (\`weevils.css\` aussi) ;
  pour voir ce qu'il contient maintenant : \`curl -s ${data}\`. La page ne peut rien changer dans weevils : aucune
  autre adresse de weevils ne lui répond. Les bibliothèques d'un CDN public sont permises.
- Renomme la page quand son titre ne lui va plus : \`weevils page . "Nouveau titre" --kind preview --slug ${slug}\`
  (l'adresse reste).
- Après chaque changement, réponds en une ou deux phrases courtes : ce qu'elle voit maintenant. Jamais de code dans la
  conversation.
`,
  },
  en: {
    tooLong: 'idea too long',
    empty: 'an idea is needed',
    notPage: 'page not found',
    brief: ({ title, url, slug, data }: Brief) => `# Your job: one page, "${title}"

This folder is one of the person's pages, in the « pages » band of their weevils. Its address: ${url}. It shows on
their phone next to this conversation and reloads by itself each time a file here changes: nothing to publish, no
server to start.

- Build what they ask, in \`index.html\` (and files next to it). Anything goes: a visualizer, a studio, a tool, a game.
  One page, made for a phone first (390 px wide), that also holds on a computer.
- The look, unless they want another: weevils'. \`weevils.css\` (already linked) gives their theme's colours as CSS
  variables: \`--ink\` (text), \`--bg\`, \`--agent\`, \`--h24\`, \`--p0\` … \`--p15\` (16 vivid hues), \`--font\`. Flat
  full-width colour bands, bold titles, small type for the rest, sharp corners; no shadows, no boxes, no underlines,
  no help text.
- Their weevils data, read-only: \`fetch('weevils.json')\` (a relative address) returns
  \`{ sessions, automations, requests, projects, theme, at }\`; for a live page, read it again at most every 10
  seconds. It is not a file in this folder: weevils serves it at the page's address (\`weevils.css\` too); to see what
  it holds now: \`curl -s ${data}\`. The page cannot change anything in weevils: no other weevils address answers it.
  Libraries from a public CDN are fine.
- Rename the page when its title no longer fits: \`weevils page . "New title" --kind preview --slug ${slug}\` (the
  address stays).
- After each change, answer in one or two short sentences: what they see now. Never paste code in the conversation.
`,
  },
})
