# Romuel Apps v13.4 — publication directe depuis la plateforme

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
- maintien temporaire des anciennes applications GitHub et `private_apps` pendant la migration.

## Activation dans Supabase

1. Ouvrir **Supabase > SQL Editor > New query**.
2. Copier tout le contenu de `supabase-v13-publisher.sql`.
3. Exécuter le script une seule fois.
4. Actualiser Romuel Apps, se connecter avec le compte administrateur, puis ouvrir **Admin**.

Le script crée les tables `applications`, `app_versions` et `app_screenshots`, ainsi que trois buckets privés. Les politiques RLS garantissent qu'un APK Gendarmerie n'est lisible et téléchargeable que par un administrateur ou un compte dont `access_level = 'gendarme'`.

Si une publication v13.3 a envoyé ses captures sans créer leurs lignes en base, exécuter aussi `supabase-v13.4-repair.sql`. Les captures existantes seront rattachées automatiquement à l'application.

## Migration des anciennes applications GitHub

Dans le Centre de publication, la rubrique **Anciennes publications GitHub** propose le bouton **Recréer ici**. Les informations sont préremplies ; il reste à choisir l'APK, le logo et les captures. Dès qu'une application Supabase utilise le même identifiant, elle remplace automatiquement son ancienne publication GitHub dans le catalogue.
