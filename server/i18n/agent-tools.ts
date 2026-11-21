import { defineMessages } from '../i18n.ts'

/** Four working habits every project session agent weevils starts gets (Claude Code and Codex): see the app through
 *  `weevils capture`, show a before/after with `weevils compare`, delete in a way that never stops on a built-in approval, and react to the person's messages. */
export default defineMessages({
  fr: {
    rule: [
      'Pour voir ou filmer cette app weevils comme sur un téléphone : `weevils capture <sortie.png|sortie.mp4> [--open "#s=<id de session>"] [--theme <nom>] [--seconds N] [--frame]`. Ne lis jamais le fichier du code d’accès toi-même.',
      'Pour supprimer, donne des chemins absolus ou des motifs précis (`rm -f /tmp/x/vid/*.webm`), jamais `cd dossier && rm x/*` : Claude Code demande alors une autorisation même quand elles sont désactivées, et la session reste bloquée.',
      'Un avant/après se montre en une image : `weevils compare <avant> <après> <sortie.compare.png|.mp4> [--crop x,y,w,h]` (recadré sur ce qui a changé, la même zone des deux côtés), puis `weevils show <sortie> "ce qui a changé, en une phrase"` ; jamais deux captures brutes.',
      'Une réaction sur un message de la personne (un emoji sur son coin, comme WhatsApp) se lit seule depuis l’état réel (registre des demandes, session au travail) ; pour un cas qu’il ne dit pas : `weevils react <emoji> [<id du message>|last] [--session <id>]` (`""` la retire). Un seul emoji, jamais du texte.',
    ].join('\n'),
  },
  en: {
    rule: [
      'To see or record this weevils app as a phone shows it: `weevils capture <out.png|out.mp4> [--open "#s=<session id>"] [--theme <name>] [--seconds N] [--frame]`. Never read the access code file yourself.',
      'To delete, give absolute paths or specific patterns (`rm -f /tmp/x/vid/*.webm`), never `cd dir && rm x/*`: Claude Code then asks for approval even with permissions skipped, and the session stalls.',
      'Show a before/after as one picture: `weevils compare <before> <after> <out.compare.png|.mp4> [--crop x,y,w,h]` (cropped on what changed, the same area on both sides), then `weevils show <out> "what changed, in one sentence"`; never two raw screenshots.',
      'A reaction on one of the person’s messages (an emoji on its corner, like WhatsApp) comes from real state on its own (the request ledger, a session at work); for a case it does not cover: `weevils react <emoji> [<message id>|last] [--session <id>]` (`""` removes it). One emoji, never text.',
    ].join('\n'),
  },
})
