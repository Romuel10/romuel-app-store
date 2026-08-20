# Romuel Apps — automatique v2

Dépose ces fichiers à la racine de `romuel-app-store`.

Le site lit les Releases publiques de `Romuel10/romuel-apps-releases-`.

Pour chaque application :
- titre de Release : `Nom application v1.0.0`
- joindre un `.apk`
- joindre un logo `.png`, `.jpg`, `.jpeg` ou `.webp`
- publier

Pour une mise à jour, créer une nouvelle Release avec le même nom et une version plus récente.

Cette v2 ajoute :
- anti-cache sur `style.css` et `script.js`
- délai maximal de chargement
- message d'erreur clair
- téléchargement basé directement sur l'URL d'asset renvoyée par l'API GitHub
