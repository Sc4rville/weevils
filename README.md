# Weevils

Weevils (nom du produit) : le poste de pilotage de Scarville. Depuis le téléphone, voir et piloter ses sessions Claude Code et Codex (VPS et PC), ses conversations ChatGPT et Claude.ai, et ses jobs longs, le tout rangé par projet, avec ses abonnements et sans coût d'API.

- Vision et règles de design : [`docs/vision-scarville.md`](docs/vision-scarville.md)
- Plan : [`docs/plan.md`](docs/plan.md)
- Choix provisoires : [`CHOIX-PROVISOIRES.md`](CHOIX-PROVISOIRES.md)

## Comment ça marche

```
iPhone (app web installée) ──HTTPS + SSE──▶ Caddy ──▶ weevilsd (VPS, port 4179)
                                                         ├─ transcripts Claude Code / Codex du VPS
                                                         ├─ hooks Claude Code (état exact, port local 4180)
                                                         ├─ sessions tmux « wv-* » : écrire, lire l'écran, touches
                                                         ├─ conversations importées (SQLite) + classement
                                                         └─ weevilsd du PC, via tunnel SSH inversé (127.0.0.1:4192)
```

- **weevilsd** (`server/`, Node 22+, aucune dépendance) lit les transcripts, reçoit les hooks, pilote tmux, importe et range les conversations, sert l'app.
- **wv** lance claude ou codex dans une session tmux que weevils voit et pilote : `wv`, `wv "message"`, `wv codex`, `wv ls`, `wv a`.
- **Classement** : dossier → repo → projet (familles `lws-*`, `mygame-*`…) pour les sessions ; pour les conversations, règles puis `codex exec` éphémère sur l'abonnement, avec tes corrections en exemples. Il invente une catégorie quand rien ne colle.

## Installer

```sh
# VPS (~/projects/weevils)
npm install && npm run build
bash server/install.sh          # wv, hooks Claude Code, service weevilsd
expose weevils 4179             # → https://weevils.scarville.tech

# PC (~/projects/weevils) : relais léger, sans build ni dépendance
bash server/install.sh pc       # weevilsd du PC + tunnel SSH vers le VPS
```

Code d'accès : `ssh vps cat ~/.config/weevils/secret`. Lien de connexion en QR code :
`ssh vps 'qrencode -t ansiutf8 "https://weevils.scarville.tech/#k=$(cat ~/.config/weevils/secret)"'`.

Dev : `npm run dev:public` (port 4178, HMR) avec weevilsd qui tourne. Tests : `npm test`. Vérif 375 / 390 / 430 px : `/phones.html`.
