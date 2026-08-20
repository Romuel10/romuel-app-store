# Romuel Apps

Mini plateforme web pour publier et distribuer tes applications Android.

## Modifier les applications

Ouvre `apps.js` puis modifie le tableau `apps`.

Pour chaque application :
- `name` : nom
- `version` : version
- `updated` : date
- `category` : catégorie
- `description` : description
- `tags` : mots-clés
- `changes` : nouveautés
- `downloadUrl` : lien direct de l'APK
- `icon` : chemin vers une image, par exemple `assets/mon-logo.png`

## Publication avec GitHub Pages

1. Crée un dépôt GitHub, par exemple `romuel-apps`.
2. Envoie tous les fichiers de ce dossier dans le dépôt.
3. Va dans `Settings` > `Pages`.
4. Choisis `Deploy from a branch`.
5. Sélectionne la branche `main` et le dossier `/root`.
6. Enregistre.

## APK avec GitHub Releases

Dans ton dépôt d'application :
1. Va dans `Releases`.
2. Crée une nouvelle release.
3. Ajoute ton fichier `.apk`.
4. Copie le lien du fichier APK.
5. Colle ce lien dans `downloadUrl` dans `apps.js`.
