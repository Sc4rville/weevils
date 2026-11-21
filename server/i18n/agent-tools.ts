import { defineMessages } from '../i18n.ts'

/** Three working habits every project session agent weevils starts gets (Claude Code and Codex): see the app through
 *  `weevils capture`, show a before/after with `weevils compare`, and delete in a way that never stops on a built-in approval. */
export default defineMessages({
  fr: {
    rule: [
      'Pour voir ou filmer cette app weevils comme sur un téléphone : `weevils capture <sortie.png|sortie.mp4> [--open "#s=<id de session>"] [--theme <nom>] [--seconds N] [--frame]`. Ne lis jamais le fichier du code d’accès toi-même.',
      'Pour supprimer, donne des chemins absolus ou des motifs précis (`rm -f /tmp/x/vid/*.webm`), jamais `cd dossier && rm x/*` : Claude Code demande alors une autorisation même quand elles sont désactivées, et la session reste bloquée.',
      'Un avant/après se montre en une image : `weevils compare <avant> <après> <sortie.compare.png|.mp4> [--crop x,y,w,h]` (recadré sur ce qui a changé, la même zone des deux côtés), puis `weevils show <sortie> "ce qui a changé, en une phrase"` ; jamais deux captures brutes.',
    ].join('\n'),
  },
  en: {
    rule: [
      'To see or record this weevils app as a phone shows it: `weevils capture <out.png|out.mp4> [--open "#s=<session id>"] [--theme <name>] [--seconds N] [--frame]`. Never read the access code file yourself.',
      'To delete, give absolute paths or specific patterns (`rm -f /tmp/x/vid/*.webm`), never `cd dir && rm x/*`: Claude Code then asks for approval even with permissions skipped, and the session stalls.',
      'Show a before/after as one picture: `weevils compare <before> <after> <out.compare.png|.mp4> [--crop x,y,w,h]` (cropped on what changed, the same area on both sides), then `weevils show <out> "what changed, in one sentence"`; never two raw screenshots.',
    ].join('\n'),
  },
})
