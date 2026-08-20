# Romuel Apps — version automatique

Cette version n'utilise plus `apps.js`.

Le site lit automatiquement les Releases publiques du dépôt :

`Romuel10/romuel-apps-releases-`

## Ajouter une nouvelle application

1. Ouvrir le dépôt `romuel-apps-releases-`.
2. Créer une nouvelle Release.
3. Utiliser un titre de la forme :
   `Nom de l'application v1.0.0`
4. Ajouter une courte description.
5. Joindre :
   - un fichier `.apk`
   - un logo `.png`, `.jpg`, `.jpeg` ou `.webp`
6. Publier la Release.

Le site affichera automatiquement la version la plus récente de chaque application.

## Mettre une application à jour

Créer une nouvelle Release avec le même nom d'application et une version plus récente.

Exemple :
- `SPA Effectifs v3.11.9`
- puis `SPA Effectifs v3.12.0`

Le site gardera automatiquement la Release la plus récente.

## Fichiers du site

- `index.html`
- `style.css`
- `script.js`
- `README.md`

Il n'y a plus de fichier `apps.js` à modifier.
