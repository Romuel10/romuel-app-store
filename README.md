# Romuel Apps v12.4 — correction liste des comptes Admin

Cette version corrige l'affichage de `Admin > Accès Gendarmerie`.

Améliorations :
- lecture robuste de `admin_list_users()`;
- affichage du nom + e-mail;
- statut clair : Public / Gendarme / Admin;
- bouton Autoriser Gendarmerie / Retirer accès;
- bouton Actualiser;
- message d'erreur visible si Supabase refuse la requête.

Aucun nouveau SQL n'est nécessaire si `admin_list_users()` et `set_user_access()` existent déjà.
