# Weevils

Weevils (nom du produit) : le harness personnel de Scarville — piloter ses agents (Claude, Codex) et ses projets depuis le téléphone.

Point de départ : [`harness-interface-kit/`](harness-interface-kit/README.md), le kit de lancement (brief, direction visuelle, références, données de démo). Pour lancer l'agent constructeur, voir [`harness-interface-kit/LANCER.txt`](harness-interface-kit/LANCER.txt).

Les précisions de Scarville qui priment sur le kit : [`docs/vision-scarville.md`](docs/vision-scarville.md).

## Lancer le prototype

Sur le VPS (`~/projects/weevils`) :

```sh
npm install
npm run dev:public            # serveur sur 127.0.0.1:4178, HMR à travers Caddy
expose weevils 4178           # → https://weevils.scarville.tech
```

En local sans domaine : `npm run dev`. Tests de la logique : `npm test`. Vérifier 375 / 390 / 430 px sur ordinateur : `/phones.html`.

Sur iPhone : ouvrir https://weevils.scarville.tech dans Safari → Partager → « Sur l'écran d'accueil ».

Choix provisoires : [`CHOIX-PROVISOIRES.md`](CHOIX-PROVISOIRES.md).
