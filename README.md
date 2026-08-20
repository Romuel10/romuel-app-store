# Romuel Apps v12.2 — correction profil / comptes

Cette version corrige deux bugs importants de la v12.1 :

- correction JavaScript de `refreshAuthUI` : la fonction utilise maintenant correctement `await` ;
- chargement de `access_level` dans le profil, afin qu'un compte autorisé Gendarmerie soit réellement reconnu comme Gendarme après connexion.

Amélioration :
- l'e-mail de chaque utilisateur apparaît maintenant dans Admin > Accès Gendarmerie pour identifier facilement les comptes.

La modification du nom et de la photo de profil reste compatible avec les réglages Supabase déjà effectués.

Aucun nouveau SQL n'est nécessaire si le SQL v12.1 a déjà été exécuté.
