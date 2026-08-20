# Romuel Apps v7 — profils, favoris synchronisés et modération

## Nouvelles fonctions
- profil utilisateur : nom affiché + avatar URL
- favoris synchronisés avec Supabase pour les utilisateurs connectés
- favoris locaux conservés pour les visiteurs non connectés
- bouton Signaler sur les avis des autres utilisateurs
- espace Modération visible uniquement si `profiles.is_admin = true`
- administrateur : rejeter un signalement, masquer un avis ou supprimer un avis
- toutes les fonctions v6 conservées : téléchargements, tri, captures, notes, commentaires

## Important
La table `profiles`, `favorites`, `review_reports` et les politiques RLS doivent avoir été créées avec le SQL v7 fourni auparavant.

Le compte administrateur doit avoir :
`profiles.is_admin = true`
