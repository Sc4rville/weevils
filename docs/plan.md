# Plan weevils : du prototype au vrai poste de pilotage

Écrit le 8 novembre 2026. Objectif final : monitorer et piloter, depuis le téléphone, mes projets, mes sessions Claude Code / Codex et mes discussions LLM, rangés intelligemment, **avec mes abonnements, sans coût d'API**.

## Principes

1. **Zéro coût en plus.** weevils ne touche jamais à un jeton ni à une clé. Il pilote les CLI officielles `claude` (2.1.x) et `codex` (0.167) déjà connectées à mes abonnements sur le VPS. Usage personnel de ces outils = leur usage normal. Les limites d'usage des abonnements s'appliquent : tout ce qui consomme (classement, H24, agent principal) doit rester sobre.
2. **Le VPS est la source de vérité.** Un démon `weevilsd` y tourne en permanence (service systemd utilisateur) ; l'app iPhone n'est qu'une fenêtre dessus.
3. **Plus aucune option démo dans l'app.** Les fixtures ne servent plus qu'aux tests. La bande « démo » disparaît dès que les vraies données arrivent.
4. **Sécurité d'abord.** Pouvoir écrire dans un terminal = accès shell à distance. Rien en écriture avant l'authentification.

## Architecture

```
iPhone (PWA weevils) ──HTTPS + SSE──▶ Caddy ──▶ weevilsd (VPS · Node 22 · SQLite)
                                                   ├─ lit   ~/.claude/projects/**/*.jsonl   (sessions Claude Code)
                                                   ├─ lit   ~/.codex/sessions/**/rollout-*.jsonl (sessions Codex)
                                                   ├─ reçoit les hooks Claude Code + notify Codex (état en direct)
                                                   ├─ pilote zellij (write-chars, dump-screen, list-sessions)
                                                   ├─ lance  claude -p / codex exec (headless, abonnement)
                                                   ├─ lit   git + gh (repos, branches, commits, PR)
                                                   └─ importe les exports ChatGPT / Claude.ai
```

Repo : `app/` (la PWA actuelle) + `server/` (weevilsd) + `shared/` (les types de `src/state/types.ts`, déjà pensés pour le backend).

Constats vérifiés sur le VPS le 8 novembre 2026 :
- chaque ligne des transcripts Claude Code porte `sessionId`, `cwd`, `gitBranch`, `isSidechain` (sous-agents) ;
- chaque transcript Codex commence par `session_meta` avec le `cwd` ;
- zellij 0.45 a `action write-chars` et `action dump-screen` ;
- `~/projects` contient des familles de repos (`lws-*`, `mygame-*`) : un projet = une famille, pas un repo.

## Les phases

### Phase 0 · Socle et sécurité (1 à 2 jours)
- Découpage `app/` + `server/`, base SQLite (`node:sqlite`), API + flux SSE.
- **Connexion par passkey (Face ID)**, un seul utilisateur, cookie de session. Aucune route d'écriture sans elle.
- weevilsd en service systemd utilisateur, exposé via Caddy (`weevils.scarville.tech`), journal de toutes les actions.
- La PWA remplace son store local par un client API (mêmes types).

**Fini quand** l'iPhone se connecte avec Face ID et voit une liste de projets réelle (même vide).

