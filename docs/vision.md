# Vision — prime sur le kit

Précisions orales du 8 novembre 2026. En cas de conflit avec `harness-interface-kit/`, ce fichier gagne.

## Esthétique

- **Tout est en bandes** horizontales empilées. Chaque bande a sa couleur.
- **Aucun endroit sans couleur** : pas de séparation, pas de fond neutre, pas de gouttière. Même les zones système (haut/bas du téléphone) sont colorées.
- **Pas de box, pas de cartes, pas d'icônes dessinées.** Tout se passe à l'intérieur des bandes.
- **Icônes = caractères du clavier** (`+`, `!`, `/`, `>`, `*`, `#`, `@`, `↑`…), parfois en plus grand, pour communiquer au lieu de pictogrammes.
- **Une seule typo** : celle de Notes sur iPhone (police système Apple). On joue uniquement sur la graisse et la taille, jamais une deuxième famille.
- **Light** : couleurs vraiment bright, texte noir. **Sombre** : couleurs sombres mais accueillantes, texte blanc.
- Esthétique pop, simple.

## Interaction

- **Dynamique, physique** : toucher une bande l'ouvre, les autres se replient ; une chose en fait bouger une autre (animations à ressort, mouvement avec inertie).
- **Taille adaptative, jamais « derrière »** : la bande ouverte grossit (gros titre, tout son contenu), les autres deviennent de fines lanières (nom + résumé). Aucune bande ne passe sous une autre, aucun texte coupé par la bande suivante. Références aimées : bandes droites pleine largeur (AI OS, Slava Kornilov) et l'épaisseur qui varie (app vélo) — pas leurs cartes empilées ni leurs coins arrondis.
- **En haut** : l'agent principal, l'endroit central pour tout monitorer et prompter.
- **En bas** : une bande sticky avec les agents qui tournent H24 et ce qui est à côté.
- **Chaque conversation/session s'ouvre en mode chat** et on interagit directement avec elle (comme une console cloud où l'on clique sur une ressource pour la piloter).

## Ce que fait le système (cible backend)

- Organisé **par repo**.
- Un système intelligent qui voit ce qui se passe sur le VPS, sur GitHub, et connaît les transcripts ChatGPT et Claude.
- Il range automatiquement ce fil d'informations dans les bandes ; si un élément n'est lié à aucun repo, il **invente une catégorie**.
- Il permet de **contrôler à distance** les sessions qui tournent sur le VPS.

## Plateforme

- Usage principal : **téléphone (iPhone)**.
