# PIR_WebGaze_ActivityTracker — User Stories

---

## DEV 1

---

### US-1.1 — Calibration WebGazer (Début)

**En tant que** développeur du système de suivi du regard,
**je veux** un module de calibration interactif avec WebGazer.js,
**afin que** le système puisse mapper précisément les coordonnées du regard de chaque utilisateur.

#### Ce qu'il faut faire

1. Créer une page de calibration plein écran avec une grille de points cliquables (minimum 9 points, idéalement 13).
2. Chaque point doit être cliqué N fois (ex. 5 clics) avant de passer au suivant, avec un feedback visuel (changement de couleur, compteur).
3. Implémenter un écran de validation post-calibration : afficher 5 points de test, mesurer l'écart entre le regard estimé et la position réelle du point.
4. Calculer un **score de précision** (erreur moyenne en pixels + écart-type).
5. Si le score est en dessous d'un seuil défini → proposer de recalibrer.
6. Stocker les données de calibration dans le localStorage ou en mémoire pour la session en cours.

#### Critères de validation

- [ ] La grille de calibration s'affiche correctement en plein écran sur Chrome et Firefox.
- [ ] Chaque point nécessite bien N clics avant de passer au suivant.
- [ ] Le feedback visuel (couleur / animation) fonctionne à chaque clic.
- [ ] L'écran de validation s'affiche après la calibration et montre 5 points de test.
- [ ] Le score de précision est calculé et affiché (erreur moyenne en px).
- [ ] Si l'erreur moyenne dépasse le seuil (ex. >150px), un bouton "Recalibrer" apparaît.
- [ ] La calibration fonctionne au moins 3 fois de suite sans crash.

#### Comment tester

- Lancer la calibration sur 2 navigateurs différents (Chrome, Firefox).
- Vérifier visuellement que le regard estimé suit approximativement les points de test.
- Mesurer le score de précision sur 3 sessions → vérifier que l'erreur moyenne est cohérente.
- Forcer un mauvais scénario (regarder ailleurs pendant la calibration) → vérifier que le score est mauvais et que la recalibration est proposée.

---

### US-1.2 — Algorithme I-DT : Détection de fixations par dispersion (Milieu)

**En tant que** développeur du post-traitement,
**je veux** un algorithme I-DT (Identification by Dispersion Threshold) qui détecte les fixations dans un flux de données de regard,
**afin d'** identifier les moments où l'utilisateur fixe une zone précise de l'écran.

#### Ce qu'il faut faire

1. Implémenter l'algorithme I-DT avec deux paramètres configurables :
   - **Seuil de dispersion** (en pixels, ex. 100px) : rayon max d'un cluster de points pour être considéré comme une fixation.
   - **Durée minimale** (en ms, ex. 100ms) : temps minimum pour qu'un groupe de points soit une fixation.
2. L'algorithme prend en entrée un tableau de `{x, y, timestamp}` et retourne un tableau de fixations `{x_center, y_center, start_time, end_time, duration, points_count}`.
3. Utiliser une fenêtre glissante : tant que la dispersion (max_x - min_x + max_y - min_y) est sous le seuil, on étend la fenêtre. Quand elle dépasse, on enregistre la fixation si la durée est suffisante.
4. Exposer une fonction pure : `detectFixations(gazeData, dispersionThreshold, minDuration) → fixations[]`.

#### Critères de validation

- [ ] La fonction accepte un tableau de points bruts et retourne un tableau de fixations.
- [ ] Chaque fixation contient : `x_center`, `y_center`, `start_time`, `end_time`, `duration`, `points_count`.
- [ ] Sur des données simulées (points concentrés dans un rayon de 50px pendant 200ms), la fonction détecte bien une fixation.
- [ ] Sur des données simulées (points éparpillés), la fonction ne retourne aucune fixation.
- [ ] Les paramètres `dispersionThreshold` et `minDuration` sont configurables et changent bien le résultat.
- [ ] La fonction tourne en moins de 50ms pour 10 000 points.

