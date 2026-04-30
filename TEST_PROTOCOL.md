# Protocole de test — PIR WebGaze Activity Tracker

## Pré-requis

- Navigateur : Chrome (recommandé) ou Firefox, version récente
- Webcam fonctionnelle (intégrée ou externe)
- Luminosité correcte : visage bien éclairé, pas de contre-jour
- Résolution écran : 1920×1080 minimum
- Port 8080 ouvert localement (`npx serve .` ou équivalent)
- Lunettes / lentilles : OK, noter dans la fiche

---

## Étapes du protocole

### Étape 0 — Préparation (testeur, 2 min)

1. Lancer le serveur local et ouvrir `http://localhost:8080/index.html` en plein écran (F11).
2. Remplir la fiche participant (`participant-form.html`) : ID, âge, genre, lunettes, navigateur, éclairage.
3. Expliquer brièvement au participant l'objectif (suivi du regard sur des graphiques).
4. S'assurer que la caméra est déjà active (retour vidéo visible en bas à droite de la page).

### Étape 1 — Calibration (~5 min)

1. Scroller jusqu'à la section **Calibration** (ou cliquer sur le point de navigation).
2. Cliquer **"Démarrer la calibration"**.
3. Consigne au participant : *"Regardez chaque point et cliquez dessus autant de fois qu'il se remplit. Restez le plus immobile possible."*
4. Attendre la fin des 25 points (250 clics au total).
5. Attendre l'écran de validation automatique (9 points de fixation).
6. Lire le score affiché :
   - ≤ 175 px → Réussie ✓ → continuer
   - 175–250 px → Acceptable ⚠️ → continuer mais noter
   - > 250 px → Insuffisante ✗ → recalibrer une fois
7. Cliquer **"Passer à la démo ↓"**.

### Étape 2 — Tâches sur le Bar Chart (~3 min)

L'onglet **Bar Chart** est affiché par défaut.

**Tâche 2.1 — Identification**
> *"Quelle catégorie a les ventes les plus élevées ? Fixez-la quelques secondes."*

**Tâche 2.2 — Comparaison**
> *"Comparez les ventes du T1 et du T3. Fixez chaque barre concernée."*

**Tâche 2.3 — Lecture d'axe**
> *"Quelle est la valeur approximative de la barre la plus basse ? Regardez l'axe Y."*

### Étape 3 — Tâches sur le Line Chart (~3 min)

Cliquer sur l'onglet **Line Chart**.

**Tâche 3.1 — Tendance**
> *"Sur quelle période les températures de Paris sont-elles les plus élevées ? Suivez la courbe du regard."*

**Tâche 3.2 — Comparaison de séries**
> *"En quel mois l'écart entre Paris et Lyon est-il le plus grand ? Regardez les deux courbes."*

**Tâche 3.3 — Lecture de légende**
> *"Identifiez quelle couleur correspond à Lyon. Regardez la légende."*

### Étape 4 — Tâches sur le Scatter Plot (~3 min)

Cliquer sur l'onglet **Scatter Plot**.

**Tâche 4.1 — Outlier**
> *"Identifiez un pays qui vous semble atypique par rapport aux autres. Fixez-le."*

**Tâche 4.2 — Cluster**
> *"Repérez un groupe de pays proches. Balayez cette zone du regard."*

**Tâche 4.3 — Lecture d'axes**
> *"Quel pays a la plus longue espérance de vie ? Regardez l'axe Y pour vérifier."*

### Étape 5 — Export et fin (~1 min)

1. Cliquer **"■ Arrêter"** dans la barre de contrôle.
2. Un résumé (fixations, saccades, AOI hits) s'affiche dans la barre.
3. Cliquer **"Export JSON"** → le fichier `session_<id>_<date>.json` est téléchargé.
4. Renommer le fichier : `participant_<ID>_<date>.json`.

### Étape 6 — Questionnaire rapide (~2 min)

Poser oralement les questions suivantes (noter les réponses) :

| # | Question | Réponse |
|---|----------|---------|
| 1 | Le suivi de votre regard vous semblait-il précis ? (1–5) | |
| 2 | La calibration était-elle facile à réaliser ? (1–5) | |
| 3 | Le retour caméra en bas à droite était-il gênant ? (oui/non) | |
| 4 | Avez-vous eu l'impression d'être suivi correctement sur les graphiques ? (1–5) | |
| 5 | Observations libres | |

---

## Grille d'évaluation par participant

| Champ | Valeur |
|-------|--------|
| ID participant | |
| Date | |
| Âge | |
| Genre | |
| Lunettes / lentilles | |
| Navigateur | |
| Score calibration (px) | |
| Verdict calibration | |
| Tentatives de calibration | |
| Nb fixations détectées | |
| Nb saccades détectées | |
| Nb AOI hits | |
| Fichier JSON généré | oui / non |
| Bugs observés | |
| Score facilité calibration (1–5) | |
| Score précision perçue (1–5) | |
| Observations testeur | |

---

## Consignes pour le testeur

- Ne pas intervenir pendant les tâches (sauf blocage critique).
- Observer la posture : distance à l'écran (~60 cm), inclinaison de la tête.
- Noter tout comportement inhabituel (regard hors écran, mouvement de tête excessif).
- Si la dérive est détectée (alerte jaune sur la page), noter l'instant et si une micro-recalibration a été faite.
