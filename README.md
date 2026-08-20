# Romuel Apps v12 — espace privé Gendarmerie

## Principe
Les applications publiques continuent d'être publiées via GitHub Releases.

Les applications réservées Gendarmerie ne sont plus publiées sur GitHub public :
- métadonnées dans Supabase
- APK dans un bucket Supabase **privé**
- téléchargement via URL signée temporaire
- l'onglet Gendarmerie n'apparaît que pour `gendarme` ou `admin`

## Admin
Le tableau de bord permet maintenant :
- d'autoriser / retirer l'accès Gendarmerie à un utilisateur
- de publier une application privée (APK + logo)
- de conserver la modération existante

## Important
Exécute `supabase-v12.sql` une seule fois avant d'utiliser la v12.