#### Comment tester

- **Test unitaire 1 :** Générer 50 points autour de (500, 300) ±30px sur 300ms → doit retourner 1 fixation centrée ~(500, 300).
- **Test unitaire 2 :** Générer 50 points aléatoires sur tout l'écran → doit retourner 0 fixation.
- **Test unitaire 3 :** Générer 2 clusters séparés (un à (200,200) et un à (800,600)) → doit retourner 2 fixations.
- **Test unitaire 4 :** Générer un cluster de 20ms (sous la durée min) → doit retourner 0 fixation.
- **Test de performance :** Générer 10 000 points, mesurer le temps d'exécution.

---

### US-1.3 — Visualisation de démo : Bar Chart (Fin)

**En tant qu'** utilisateur du prototype,
**je veux** un bar chart interactif affiché dans la page de démo,
**afin de** tester le suivi du regard sur une visualisation classique.

#### Ce qu'il faut faire

1. Créer un bar chart avec D3.js affichant un jeu de données simple (ex. ventes par mois, population par pays — 8 à 12 barres).
2. Le chart doit avoir : axes lisibles, labels, titre, couleurs distinctes, tooltip au hover.
3. Intégrer le chart dans la page de démo globale (créée par Dev 3).
4. Définir des **AOI (Areas of Interest)** correspondant à chaque barre et aux axes, pour pouvoir mapper les fixations sur des zones sémantiques.
5. Exporter les coordonnées des AOI au format attendu par le module de log (Dev 3).

#### Critères de validation

