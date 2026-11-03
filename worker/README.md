# Relais personnel (facultatif, gratuit)

Sans relais, Onde fonctionne déjà : lecture, titres des serveurs ouverts (Icecast avec CORS, Radio France…), conversion automatique des flux HTTP en HTTPS quand le serveur le permet.

Le relais sert à deux cas que Safari bloque :

1. **Titres des serveurs fermés au CORS** : le relais lit les métadonnées ICY côté serveur.
2. **Flux uniquement en HTTP** : le relais les sert en HTTPS.

## Déploiement (5 minutes, offre gratuite Cloudflare)

1. Créez un compte gratuit sur <https://dash.cloudflare.com> (aucune carte demandée).
2. *Workers & Pages* → *Create* → *Create Worker* → nommez-le `onde-relais` → *Deploy*.
3. *Edit code* : remplacez tout par le contenu de `relay.js`, puis *Deploy*.
4. Dans Onde : *Réglages* → *Relais personnel* → collez `https://onde-relais.<votre-sous-domaine>.workers.dev` → *Valider*.
5. Facultatif : activez « Lire aussi les flux HTTP via le relais ».

Pour réserver le relais à votre app, remplacez `ALLOWED_ORIGIN = '*'` par l'adresse de votre app.

## Limites honnêtes

- Offre gratuite : 100 000 requêtes par jour, largement suffisant pour un usage personnel.
- Cloudflare n'autorise que certains ports sortants (80, 443, 8080, 8880, 2052, 2082, 2086, 2095…). Un flux sur le port 8000 ne passera pas par ce relais. Pour ces flux, un petit relais sur votre Raspberry Pi (derrière Caddy, en HTTPS) ferait le même travail.
