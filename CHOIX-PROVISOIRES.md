# Choix provisoires du prototype

Décidés pour avancer, tous réversibles. Les demandes validées sont dans `docs/vision-scarville.md`.

- **Stack** : Vite + React + Motion (ressorts, glisser), en web app installable (PWA). Données de démo locales, sauvegardées dans le navigateur.
- **Caractères-icônes** : `/` fichiers, `@` machine, `!` à toi, `"` conversations, `+` nouvelle session. États de session : `*` travaille (tourne doucement), `!` à toi (ligne inversée noire), `_` disponible, `✓` terminée.
- **Accordéon** : toucher un nom ouvre la bande (titre 48 px, conversations, repo, machine, h24) ; les autres passent en lanière (nom 22 px + résumé). Re-toucher referme.
- **Sous-bandes** : même teinte, luminosité décalée (saturation gardée) pour les zones internes et les messages de l'utilisateur.
- **Pages** : session, conversation, fichiers, machine et nouvelle session s'ouvrent en plein écran dans la couleur du projet ; retour par `<`, glisser vers la droite, Échap ou bouton retour.
- **Agent principal** : routage par règles simples (nom de projet + claude/codex) ; sinon il demande la destination. Le « à ranger » vit dans sa bande.
- **Catégorie inventée** : `idées`, sans repo, pour montrer ce que weevils fait d'un échange hors repo.
- **Palette** : clair = violet `#B39BFF`, bleu `#6FA4FF`, corail `#FF7F67`, rose `#FF8AD6`, menthe `#5FE3A1`, ambre `#FFC64C` ; sombre = versions profondes du kit + `#861A73` et `#0B6B4A`.
- **Démo** : dernière bande (thème, session terminal simulée, remise à zéro) ; elle remplit l'écran jusqu'au rail H24 pour qu'aucune zone ne reste sans couleur.
