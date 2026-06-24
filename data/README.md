# Jeux de données

Les sessions de **test réelles** sont désormais enregistrées et consultées
directement dans l'application :

- elles sont persistées localement par `SessionStore` (base `localStorage`) ;
- elles se consultent dans **`session-viewer.html`** (tableau + heatmap + scanpath) ;
- chaque session produit aussi **un fichier JSON téléchargé** (un par personne) ;
- la base complète s'exporte/importe en un fichier depuis le viewer.

Ce dossier accueille les fichiers JSON exportés que l'on souhaite archiver dans le
dépôt (ex. les sessions des participants du protocole T5).

> Les anciens jeux de données simulés (`SIM-*`) ont été retirés : le projet
> collecte maintenant de vraies sessions via `test-session.html`.
