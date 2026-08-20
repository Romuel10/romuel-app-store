# Romuel Apps v9 — pages partageables, captures, dashboard admin et statistiques

## Nouvelles fonctions

### 1. Fiches d’application partageables
Chaque application possède maintenant une URL dédiée, par exemple :

`https://romuelapps.pages.dev/?app=spa-effectifs`

Le bouton **Partager** envoie directement ce lien.

### 2. Captures d’écran
Dans une Release GitHub :
- l’image dont le nom contient `logo` ou `icon` devient l’icône ;
- les autres PNG/JPG/WebP deviennent automatiquement les captures d’écran.

Exemple :
- `spa-effectifs-logo.png`
- `screenshot-1.png`
- `screenshot-2.png`

### 3. Tableau de bord administrateur
Le bouton **Admin** affiche :
- nombre d’applications ;
- téléchargements GitHub cumulés ;
- clics aujourd’hui ;
- clics sur 7 jours ;
- nombre d’avis ;
- nombre d’utilisateurs ;
- statistiques par application ;
- signalements à modérer.

### 4. Statistiques de téléchargement
Les téléchargements GitHub restent visibles.
Romuel Apps enregistre aussi les clics de téléchargement dans Supabase pour donner des statistiques par jour/semaine à l’administrateur.

## Supabase
Exécuter une seule fois le fichier `supabase-v9.sql` avant d’utiliser les nouvelles statistiques.
