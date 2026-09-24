# Mada Apps V15 — mise à jour

Cette archive améliore le projet original, elle ne repart pas de zéro.

## Supabase — une seule opération

1. Ouvre Supabase > SQL Editor > New query.
2. Copie **tout** le fichier `SUPABASE_SETUP_COMPLETE_V15.sql`.
3. Clique sur **Run**.
4. N'exécute pas les fichiers du dossier `_legacy_sql` : ils sont gardés uniquement comme historique.

Le script V15 conserve les données existantes et prépare :
- rôles USER / DEVELOPER / GENDARMERIE / ADMIN ;
- Console développeur ;
- validation admin des nouvelles applications et versions ;
- accès Gendarmerie protégé par RLS ;
- buckets privés APK, logos et captures ;
- profils, avis, favoris, signalements et statistiques de téléchargement ;
- renvoi d'e-mail de confirmation.

## Déploiement

Après le SQL :
1. Remplace le contenu du dépôt GitHub par cette version.
2. Commit + push sur `main`.
3. Cloudflare Pages redéploiera le site.
4. Recharge le site avec Ctrl+F5.

## Attribuer les rôles

Connecte-toi avec ton compte admin puis ouvre **Admin > Accès Gendarmerie / utilisateurs**.
Tu peux :
- rendre un compte Développeur ;
- autoriser/retirer l'accès Gendarmerie.

Un développeur verra ensuite le bouton **Développeur** dans le Store et pourra soumettre une application. L'admin devra la valider avant publication.