- [ ] Le bar chart s'affiche correctement avec au moins 8 barres, axes, titre et légende.
- [ ] Le tooltip fonctionne au hover sur chaque barre.
- [ ] Les AOI sont définies programmatiquement (rectangles englobants de chaque barre + axes).
- [ ] Les AOI sont accessibles via une fonction `getAOIs() → [{id, label, x, y, width, height}]`.
- [ ] Le chart est responsive (s'adapte si la fenêtre change de taille).
- [ ] Le chart est intégré dans la page de démo sans conflit CSS/JS.

#### Comment tester

- Afficher le chart → vérifier visuellement les barres, axes, titre.
- Hover sur chaque barre → vérifier le tooltip.
- Appeler `getAOIs()` dans la console → vérifier que chaque barre a une AOI avec des coordonnées cohérentes.
- Redimensionner la fenêtre → vérifier que le chart s'adapte.

---

### US-1.4 — Tests utilisateurs Dev 1 (Fin)

**En tant que** testeur,
**je veux** faire passer 1 à 2 participants sur le prototype complet,
**afin de** valider la calibration et la qualité des fixations détectées sur le bar chart.

#### Ce qu'il faut faire

1. Recruter 1-2 participants (collègues, amis).
2. Suivre le protocole de test défini par Dev 3.
3. Faire réaliser la calibration + les tâches sur le bar chart.
4. Collecter les logs JSON exportés.
5. Rédiger un mini-compte rendu : score de calibration obtenu, problèmes rencontrés, observations qualitatives.

#### Critères de validation

- [ ] 1-2 participants ont complété le protocole intégralement.
- [ ] Les fichiers JSON de log sont générés et contiennent des données cohérentes.
- [ ] Un compte rendu de 10-15 lignes est rédigé par participant (score calibration, bugs, feedback).

---

## DEV 2

---

### US-2.1 — Capture du flux de regard WebGazer (Début)

**En tant que** développeur du module de capture,
**je veux** un module qui initialise WebGazer.js et fournit un flux continu de coordonnées du regard,
**afin que** les autres modules puissent consommer les données en temps réel.

#### Ce qu'il faut faire

1. Initialiser WebGazer.js au chargement de la page.
2. Gérer la demande de permission webcam avec gestion d'erreur (refus, caméra indisponible, etc.).
3. Afficher un indicateur de statut (webcam active / inactive / erreur).
4. Exposer une API claire :
   - `GazeCapture.start()` → démarre la capture, retourne une Promise.
   - `GazeCapture.stop()` → arrête la capture.
   - `GazeCapture.onGazeData(callback)` → enregistre un callback appelé à chaque point `{x, y, timestamp}`.
   - `GazeCapture.getStatus()` → retourne `'idle' | 'running' | 'error'`.
5. Stocker les points bruts dans un buffer en mémoire (tableau) accessible via `GazeCapture.getRawData()`.
6. Gérer le nettoyage (arrêt webcam, libération ressources) quand on appelle `stop()` ou quand la page se ferme.

#### Critères de validation

- [ ] `GazeCapture.start()` demande la permission webcam et lance WebGazer.
- [ ] Si la webcam est refusée, `getStatus()` retourne `'error'` et un message explicite est affiché.
- [ ] Le callback `onGazeData` est bien appelé avec des objets `{x, y, timestamp}` à chaque frame (~30-60 fois/sec).
- [ ] `x` et `y` sont des nombres positifs correspondant à des coordonnées écran valides.
- [ ] `GazeCapture.stop()` arrête le flux, plus aucun callback n'est déclenché après.
- [ ] `GazeCapture.getRawData()` retourne le tableau complet des points collectés.
- [ ] La webcam s'éteint (LED off) après `stop()` ou fermeture de la page.
- [ ] Le module fonctionne sur Chrome et Firefox.

#### Comment tester

- Appeler `GazeCapture.start()` → vérifier que la LED webcam s'allume.
- Enregistrer un callback qui log les données → vérifier dans la console que les points arrivent (~30/sec).
- Bouger le regard dans les 4 coins de l'écran → vérifier que les coordonnées changent de manière cohérente.
- Appeler `stop()` → vérifier que les callbacks cessent et que la LED s'éteint.
- Refuser la permission webcam → vérifier le message d'erreur.
- Appeler `getRawData()` après 5 secondes de capture → vérifier que le tableau contient ~150-300 points.

---

### US-2.2 — Algorithme I-VT : Détection de saccades par vélocité (Milieu)

**En tant que** développeur du post-traitement,
**je veux** un algorithme I-VT (Identification by Velocity Threshold) qui détecte les saccades dans un flux de données de regard,
**afin d'** identifier les mouvements rapides de l'œil entre deux fixations.

#### Ce qu'il faut faire

1. Implémenter l'algorithme I-VT avec un paramètre configurable :
   - **Seuil de vélocité** (en px/ms, ex. 0.7) : au-dessus de ce seuil, le mouvement est classé comme saccade.
2. Calculer la vélocité entre chaque paire de points consécutifs : `v = distance(p1, p2) / (t2 - t1)`.
3. Regrouper les points consécutifs au-dessus du seuil en saccades.
4. Chaque saccade retournée contient : `{start_x, start_y, end_x, end_y, start_time, end_time, duration, amplitude, peak_velocity}`.
5. Exposer une fonction pure : `detectSaccades(gazeData, velocityThreshold) → saccades[]`.
6. Implémenter le lien fixations ↔ saccades : une fonction `linkEvents(fixations, saccades) → timeline[]` qui retourne une timeline ordonnée alternant fixations et saccades.

#### Critères de validation

- [ ] La fonction accepte un tableau de points bruts et retourne un tableau de saccades.
- [ ] Chaque saccade contient : `start_x`, `start_y`, `end_x`, `end_y`, `start_time`, `end_time`, `duration`, `amplitude`, `peak_velocity`.
- [ ] Sur des données simulées (saut brusque de (100,100) à (800,600) en 30ms), la fonction détecte bien une saccade.
- [ ] Sur des données simulées (points stables), la fonction ne retourne aucune saccade.
- [ ] `linkEvents()` retourne une timeline triée par `start_time` qui alterne fixations et saccades.
- [ ] La fonction tourne en moins de 50ms pour 10 000 points.

#### Comment tester

- **Test unitaire 1 :** Générer des points stables à (400, 300) puis un saut brusque à (800, 600) → doit retourner 1 saccade.
- **Test unitaire 2 :** Générer des points qui bougent lentement → doit retourner 0 saccade.
- **Test unitaire 3 :** Générer un pattern fixation → saccade → fixation → saccade → vérifier que `linkEvents()` retourne 4 événements dans le bon ordre.
- **Test unitaire 4 :** Varier le seuil de vélocité → vérifier que le nombre de saccades détectées change.

---

### US-2.3 — Visualisation de démo : Line Chart (Fin)

**En tant qu'** utilisateur du prototype,
**je veux** un line chart interactif affiché dans la page de démo,
**afin de** tester le suivi du regard sur un deuxième type de visualisation.

#### Ce qu'il faut faire

1. Créer un line chart avec D3.js affichant une ou deux séries temporelles (ex. évolution de température sur 12 mois, cours d'une action).
2. Le chart doit avoir : axes lisibles, grille de fond, légende, tooltip au hover montrant la valeur exacte.
3. Intégrer le chart dans la page de démo globale.
4. Définir des AOI : zones correspondant à chaque segment de la courbe, aux axes, à la légende.
5. Exporter les AOI au même format que le bar chart (Dev 1).

#### Critères de validation

- [ ] Le line chart s'affiche avec au moins 12 points de données, axes, grille et légende.
- [ ] Le tooltip suit la souris et affiche la valeur interpolée.
- [ ] Les AOI sont définies et accessibles via `getAOIs()`.
- [ ] Le chart est responsive.
- [ ] Le chart est intégré dans la page de démo sans conflit avec le bar chart.

#### Comment tester

- Afficher le chart → vérifier visuellement les courbes, axes, légende.
- Hover le long de la courbe → vérifier le tooltip.
- Appeler `getAOIs()` → vérifier la cohérence.
- Afficher bar chart et line chart côte à côte → vérifier qu'il n'y a pas de conflit.

---

### US-2.4 — Tests utilisateurs Dev 2 (Fin)

**En tant que** testeur,
**je veux** faire passer 1 à 2 participants sur le prototype complet,
**afin de** valider la détection des saccades et la qualité du suivi sur le line chart.

#### Ce qu'il faut faire

1. Recruter 1-2 participants.
2. Suivre le protocole de test (Dev 3).
3. Faire réaliser les tâches sur le line chart.
4. Collecter les logs JSON.
5. Vérifier dans les logs que les saccades détectées correspondent à des mouvements visuels réels (ex. passage d'un axe à la courbe).
6. Rédiger un mini-compte rendu.

#### Critères de validation

- [ ] 1-2 participants ont complété le protocole.
- [ ] Les logs contiennent des fixations ET des saccades avec des valeurs cohérentes.
- [ ] Le compte rendu mentionne : nombre de fixations/saccades détectées, cohérence avec le comportement observé, bugs éventuels.

---

## DEV 3

---

### US-3.1 — Format de log JSON + Module d'export (Début)

**En tant que** développeur du système de journalisation,
**je veux** un format structuré de log et un module d'export,
**afin que** toutes les données collectées soient sauvegardées de manière cohérente et exploitable.

#### Ce qu'il faut faire

1. Définir le schéma JSON du log de session :
```json
{
  "session": {
    "id": "uuid",
    "participant_id": "string",
    "start_time": "ISO8601",
    "end_time": "ISO8601",
    "screen_resolution": { "width": 0, "height": 0 },
    "browser": "string",
    "calibration_score": { "mean_error_px": 0, "std_error_px": 0 }
  },
  "raw_gaze_data": [
    { "x": 0, "y": 0, "timestamp": 0 }
  ],
  "events": [
    {
      "type": "fixation | saccade",
      "start_time": 0,
      "end_time": 0,
      "duration": 0,
      "details": {}
    }
  ],
  "aoi_hits": [
    { "aoi_id": "string", "aoi_label": "string", "event_index": 0, "timestamp": 0 }
  ]
}
```
2. Implémenter une classe `GazeLogger` avec :
   - `GazeLogger.init(participantId)` → crée la session.
   - `GazeLogger.logRawPoint(x, y, timestamp)` → ajoute un point brut.
   - `GazeLogger.logEvent(event)` → ajoute une fixation ou saccade.
   - `GazeLogger.logAOIHit(aoiId, aoiLabel, eventIndex)` → ajoute un hit AOI.
   - `GazeLogger.export()` → retourne le JSON complet.
   - `GazeLogger.download()` → déclenche le téléchargement d'un fichier `.json`.
3. Valider le JSON à l'export (vérifier que tous les champs requis sont présents).

#### Critères de validation

- [ ] Le schéma JSON est documenté dans un fichier `LOG_FORMAT.md`.
- [ ] `GazeLogger.init()` crée une session avec un UUID, les métadonnées navigateur et résolution écran.
- [ ] `logRawPoint()` ajoute bien des points au tableau `raw_gaze_data`.
- [ ] `logEvent()` ajoute des événements avec le bon format.
- [ ] `export()` retourne un JSON valide conforme au schéma.
- [ ] `download()` déclenche le téléchargement d'un fichier `session_{id}.json`.
- [ ] Le fichier téléchargé est parsable et conforme au schéma.
- [ ] Le module gère le cas où `export()` est appelé sans données (retourne un JSON vide mais valide).

#### Comment tester

- Appeler `init("test_user")` → vérifier que la session est créée avec un UUID.
- Ajouter 100 points via `logRawPoint()` → vérifier que `export()` contient 100 points.
- Ajouter 3 événements via `logEvent()` → vérifier le tableau `events`.
- Appeler `download()` → ouvrir le fichier téléchargé dans un éditeur JSON → valider la structure.
- Appeler `export()` sans rien avoir logué → vérifier que le JSON est valide mais vide.

---

### US-3.2 — Page de démo globale : Layout et navigation (Début)

**En tant qu'** utilisateur du prototype,
**je veux** une page web de démo avec une navigation claire entre les visualisations,
**afin de** pouvoir passer d'un chart à l'autre pendant les tests.

#### Ce qu'il faut faire

1. Créer la structure HTML/CSS de la page de démo :
   - Header avec titre du projet et statut de la webcam (indicateur vert/rouge).
   - Navigation entre les visualisations (tabs ou sidebar : Bar Chart / Line Chart / Scatter Plot).
   - Zone centrale pour afficher le chart actif.
   - Barre de contrôle en bas : boutons Start/Stop capture, bouton Export, score de calibration affiché.
2. Le layout doit être responsive et fonctionnel sur un écran desktop classique (1920x1080 minimum).
3. Préparer les emplacements (divs avec IDs) où les Dev 1 et Dev 2 intégreront leurs charts.

#### Critères de validation

- [ ] La page s'affiche correctement sur Chrome et Firefox en 1920x1080.
- [ ] La navigation entre les 3 onglets fonctionne (même si les charts ne sont pas encore là, les divs vides s'affichent).
- [ ] Le header affiche le titre et un indicateur de statut webcam (placeholder pour l'instant).
- [ ] La barre de contrôle contient les boutons Start, Stop, Export, Calibrate.
- [ ] Les boutons sont cliquables (même si les actions ne sont pas encore branchées).
- [ ] Le code HTML/CSS est propre, commenté, et les IDs des divs sont documentés pour les Dev 1 et Dev 2.

#### Comment tester

- Ouvrir la page → vérifier le layout visuellement.
- Cliquer sur chaque onglet → vérifier le changement de vue.
- Redimensionner la fenêtre → vérifier que rien ne casse.
- Inspecter le DOM → vérifier que les divs `#bar-chart`, `#line-chart`, `#scatter-chart` existent.

---

### US-3.3 — Intégration des modules + Overlay temps réel (Milieu)

**En tant que** développeur intégrateur,
**je veux** assembler les modules de capture, post-traitement et export dans la page de démo, avec un overlay du regard en temps réel,
**afin que** le système fonctionne de bout en bout.

#### Ce qu'il faut faire

1. Brancher `GazeCapture` (Dev 2) sur le bouton Start/Stop de la page.
2. Brancher le callback `onGazeData` pour :
   - Alimenter le `GazeLogger` en points bruts.
   - Afficher un point/cercle rouge semi-transparent qui suit le regard en temps réel (overlay).
3. Au Stop, lancer le post-traitement :
   - Appeler `detectFixations()` (Dev 1) sur les données brutes.
   - Appeler `detectSaccades()` (Dev 2) sur les données brutes.
   - Appeler `linkEvents()` pour construire la timeline.
   - Logger tous les événements dans `GazeLogger`.
4. Calculer les AOI hits : pour chaque fixation, vérifier si son centre tombe dans une AOI du chart actif.
5. Brancher le bouton Export sur `GazeLogger.download()`.
6. Brancher le bouton Calibrate sur le module de calibration (Dev 1).

#### Critères de validation

- [ ] Cliquer Start → la webcam s'active, le point rouge suit le regard sur l'écran.
- [ ] Cliquer Stop → la webcam s'arrête, le point rouge disparaît, le post-traitement se lance.
- [ ] Après Stop, un message affiche le nombre de fixations et saccades détectées.
- [ ] Cliquer Export → un fichier JSON est téléchargé avec données brutes + événements + AOI hits.
- [ ] Cliquer Calibrate → l'écran de calibration (Dev 1) s'affiche.
- [ ] Le tout fonctionne sur chacun des 3 onglets (bar chart, line chart, scatter plot).
- [ ] Aucune erreur dans la console du navigateur pendant un cycle complet (calibrate → start → navigate → stop → export).

#### Comment tester

- Faire un cycle complet : Calibrate → Start → regarder le bar chart 10 sec → Stop → Export.
- Ouvrir le JSON → vérifier qu'il contient des points bruts, des fixations, des saccades, et des AOI hits.
- Répéter sur chaque onglet.
- Vérifier dans la console qu'il n'y a pas d'erreur JS.

---

### US-3.4 — Troisième visualisation : Scatter Plot ou Heatmap (Milieu)

**En tant qu'** utilisateur du prototype,
**je veux** un scatter plot (ou heatmap) dans la page de démo,
**afin de** tester le suivi du regard sur un troisième type de visualisation.

#### Ce qu'il faut faire

1. Créer un scatter plot avec D3.js affichant un jeu de données à deux dimensions (ex. taille vs poids, revenus vs éducation — 50 à 100 points).
2. Le chart doit avoir : axes, titre, légende de couleur (si catégories), tooltip au hover sur chaque point.
3. Définir des AOI : clusters de points, axes, quadrants.
4. Intégrer dans l'onglet dédié de la page de démo.

#### Critères de validation

- [ ] Le scatter plot affiche 50+ points avec axes, titre et légende.
- [ ] Le tooltip fonctionne au hover sur chaque point.
- [ ] Les AOI sont définies et accessibles via `getAOIs()`.
- [ ] Le chart est intégré dans le 3e onglet sans conflit.
- [ ] Le chart est responsive.

#### Comment tester

- Afficher le scatter plot → vérifier visuellement.
- Hover sur des points → vérifier les tooltips.
- Appeler `getAOIs()` → vérifier la cohérence.
- Naviguer entre les 3 onglets → vérifier qu'il n'y a pas de régression.

---

### US-3.5 — Protocole de test + Tests utilisateurs (Fin)

**En tant que** responsable de l'évaluation,
**je veux** un protocole de test structuré et des résultats de tests avec participants,
**afin de** valider le prototype et documenter ses limitations.

#### Ce qu'il faut faire

1. Rédiger le protocole de test :
   - **Pré-requis :** webcam, navigateur Chrome/Firefox, bonne luminosité.
   - **Étape 1 :** Présentation du projet (1 min).
   - **Étape 2 :** Calibration.
   - **Étape 3 :** Tâches sur chaque visualisation (ex. "Sur le bar chart, quelle catégorie a la plus grande valeur ?", "Sur le line chart, à quel moment la courbe atteint son maximum ?", "Sur le scatter plot, identifiez un outlier.").
   - **Étape 4 :** Export des données.
   - **Étape 5 :** Questionnaire rapide (facilité d'utilisation, gêne de la webcam, etc.).
2. Préparer une grille d'évaluation (tableau) pour noter par participant : score de calibration, nombre de fixations/saccades, bugs rencontrés, feedback qualitatif.
3. Faire passer 1-2 participants.
4. Compiler les résultats dans un tableau.

#### Critères de validation

- [ ] Le protocole est rédigé dans un document `TEST_PROTOCOL.md`.
- [ ] Le protocole contient : pré-requis, étapes numérotées, tâches concrètes par visualisation, questionnaire.
- [ ] La grille d'évaluation est prête (tableau avec colonnes : participant, score calibration, nb fixations, nb saccades, bugs, feedback).
- [ ] 1-2 participants ont complété le protocole.
- [ ] Les fichiers JSON de chaque participant sont collectés et nommés clairement.
- [ ] Un résumé des résultats est rédigé (10-20 lignes) avec observations et limitations identifiées.

#### Comment tester

- Relire le protocole → vérifier qu'un externe pourrait le suivre sans aide.
- Vérifier que chaque tâche est assez précise pour être chronométrée.
- Vérifier que les JSON collectés sont conformes au schéma (US-3.1).

---

### US-3.6 — Rédaction du rapport technique (Fin)

**En tant que** responsable du livrable final,
**je veux** rédiger le rapport technique du projet,
**afin de** documenter l'implémentation, les choix techniques et les résultats.

#### Ce qu'il faut faire

1. Rédiger le rapport avec les sections suivantes :
   - **Introduction :** contexte, objectifs du projet.
   - **Architecture :** schéma des modules (capture, calibration, post-traitement, log, export, visualisations), interactions entre eux.
   - **Implémentation :** choix techniques (WebGazer, I-DT, I-VT, D3.js), paramètres retenus, difficultés rencontrées.
   - **Résultats des tests :** tableau récapitulatif, observations, limitations (précision, conditions de luminosité, latence...).
   - **Conclusion et perspectives :** ce qui fonctionne, ce qui pourrait être amélioré, prochaines étapes pour l'Activity Tracker.
2. Inclure les schémas/diagrammes d'architecture.
3. Chaque dev contribue en rédigeant le paragraphe de sa partie.

#### Critères de validation

- [ ] Le rapport contient toutes les sections listées.
- [ ] Un diagramme d'architecture est inclus.
- [ ] Les résultats des tests sont présentés sous forme de tableau.
- [ ] Les 3 devs ont contribué (chacun a rédigé sa partie).
- [ ] Le rapport fait entre 5 et 10 pages.
- [ ] Le rapport est relu et sans fautes majeures.

---

## Récapitulatif par Dev

| Dev | Début | Milieu | Fin |
|-----|-------|--------|-----|
| **Dev 1** | US-1.1 Calibration | US-1.2 Algo I-DT | US-1.3 Bar Chart + US-1.4 Tests |
| **Dev 2** | US-2.1 Capture flux | US-2.2 Algo I-VT | US-2.3 Line Chart + US-2.4 Tests |
| **Dev 3** | US-3.1 Log JSON + US-3.2 Page démo | US-3.3 Intégration + US-3.4 Scatter Plot | US-3.5 Protocole/Tests + US-3.6 Rapport |
