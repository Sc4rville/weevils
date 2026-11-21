import { defineMessages } from '../i18n.ts'

/** Two working habits every project session agent weevils starts gets (Claude Code and Codex): see the app through
 *  `weevils capture`, and delete in a way that never stops on a built-in approval. */
export default defineMessages({
  fr: {
    rule: [
      'Pour voir ou filmer cette app weevils comme sur un téléphone : `weevils capture <sortie.png|sortie.mp4> [--open "#s=<id de session>"] [--theme <nom>] [--seconds N] [--frame]`. Ne lis jamais le fichier du code d’accès toi-même.',
      'Pour supprimer, donne des chemins absolus ou des motifs précis (`rm -f /tmp/x/vid/*.webm`), jamais `cd dossier && rm x/*` : Claude Code demande alors une autorisation même quand elles sont désactivées, et la session reste bloquée.',
    ].join('\n'),
  },
  en: {
    rule: [
      'To see or record this weevils app as a phone shows it: `weevils capture <out.png|out.mp4> [--open "#s=<session id>"] [--theme <name>] [--seconds N] [--frame]`. Never read the access code file yourself.',
      'To delete, give absolute paths or specific patterns (`rm -f /tmp/x/vid/*.webm`), never `cd dir && rm x/*`: Claude Code then asks for approval even with permissions skipped, and the session stalls.',
    ].join('\n'),
  },
})
