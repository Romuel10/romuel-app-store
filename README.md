# Romuel Apps v11.1 — correction du bouton Détails

Cette version corrige le bouton **Détails** sur l'accueil, le catalogue et les cartes responsive.

## Correction technique
Les boutons utilisent maintenant directement l'identifiant unique de l'application (`data-app-id`) au lieu d'un index dans la liste.

Cela évite les erreurs quand :
- la liste est filtrée ;
- les favoris sont affichés ;
- l'ordre change ;
- une section comme Nouveautés/Populaires/Mieux notées est utilisée.

Aucune modification Supabase n'est nécessaire.
