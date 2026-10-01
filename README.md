# Mada Apps V15.1 — Store Android sécurisé pour Madagascar

Mada Apps est un catalogue indépendant d’applications Android pour Madagascar. La version 14 adopte une navigation et des fiches inspirées des grands stores, tout en conservant une identité propre.

L'administrateur peut maintenant gérer les applications depuis **Admin > Centre de publication**, sans créer une Release GitHub.

## Fonctions ajoutées

- création d'une application publique ou réservée à la Gendarmerie ;
- dépôt direct de l'APK, du logo et de plusieurs captures dans Supabase Storage ;
- brouillon, publication et masquage réversible ;
- modification du nom, de la catégorie, de la description et du niveau d'accès ;
- ajout de nouvelles versions avec notes de mise à jour et historique ;
- suppression individuelle des anciennes captures ;
- envoi repris automatiquement pour les APK volumineux ;
- vérification réelle de l'APK dans Storage avant de valider une publication ;
- récupération automatique des captures déjà envoyées si leurs métadonnées manquent ;
- remplacement possible d'un APK en renvoyant le même numéro de version ;
- affichage automatique de la taille des APK publiés dans les cartes, les fiches, les versions et l’administration ;
- nouvelle interface claire, responsive et optimisée pour le téléphone ;
- bouton **Installer**, rangées horizontales, statistiques de fiche et navigation mobile inférieure ;
- maintien temporaire des anciennes applications GitHub et `private_apps` pendant la migration.

## Activation dans Supabase

1. Ouvrir **Supabase > SQL Editor > New query**.
2. Copier tout le contenu de `supabase-v13-publisher.sql`.
3. Exécuter le script une seule fois.
4. Actualiser Mada Apps, se connecter avec le compte administrateur, puis ouvrir **Admin**.

Le script crée les tables `applications`, `app_versions` et `app_screenshots`, ainsi que trois buckets privés. Les politiques RLS garantissent qu'un APK Gendarmerie n'est lisible et téléchargeable que par un administrateur ou un compte dont `access_level = 'gendarme'`.

La taille d’un APK est lue automatiquement depuis GitHub Releases ou Supabase Storage : aucune saisie manuelle et aucune nouvelle colonne SQL ne sont nécessaires.

Si une publication v13.3 a envoyé ses captures sans créer leurs lignes en base, exécuter aussi `supabase-v13.4-repair.sql`. Les captures existantes seront rattachées automatiquement à l'application.

## Migration des anciennes applications GitHub

Dans le Centre de publication, la rubrique **Anciennes publications GitHub** propose le bouton **Recréer ici**. Les informations sont préremplies ; il reste à choisir l'APK, le logo et les captures. Dès qu'une application Supabase utilise le même identifiant, elle remplace automatiquement son ancienne publication GitHub dans le catalogue.


## V15.1 — rôles, Console développeur et durcissement sécurité

Cette version ajoute une vraie Console développeur, une file de validation admin et un espace Gendarmerie dédié. Pour mettre Supabase au même niveau que le code, exécuter **uniquement** `SUPABASE_SETUP_COMPLETE_V15.sql` dans SQL Editor. Le script est conçu comme migration idempotente et conserve les applications existantes.


### Sécurité V15.1

La V15.1 consolide la sécurité sans repartir de zéro :

- politiques RLS du Store nettoyées et dédupliquées ;
- tables héritées `developers`, `app_submissions`, `notifications` et `downloads` verrouillées ;
- fonctions privilégiées déplacées derrière des implémentations privées ;
- accès Gendarmerie maintenu côté base et Storage ;
- un développeur peut envoyer un nouvel APK, mais ne peut plus écraser un APK déjà validé ;
- nettoyage des fichiers orphelins après un échec d'envoi ;
- modération des avis uniformisée sur `published / hidden / pending` ;
- dépendances navigateur figées à des versions précises ;
- en-têtes de sécurité Cloudflare et workflow GitHub de tests de sécurité ajoutés.

Pour une installation ou remise à niveau, exécuter **`SUPABASE_SETUP_COMPLETE_V15.sql`**. Les fichiers `SUPABASE_SECURITY_CLEANUP_V15_1.sql` et `SUPABASE_RPC_HARDENING_V15_1_1.sql` restent disponibles comme migrations séparées et traçables.

> Supabase peut encore recommander **Leaked Password Protection** dans Auth. Ce réglage est un paramètre de projet Supabase et doit être activé dans les réglages Auth lorsque le plan utilisé le permet.


## Stockage hybride V15.9

Mada Apps peut utiliser **Cloudflare R2** pour les APK, logos et captures, tout en conservant Supabase pour l'authentification, la base et les permissions. Les fichiers historiques Supabase restent compatibles. Voir `R2_SETUP.md`.
