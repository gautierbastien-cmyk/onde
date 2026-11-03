# Onde — radio Internet pour iPhone

Application web installable (PWA) pour écouter vos radios Internet depuis l'écran d'accueil de l'iPhone. Usage personnel, entièrement gratuite : aucun compte, aucun serveur payant, aucune donnée envoyée ailleurs.

## Installer sur l'iPhone

1. Ouvrez l'adresse de l'app dans **Safari**.
2. Touchez **Partager** (carré avec une flèche).
3. Choisissez **« Sur l'écran d'accueil »**. Sur iOS 26, laissez « Ouvrir en tant qu'app web » activé.
4. Touchez **Ajouter**, puis lancez **Onde** depuis son icône.

Au premier lancement, la playlist définie dans `src/config.ts` est importée automatiquement. Safari et l'app installée ont des stockages séparés : utilisez l'app installée.

## Fonctionnalités

- Import de playlists **M3U/M3U8** : fichiers (Fichiers, iCloud, AirDrop) ou adresse web actualisable. Les doublons, entrées invalides et flux vidéo/TV sont écartés, avec un rapport détaillé.
- Lecteur **HTMLAudioElement** : MP3, AAC, HLS. Reconnexion automatique, détection de coupure, conversion HTTP → HTTPS, contrôles sur l'écran verrouillé, AirPlay.
- **Titres en direct** : métadonnées ICY lues dans le flux (serveurs ouverts au CORS), ID3 des flux HLS, page d'état Icecast, API Radio France, relais facultatif. Pochettes et albums via l'API publique iTunes, seulement quand l'artiste et le titre correspondent.
- **Shazam intégré** (avec le relais) : bouton « Shazam » dans le lecteur, et identification automatique des stations qui n'annoncent pas leurs titres. L'empreinte audio est calculée sur l'iPhone à partir du flux, sans micro. Service utilisé de façon non officielle : il peut cesser de fonctionner sans préavis.
- **Émission en cours** : guide XMLTV de la playlist (url-tvg) et API Radio France.
- **Historique musical** automatique, avec recherche et suppression. Favoris réordonnables, stations masquables, minuteur de mise en veille, thèmes sombre et clair.
- **Hors ligne** : l'app et la bibliothèque restent consultables sans réseau. Les radios en direct, elles, nécessitent Internet.

## Architecture

```
src/
  core/        types, IndexedDB, store
  services/
    m3u/          parser, classement audio/vidéo, vérification réseau, import
    player/       RadioPlayer (moteur de lecture, indépendant de l'interface)
    metadata/     MetadataService + sources (ICY, ID3 HLS, Icecast, Radio France, relais)
    recognition/  MusicRecognitionService + moteurs (métadonnées aujourd'hui)
    artwork/      pochettes iTunes, couleurs dominantes
  app/         état global, navigation, sélecteurs
  ui/          composants, écrans, feuilles
  design/      design system (jetons, composants, écrans)
  i18n/        textes (français, extensible)
sw/sw.js       Service Worker (généré à la compilation)
relay/         relais pour le Raspberry Pi (Shazam, titres, flux HTTP) + installeur
worker/        variante Cloudflare du relais
```

### Reconnaissance musicale (type Shazam)

`MusicRecognitionService` reçoit les résultats de n'importe quel moteur (`RecognitionEngine`) et les enregistre dans le même historique. Deux moteurs : les métadonnées des radios, et Shazam (`services/recognition/shazam/` : capture du flux en 16 kHz, empreinte au format Shazam portée de SongRec, requête via le relais). ShazamKit, l'API officielle, n'est utilisable que dans une app native iOS.

## Limites d'iOS

- **Arrière-plan** : la lecture continue écran verrouillé. iOS peut ralentir le JavaScript, et les titres sont alors mis à jour moins souvent.
- **Volume** : il n'est pas réglable par une page web. Utilisez les boutons de l'iPhone.
- **Visualisation audio** : non proposée. Elle exigerait la Web Audio API, qui rend muets les flux sans CORS et casse la lecture en arrière-plan.
- **Flux HTTP** : Safari les bloque. Onde tente automatiquement la version HTTPS ; sinon, passez par le relais (`worker/README.md`).

## Développement

```bash
npm install
npm run dev      # serveur local
npm test         # tests (parser, classement, ICY…)
npm run build    # version de production dans dist/
npm run icons    # régénère icônes et écrans de lancement
```

Chaque `git push` sur `main` compile et publie l'app sur GitHub Pages (`.github/workflows/deploy.yml`).
