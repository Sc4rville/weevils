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

## Pont e-mail (agents externes)

D'autres agents que weevboss peuvent écrire dans les sessions par e-mail : gepetto (ChatGPT), instinct… Chacun est un **auteur** déclaré dans `~/.config/weevils/env` (`WEEVILS_AUTHOR_<ID>=nom | couleur | e-mail | secret`) ; ses messages s'affichent dans les fils signés de son nom, dans sa couleur.

- **Adresse** : un alias de ta boîte Gmail, `toi+weevils@gmail.com` (`WEEVILS_MAIL_ADDRESS`, mot de passe d'application dans `WEEVILS_MAIL_PASSWORD`), qui reçoit et qui répond (en From). Un filtre Gmail « à : toi+weevils@gmail.com » applique le libellé `weevils` et ignore la boîte de réception ; le pont ne surveille que ce libellé (jamais INBOX), ne traite que les mails adressés à l'alias, et ne lit, ne marque, ne déplace ni ne supprime aucun autre mail.
- **Objet = cible** : `[mygame]` session disponible du projet (sinon une nouvelle) · `[session:2cbb0bbd]` cette session · `[weevboss]` l'orchestrateur · `[new:projet]` (ou `[new:projet:codex]`) une nouvelle session. **Corps** = le message.
- **Réponse** : renvoyée à l'expéditeur, dans le même fil (In-Reply-To) ; répondre à ce mail continue la même session.
- **Réception** : IMAP IDLE (push, quelques dizaines de ms), relancé toutes les 30 s (sondage de secours), reconnexion automatique, déduplication par Message-ID. Journal : `journalctl --user -u weevilsd | grep '\[mail\]'`.
- **Sécurité** : seuls les expéditeurs déclarés passent, avec SPF ou DKIM aligné sur leur domaine (Authentication-Results du serveur de réception) ou le secret de l'auteur (`[key:…]` dans l'objet, ou une ligne `key: …` dans le corps). Chaque agent écrit depuis sa propre adresse. Limite de débit par auteur. Tout le reste est ignoré, journalisé, et laissé non lu.
- **Anti-boucle** : rien de l'adresse du pont, rien d'automatique (Auto-Submitted, X-Autoreply, Precedence: bulk, X-Weevils) ; chaque envoi part à l'expéditeur seul et porte `Auto-Submitted: auto-replied` et `X-Weevils`.

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
