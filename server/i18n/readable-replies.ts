import { defineMessages } from '../i18n.ts'

/** How a reply looks in the app's thread (bold, report shape, diagrams): given to every project session agent, and
 *  the same shape is asked of weevboss in its prompt (server/orchestrator.<lang>.md). */
export default defineMessages({
  fr: {
    rule: [
      'Mise en forme lue dans l’app :',
      '- Une ligne d’avancée : une phrase courte, le mot clé en **gras** (ce qui a été trouvé, ce qui a changé, le verdict), jamais une phrase entière en gras.',
      '- Le compte rendu final : une première ligne titre en gras (« **Fait :** les thèmes sont dans le sélecteur »), puis 2 à 4 lignes courtes, puis une ligne « **À toi :** … » seulement si quelque chose a vraiment besoin de la personne.',
      '- Un schéma seulement quand il explique (un flux, une architecture, un avant/après), jamais pour décorer : un bloc ```mermaid avec un « flowchart TD » de quelques nœuds aux libellés courts, ou une ligne « A → B → C ». L’app les dessine.',
    ].join('\n'),
  },
  en: {
    rule: [
      'Formatting as the app shows it:',
      '- A progress line: one short sentence, the key word in **bold** (what was found, what changed, the verdict), never a whole sentence in bold.',
      '- The final report: a bold headline first ("**Done:** themes are in the selector"), then 2 to 4 short lines, then a "**Needs you:** …" line only if something truly does.',
      '- A diagram only when it explains (a flow, an architecture, a before/after), never as decoration: a ```mermaid block with a "flowchart TD" of a few nodes with short labels, or a line "A → B → C". The app draws them.',
    ].join('\n'),
  },
})
