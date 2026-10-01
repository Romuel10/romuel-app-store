# Cloudflare R2 — Mada Apps

Mada Apps V15.9 utilise une architecture hybride :

- **Supabase** : Auth, PostgreSQL, droits, métadonnées, notifications.
- **Cloudflare R2** : APK, logos et captures pour les nouvelles publications dès que R2 est configuré.
- **Supabase Storage** : secours automatique et compatibilité avec tous les fichiers historiques.

## 1. Créer le bucket R2

Créer un bucket privé, par exemple :

`mada-apps-storage`

Le bucket n'a pas besoin d'être public. Mada Apps utilise des URL temporaires signées.

## 2. Créer des identifiants S3 R2

Créer un token R2 limité au bucket avec lecture/écriture.

Ne jamais mettre ces valeurs dans GitHub ou dans le JavaScript public.

## 3. Configurer CORS

Importer le fichier `r2-cors.json` dans les paramètres CORS du bucket.

Les origines autorisées doivent correspondre aux domaines réellement utilisés par Mada Apps.

## 4. Ajouter les secrets dans Supabase

Dans **Supabase > Edge Functions > Secrets**, ajouter :

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

Exemple de valeur pour `R2_BUCKET_NAME` :

`mada-apps-storage`

La fonction Edge `r2-storage` détecte automatiquement ces secrets.

## 5. Activation automatique

Aucun changement dans le navigateur n'est nécessaire après l'ajout des secrets.

Le comportement devient :

1. nouvelle publication → tentative R2 ;
2. si R2 est opérationnel → fichier stocké dans R2 ;
3. si R2 est momentanément indisponible et que le fichier fait au plus 500 Mo → secours Supabase Storage ;
4. les fichiers historiques continuent d'être lus depuis Supabase ;
5. la base mémorise le fournisseur de chaque fichier.

## Sécurité

Les clés R2 restent exclusivement dans les secrets de la fonction Edge.

Le navigateur reçoit uniquement des URL temporaires signées :

- PUT pour les uploads ;
- GET pour les téléchargements.

Les APK publics peuvent être téléchargés sans connexion. Les fichiers privés Gendarmerie restent soumis aux contrôles d'accès Mada Apps.

## Gros fichiers

À partir d'environ **100 Mo**, Mada Apps bascule automatiquement sur l'upload multipart R2.

Le fichier est découpé en blocs. Si un bloc échoue, ce bloc est réessayé sans recommencer tout le fichier.

R2 permet jusqu'à 10 000 parties et des objets allant jusqu'à environ 5 TiB. Le multipart est donc adapté aux très gros APK, archives et futurs contenus lourds.

## Migration des anciens fichiers

La migration est volontairement progressive :

- aucun ancien APK n'est supprimé ;
- tous les anciens enregistrements sont marqués `supabase` par défaut ;
- les nouvelles publications basculent vers `r2` dès son activation.

Cela évite toute interruption du Store.
