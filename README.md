# Weevils

Weevils : un poste de pilotage pour agents de code. Depuis le téléphone, voir et piloter ses sessions Claude Code et Codex sur une ou plusieurs machines, ses conversations ChatGPT et Claude.ai, et ses jobs longs, le tout rangé par projet.

- Vision et règles de design : [`docs/vision.md`](docs/vision.md)
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
- **Classement** : dossier → repo → projet (familles `lws-*`, `mygame-*`…) pour les sessions ; pour les conversations, règles puis `codex exec` éphémère sur l'abonnement, avec tes corrections en exemples. Rien de sûr : c'est toi qui ranges.

## Installer

## Configurer

Un seul fichier, hors du repo : copie [`weevils.env.example`](weevils.env.example) en `~/.config/weevils/env` et remplis-le (prénom, adresse publique, domaine de preview, clés). Le service le relit à chaque redémarrage.

```sh
# Machine principale (~/projects/weevils)
npm install && npm run build
bash server/install.sh          # wv, hooks Claude Code, service weevilsd
# puis expose le port 4179 en HTTPS (Caddy, nginx…) sur WEEVILS_PUBLIC_URL

# Machine secondaire : relais léger, sans build ni dépendance
bash server/install.sh pc       # weevilsd local + tunnel SSH vers la machine principale
```

Code d'accès : `cat ~/.config/weevils/secret`. Lien de connexion en QR code :
`qrencode -t ansiutf8 "$WEEVILS_PUBLIC_URL/#k=$(cat ~/.config/weevils/secret)"`.

Dev : `npm run dev:public` (port 4178, HMR) avec weevilsd qui tourne. Tests : `npm test`. Vérif 375 / 390 / 430 px : `/phones.html`.
