# Romuel Apps v5 — comptes, notes et commentaires

Cette version connecte Romuel Apps à Supabase.

Fonctions :
- créer un compte par e-mail / mot de passe
- se connecter / se déconnecter
- donner 1 à 5 étoiles
- publier un commentaire
- modifier son avis en le republiant
- supprimer son propre avis
- afficher la moyenne et le nombre d'avis
- conserver GitHub Releases pour les APK

## Important dans Supabase
Dans Authentication > URL Configuration :
- Site URL : `https://romuelapps.pages.dev`
- Redirect URLs : ajoute `https://romuelapps.pages.dev/**`

Cela permet aux e-mails de confirmation de revenir vers le bon site.