### Phase 1 · Voir ce qui tourne sur le VPS (2 à 3 jours)
- Collecteur Claude Code : surveillance des `.jsonl`, lecture incrémentale (offset), messages utilisateur/assistant, outils appelés, sous-agents (`isSidechain`), `cwd` → repo → projet.
- Collecteur Codex : même chose sur les `rollout-*.jsonl`.
- **État exact en direct** via les hooks Claude Code (`SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`, `SubagentStop`, `SessionEnd`) qui préviennent weevilsd : travaille / à toi / disponible / terminée. Pour Codex : `notify` dans `config.toml` (fin de tour) + fin de fichier.
- Sessions vivantes via `zellij list-sessions`.
- Projets = familles de repos de `~/projects` (règle de préfixe, modifiable dans l'app) + infos GitHub via `gh`.

**Fini quand** j'ouvre `claude` dans un terminal du VPS et la session apparaît en moins de 3 s dans la bonne bande, avec le bon état.

### Phase 2 · Agir depuis le téléphone (2 à 3 jours)
- **Convention de lancement** : un petit lanceur `wv` démarre `claude` / `codex` dans une session zellij nommée (`wv-<repo>-<n>`). C'est ce qui permet d'écrire dans une session vivante.
- Envoyer à une session vivante : `zellij action write-chars` + Entrée, après lecture de l'écran (`dump-screen`) pour ne jamais taper dans un menu par erreur.
- Session fermée ou lancée hors zellij : reprise headless `claude -p --resume <id>` / `codex exec resume <id>`, réponse en streaming.
- `+` : weevilsd ouvre une session zellij dans le repo et lance l'agent avec le premier message.
- **« À toi »** : le hook `Notification` (permission, question) déclenche une **notification push sur l'iPhone** (Web Push, gratuit, PWA iOS 16.4+). L'app montre l'écran exact de la question et envoie la réponse choisie.
- Garde-fous : seulement des messages vers les agents, jamais de commande shell libre ; tout est journalisé.
- La bande démo est supprimée.

**Fini quand**, depuis l'iPhone, je réponds à une demande de permission d'une session Claude du VPS et je la vois repartir.

### Phase 3 · Transcription des conversations LLM (2 à 3 jours)
- **Source fiable** : les exports officiels ChatGPT (`conversations.json`) et Claude.ai (zip). Importeur idempotent (dédoublonnage par identifiant), dépôt du zip depuis l'iPhone ou dossier surveillé sur le VPS.
- **Source continue, en option** : une petite extension Chrome weevils qui, quand j'ouvre une conversation sur chatgpt.com ou claude.ai sur le PC, l'envoie à weevilsd. C'est mon compte et mon navigateur, mais lire leurs pages est fragile et en zone grise de leurs conditions : désactivable, jamais indispensable.
- Limite honnête : aucune voie officielle ne synchronise automatiquement les conversations faites dans les apps iPhone ; elles arrivent par l'export.
- Mode chat sur une conversation importée : on ne peut pas écrire dans ChatGPT / Claude.ai à leur place. « Continuer ici » ouvre une session Claude headless avec la conversation en contexte (abonnement).

**Fini quand** un export importé donne des conversations lisibles, rangées et recherchables.

### Phase 4 · Classement intelligent et dynamique (2 jours)
1. **Déterministe, gratuit, instantané** : session d'agent → `cwd` → repo → projet. Couvre presque toutes les sessions.
2. **Local, gratuit** : embeddings sur le CPU du VPS (petit modèle multilingue) ; similarité entre une conversation et chaque projet (README, noms, conversations déjà rangées).
3. **Juge, sur l'abonnement** : `claude -p --model haiku` seulement pour les cas incertains, en lot, réponse JSON `{projet | nouvelle catégorie, raison, confiance}`, mise en cache.
- Les corrections deviennent des exemples réutilisés ; les catégories inventées se renomment et se fusionnent.
- Reclassement automatique quand un repo apparaît ; « à ranger » seulement sous un seuil de confiance ; chaque rangement dit pourquoi.

**Fini quand** 90 % des conversations importées sont rangées sans moi.

### Phase 5 · Explorateur de fichiers fluide (1 à 2 jours)
- API en lecture seule, enfermée dans le repo (`git ls-files`, respecte `.gitignore`), arbre chargé à la demande, cache et préchargement.
- Lecture : markdown rendu, code coloré (même police), images, recherche (ripgrep).
- **« Ce que l'agent a changé »** : les fichiers touchés par une session (outils `Edit` / `Write` des transcripts) et le diff des derniers commits, accessibles depuis la session.

**Fini quand** je navigue un repo et lis un fichier depuis l'iPhone sans attente perceptible.

### Phase 6 · H24 réel (1 à 2 jours)
- Une activité H24 = un timer systemd utilisateur qui lance `claude -p` ou `codex exec` (abonnement) dans un repo.
- Activé / désactivé = timer actif ou non ; en cours = processus vivant ; dernier résultat = sa sortie. Pause / reprise réelles.

### Phase 7 · Agent principal réel (2 jours)
- Une session Claude headless avec un serveur MCP weevils aux outils limités : lister les sessions, envoyer un message, ouvrir, classer, résumer.
- Il route mes ordres (« reprends le crm ») vers la bonne session et demande confirmation quand c'est ambigu.

### Phase 8 · Style et UX (avec Scarville)
Icônes, nettoyage, densité, animations : après avoir vécu quelques jours avec les vraies données.

**Total estimé** : 2 à 3 semaines de travail d'agent, livrable phase par phase, chaque phase utilisable sur l'iPhone.

## Risques

- **Formats de transcripts non documentés** : ils changent avec les versions des CLI → parseurs tolérants, testés sur de vrais fichiers.
- **Écrire dans un terminal est fragile** (menus, prompts) → lecture de l'écran avant chaque envoi, reprise headless en secours.
- **Quotas d'abonnement** : classement et H24 consomment ; on mesure et on plafonne.
- **Conditions d'utilisation** : on reste sur les CLI officielles ; on n'extrait jamais les jetons OAuth pour d'autres outils.
- **Sessions lancées sur le PC** (pas sur le VPS) : hors périmètre au début ; plus tard, un petit relais sur le PC.

## Décisions à prendre

1. Authentification : passkey Face ID (recommandé) ou Tailscale.
2. Lancer désormais les sessions via `wv` (dans zellij) pour pouvoir leur écrire en direct.
3. Conversations : exports seuls, ou exports + extension Chrome.
4. Projet = famille de repos par préfixe (`lws-*`, `mygame-*`).

## État au 8 novembre 2026 (soir)

Fait et vérifié en vrai :
- weevilsd en service permanent sur le VPS, app servie sur weevils.scarville.tech, connexion par code ou QR (passkey Face ID : à faire).
- Sessions Claude Code et Codex du VPS **et du PC** (fédération par tunnel SSH inversé), rangées par projet, état exact par les hooks.
- Écrire à une session, lire l'écran du terminal, répondre aux questions (touches), créer une session, reprendre une session fermée : testé avec Codex de bout en bout.
- Pilotage par tmux (`wv`), qui survit aux redémarrages de weevilsd.
- Explorateur de fichiers fluide (cache + préchargement), sur la machine qui porte le repo.
- H24 : jobs longs de ~/logs et timers `wv-*`.
- Conversations ChatGPT / Claude.ai : import des exports (zip ou JSON, depuis l'iPhone ou ~/weevils-imports), lecture, « continuer ici » avec un agent.
- Classement intelligent : règles + `codex exec` éphémère (abonnement), catégories inventées, corrections réutilisées.
- Plus aucune donnée de démo dans l'app.

Reste :
- Reconnecter Claude Code sur le VPS (connexion expirée) : `ssh -t vps claude` puis `/login`.
- Notifications push iPhone quand une session attend.
- Passkey Face ID à la place du code.
- Agent principal avec un vrai modèle (aujourd'hui : règles simples).
- Style et UX (phase 8), avec Scarville.
