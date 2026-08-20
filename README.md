# Romuel Apps v12.3 — correction interface non cliquable

Cette version corrige un blocage provoqué par la gestion de session Supabase.

Cause :
- le callback `onAuthStateChange` lançait directement d'autres requêtes Supabase ;
- cela peut bloquer la gestion d'authentification et rendre l'interface inerte selon le navigateur.

Correction :
- les requêtes profil/favoris sont maintenant lancées après le callback Auth ;
- les erreurs Supabase n'empêchent plus le reste de l'interface de fonctionner ;
- les modales cachées ne peuvent plus intercepter les clics.

Aucun nouveau SQL n'est nécessaire.
