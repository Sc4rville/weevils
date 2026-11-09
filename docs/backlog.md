# Backlog — retours (nuit du 9 novembre 2026)

Tout ce que l’utilisateur dicte pendant la session est noté ici, dans l'ordre, puis coché quand c'est livré. Rien ne se perd.

## Reçu

1. [x] **Faux « ! à toi »** — la session passait « à toi » alors que rien n'attendait. Cause : le détecteur d'écran prenait « approve » / « do you want » dans le texte normal pour une question, et montrait n'importe quelle ligne (« … +5 lines (ctrl+o to expand) »). → détecteur exigeant (pied de dialogue + options), tests.
2. [x] **Page session = la vraie conversation, pas l'écran du terminal** — plus de bande blanche inversée, plus de capture tmux mise en avant. Le fil (toi / l'agent / ce qu'il fait) sur la couleur du projet, simplifié dans le style weevils, animé. L'écran du terminal reste accessible mais replié, en secours. Une question en attente apparaît dans le fil avec les touches de réponse.
3. [x] **Combien coûterait la retranscription des conversations dans « notre style »** → réponse : 0 € pour le fil lui-même (le transcript contient déjà tout), le LLM ne sert que pour résumer/renommer (codex exec sur l'abonnement = 0 €, ou Haiku ≈ 0,02 € par session).
4. [x] **Ordre des bandes vivant** — les projets avec des agents en cours remontent en haut (à toi > travaille > ouverte > reste par activité), les bandes se déplacent avec animation. Les catégories inventées ne sont plus reléguées en bas.
5. [x] **Renommage des sessions** — le titre = ce dont la session parle maintenant (son dernier bloc), pas le premier message. Renommage LLM périodique sur l'abonnement (codex exec), titre + « en ce moment : … ».
6. [x] **Ne rien perdre** de ce que l’utilisateur dicte pendant le travail → ce fichier.

7. [x] **Agent principal « chill »** — en haut, quand on parle à weevils, il ne doit pas déballer toutes les sessions ni prendre toute la page. Conversation générale tranquille : elle s'agrandit un peu à l'ouverture, pas trop. Quand on demande quelque chose, il propose en bas, dans une rangée qui défile horizontalement (peu de place), les meilleures destinations par ordre décroissant de compatibilité : d'abord la meilleure (ex. « nouvelle session dans tel projet », déjà nommée), puis « envoyer à cette session ouverte », puis une autre session, etc. On swipe pour voir la suite.

8. [x] **Virer les sessions qui ne marchent pas avec weevils** — celles ouvertes dans un terminal avant l'installation de wv (non pilotables) polluent la liste : on ne les affiche plus. Les sessions terminées restent repliées, limitées aux plus récentes.
9. [x] **Vert fluo quand ça travaille** — animations vert fluo sur les sessions en cours (l’utilisateur veut y revenir ; premier jet : l'étoile des sessions qui travaillent pulse en vert fluo, idem sur le nom du projet).

10. [x] **Mode app (plus Safari)** — le manifeste est déjà en `standalone` : il suffit d'ajouter weevils à l'écran d'accueil depuis Safari (Partager → Sur l'écran d'accueil). Le code d'accès est redemandé une fois dans l'app (cookies séparés), puis les notifications deviennent possibles.

11. [x] **Animations quand ça travaille** — barre vert fluo qui balaie sous l'en-tête de la session, points qui respirent sur « claude travaille », étoile fluo qui tourne sur les étapes en cours et dans les listes.
12. [x] **Flux encore mieux, instantané, simplifié** — fenêtre des 60 derniers messages (le reste à la demande), longs messages de l’utilisateur repliés à 5 lignes, le dernier pas d'une suite d'étapes apparaît en glissant.
13. [x] **Skill « i-have-adhd »** (ayghri, 40k étoiles) installé pour Claude Code sur le PC et le VPS : `/i-have-adhd` dans une session l'active (réponses action d'abord, étapes numérotées, zéro blabla).

14. [x] **Photos dans les conversations** — bouton « + » dans le champ d'écriture d'une session : photos du téléphone réduites (≤ 1600 px, JPEG), déposées sur la machine de la session (`~/.local/share/weevils/inbox/`), l'agent reçoit le chemin et va les regarder. Testé bout en bout (VPS → PC → session Claude → image lue).
15. [x] **Dictée vocale** — bouton « o » : un appui pour enregistrer, un appui pour transcrire (OpenAI, même moteur que la dictée du PC, sans prompt de transcription), le texte arrive dans le champ, à toi d'envoyer. Dispo dans les sessions et dans l'agent principal. Clé posée sur le VPS dans `~/.config/weevils/env`.
16. [x] **Mode app / boîtes noires** — capture reçue : c'était iOS (pilule du domaine + barre d'accessoires clavier), pas weevils. Le clavier se ferme après envoi pour les faire disparaître. « Privée » = icône créée depuis un onglet privé → l’utilisateur la recrée depuis un onglet normal.
17. [x] **weevils = vrai orchestrateur** — plus de routage probabiliste ni de puces. La bande du haut est un chat avec une session Claude dédiée (cachée des projets), qui a la commande `weevils` (sessions / read / send / new / projects) et écrit lui-même dans les sessions. Dans chaque fil : trois voix, toi / weevils (trait violet) / l'agent. La conversation du haut grandit jusqu'à la moitié de l'écran, pas plus.
18. [x] **Titres courts** — titre = thème de la session en 2 à 5 mots (« UX de weevils »), « now » ≤ 7 mots, en-tête de session réduit à deux lignes.

19. [x] **Animations** — barres horizontale et verticale retirées ; il ne reste que les étoiles et les trois points.
20. [x] **L'orchestrateur sait décider** — repos GitHub , créer un nouveau projet (repo privé + clone + session), nouvelle session ou session existante, `ultracode` pour les gros chantiers multi-agents, changer le mode d'une session (/model, /effort, /fast, /i-have-adhd…), VPS vs PC. Trust du dossier accepté d'avance. Testé : il lit les sessions et dispatche un message signé weevils (trois voix vérifiées).

21. [x] **Ligne de session en une ligne** — outil en signe (✳ claude, ⊚ codex, petit « pc »), activité courante à droite avec la durée.
22. [x] **Rattachement par le contenu** — une session hors repo (lancée depuis ~/Documents) va dans le projet dont elle parle ; « divers » seulement si rien ne colle.
23. [x] **Fil complet** — les messages envoyés pendant que l'agent travaille (mid-turn) apparaissent, signés toi ou weevils.

## À venir / idées notées

- Suite sur le VPS : `ssh vps -t zellij -s weevils` puis `claude` dans ~/projects/weevils, ou via l'orchestrateur depuis l'app.
- Renommeur : le titre choisi dans l'outil (/rename) prime toujours ; le LLM ne touche pas aux sessions « codex exec ».
