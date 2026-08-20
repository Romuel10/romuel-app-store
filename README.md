# Romuel Apps v8 — import réel de photo de profil

Cette version corrige l'erreur `permission denied for table profiles` et remplace l'URL de photo par un vrai sélecteur de fichier.

## Nouvelles fonctions
- choisir une photo depuis le téléphone
- aperçu avant enregistrement
- PNG / JPG / WebP
- taille maximale : 5 Mo
- upload dans Supabase Storage
- suppression de la photo
- nom de profil enregistré sans erreur de permission
- toutes les fonctions v7 conservées

## Réglage Supabase requis

Exécuter une seule fois le SQL fourni dans la conversation pour :
1. autoriser `updated_at` si nécessaire ;
2. créer le bucket public `avatars` ;
3. créer les politiques Storage pour que chaque utilisateur gère uniquement son propre dossier.
