# Relais personnel d'Onde

Le relais est un petit programme Python, sans dépendance, qui fait trois choses que Safari interdit à une app web :

| Route | Rôle |
|---|---|
| `POST /shazam` | transmet l'empreinte audio calculée par Onde au serveur de Shazam (**reconnaissance musicale**) |
| `GET /meta?url=…` | lit les titres ICY des radios qui ne les partagent pas avec les navigateurs |
| `GET /stream?url=…` | sert en HTTPS, avec CORS, les flux HTTP ou fermés (lecture et capture pour Shazam) |

L'empreinte est calculée sur l'iPhone. Le relais ne reçoit que cette empreinte (quelques Ko), jamais l'audio de votre micro, et ne stocke rien.

## Installation sur le Raspberry Pi (recommandé)

Depuis le Mac, dans le dossier `onde` :

```bash
bash relay/installer-sur-pi.sh
```

Le script installe un service qui redémarre tout seul, ajoute une route secrète `/onde/<secret>/` à Caddy (avec une sauvegarde `Caddyfile.avant-onde.*`), puis affiche l'adresse à coller dans **Onde → Réglages → Relais personnel**.

## Variante Cloudflare Workers

`worker/relay.js` offre les mêmes routes (voir `worker/README.md`). Cloudflare n'autorise pas les flux sur des ports exotiques (8000…), ce que le relais du Pi gère.

## À savoir

La reconnaissance utilise le service de Shazam de façon **non officielle** : il n'est pas documenté et peut cesser de fonctionner sans préavis, ou ne plus répondre s'il est trop sollicité. Onde limite donc l'identification automatique : une requête par morceau en temps normal, et des essais de plus en plus espacés (jusqu'à 3 min) quand rien n'est reconnu.
