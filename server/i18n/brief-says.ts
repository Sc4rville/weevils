import { defineMessages } from '../i18n.ts'

/** The one spoken line shown in a session's thread in place of a long brief (server/brief-says.ts). */
export default defineMessages({
  fr: {
    prompt: (briefs: string) =>
      [
        'Chaque élément est une consigne qu’un responsable (weevboss) a envoyée à un agent de code. Pour chacune, écris la phrase qu’il dirait à voix haute à un collègue, en français : 4 à 14 mots, simple et humaine, comme un chef qui parle à son équipe.',
        'Pas d’identifiants, pas de chemins de fichiers, pas de noms de branches, pas de jargon, pas de « merci de ». Garde les noms propres (projets, produits).',
        'Exemple : « Fusionne les nouveaux thèmes et enlève les petits textes de statut ».',
        'Ne lis aucun fichier, ne lance aucune commande. Réponds uniquement avec ce JSON : {"items":[{"id":"…","say":"…"}]}',
        'Consignes :',
        briefs,
      ].join('\n'),
  },
  en: {
    prompt: (briefs: string) =>
      [
        'Each item is a brief a manager (weevboss) sent to a coding agent. For each one, write the line the manager would say out loud to a colleague, in English: 4 to 14 words, plain and human, like a manager talking to their team.',
        'No ids, no file paths, no branch names, no jargon, no "please" preamble. Keep proper names (projects, products).',
        'Example: "Merge the new themes and clean up the little status texts".',
        'Don\'t read any file, don\'t run any command. Answer with this JSON only: {"items":[{"id":"…","say":"…"}]}',
        'Briefs:',
        briefs,
      ].join('\n'),
  },
})
