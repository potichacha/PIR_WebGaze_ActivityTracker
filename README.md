# PIR WebGaze Activity Tracker

Prototype d'un **composant de suivi du regard** pour un *Activity Tracker* appliqué aux visualisations web.
Réalisé dans le cadre du PIR, Laboratoire i3S, Université Côte d'Azur.

L'objectif : estimer en temps réel où un utilisateur regarde sur l'écran, à partir d'une **webcam ordinaire**, entièrement dans le navigateur, sans aucun matériel spécialisé.

---

## Lancer l'application

Un serveur HTTP local est obligatoire (l'accès à la webcam est bloqué en `file://`).

```bash
python -m http.server 8080
# ou
npx http-server -p 8080
```

Ouvrir **http://localhost:8080/choose.html** dans Chrome. Plein écran (`F11`) recommandé.

---

## Comment ça marche — vue d'ensemble

L'application propose **deux moteurs d'estimation du regard**, au choix :

| Moteur | Technologie | Ce qu'il fait |
|---|---|---|
| **WebGazer.js** | TensorFlow.js (Université Brown) | Détecte les yeux dans l'image webcam et prédit directement les coordonnées écran |
| **MediaPipe FaceLandmarker** | ML Google | Détecte 478 points 3D du visage (dont l'iris) et construit une régression pour prédire les coordonnées écran |

Dans les deux cas, le déroulé est identique :

```
1. Formulaire participant    → identifiant unique, lunettes, luminosité
2. Positionnement            → retour vidéo pour bien se centrer devant la caméra
3. Calibration               → l'utilisateur regarde des points connus → le modèle apprend le mapping regard → écran
4. Validation                → test sur 9 points, erreur calculée honnêtement (leave-one-out)
5. Scénario de test guidé    → 3 graphiques, cercle rouge 3 s + exploration libre 15 s
6. Export                    → fichier JSON contenant tous les regards, fixations, saccades, interactions
```

---

## Structure du projet — chaque fichier expliqué

```
PIR_WebGaze_ActivityTracker/
│
│  ── Pages HTML (ce que l'utilisateur ouvre) ──
│
├── choose.html              Page d'accueil : boutons pour choisir WebGazer ou MediaPipe
├── index-webgazer.html      Application complète avec le moteur WebGazer
├── index-mediapipe.html     Application complète avec le moteur MediaPipe
├── index.html               Ancienne page d'entrée (redirige vers choose.html)
├── session-viewer.html      Visualisateur de sessions : ouvre un JSON exporté et affiche
│                            la heatmap, le scanpath et les statistiques
│
│  ── Code source des modules (src/) ──
│
├── src/
│   │
│   ├── participant-form/
│   │   └── participant-form.js     Formulaire d'entrée affiché au démarrage.
│   │                               Génère l'ID participant (P-YYYYMMDD-XXXXXX),
│   │                               demande la correction visuelle et la luminosité.
│   │                               Module partagé : utilisé par les deux moteurs.
│   │
│   ├── calibration/
│   │   ├── calibration.js          Toute la logique de calibration et de post-traitement :
│   │   │                           • grille de 25 points (cliquer sur chaque point)
│   │   │                           • validation leave-one-out sur 9 points
│   │   │                           • correction spatiale LOWESS/IDW (corrige les zones
│   │   │                             où le modèle est moins précis)
│   │   │                           • filtre One Euro (lissage temps réel du signal)
│   │   │                           • détection des fixations (I-DT) et saccades (I-VT)
│   │   └── calibration.css         Styles visuels de l'interface de calibration
│   │
│   ├── gaze-capture/
│   │   └── gaze-capture.js         Couche d'abstraction pour WebGazer.
│   │                               Démarre/arrête WebGazer, s'abonne au flux de points
│   │                               de regard et les transmet au reste de l'application.
│   │                               (Utilisé uniquement par index-webgazer.html)
│   │
│   ├── gaze-engine/
│   │   └── mediapipe-engine.js     Moteur MediaPipe : charge le modèle FaceLandmarker,
│   │                               extrait les features (position iris, pose tête, angles
│   │                               d'Euler, échelle inter-oculaire), entraîne la régression
│   │                               ridge et prédit les coordonnées regard à chaque frame.
│   │                               (Utilisé uniquement par index-mediapipe.html)
│   │
│   ├── logger/
│   │   └── gaze-logger.js          Module central de journalisation.
│   │                               Enregistre chaque point de regard avec toutes ses
│   │                               métadonnées (lux, élément DOM survolé, état de la
│   │                               visualisation, test en cours…).
│   │                               Exporte en JSON, JSON-LD ou CSV.
│   │
│   ├── gaze-viz/
│   │   └── gaze-viz.js             Génère les visualisations post-session :
│   │                               • heatmap (zones les plus regardées, en rouge/jaune)
│   │                               • scanpath (ordre chronologique des fixations, flèches)
│   │
│   ├── test-scenario/
│   │   └── test-scenario.js        Orchestre le scénario de test guidé.
│   │                               Pour chaque graphique : affiche un cercle rouge sur une
│   │                               cible 3 s (phase amorce), puis laisse explorer 15 s
│   │                               (phase libre). Étiquette chaque point de regard avec
│   │                               l'identifiant du stimulus en cours.
│   │
│   ├── results-view/
│   │   └── results-view.js         Écran de résultats affiché à la fin du test.
│   │                               Montre le score de proximité (à quel point l'utilisateur
│   │                               regardait près des cibles), la heatmap et le scanpath.
│   │
│   ├── session-store/
│   │   └── session-store.js        Sauvegarde automatique des sessions dans le navigateur
│   │                               (localStorage). Permet de retrouver une session passée
│   │                               sans avoir exporté le fichier JSON.
│   │
│   ├── ambient-light/
│   │   └── ambient-light.js        Mesure la luminosité ambiante (lux).
│   │                               Utilise l'API AmbientLightSensor si disponible,
│   │                               sinon estime la luminosité à partir de la webcam.
│   │                               La valeur est enregistrée dans chaque point de regard.
│   │
│   ├── compare/
│   │   └── compare.js              Outil de comparaison entre deux sessions (WebGazer vs
│   │                               MediaPipe, ou deux participants). Calcule les écarts
│   │                               de fixations et les scores AOI.
│   │
│   ├── barchart/
│   │   ├── barchart.js             Graphique à barres (D3.js). Expose les AOI (zones
│   │   └── barchart.css            d'intérêt) pour que le scénario sache où pointer
│   │                               le cercle rouge et pour étiqueter les regards.
│   │
│   ├── linechart/
│   │   ├── linechart.js            Graphique en courbes (D3.js). Même principe.
│   │   └── linechart.css
│   │
│   └── scatterchart/
│       ├── scatterchart.js         Nuage de points (D3.js). Même principe.
│       └── scatterchart.css
│
│  ── Tests automatisés ──
│
├── tests/
│   ├── test-calibration.js         Teste la correction LOWESS/IDW, le filtre One Euro,
│   │                               la validation leave-one-out
│   ├── test-gaze-logger.js         Teste la structure du JSON exporté
│   ├── test-mediapipe-engine.js    Teste la régression ridge et l'extraction de features
│   ├── test-gaze-capture.js        Teste le wrapper WebGazer
│   ├── test-gaze-viz.js            Teste la génération heatmap/scanpath
│   ├── test-results-view.js        Teste l'écran de résultats
│   ├── test-session-store.js       Teste la persistance localStorage
│   └── test-compare.js             Teste la comparaison inter-sessions
│
│  ── Outils, données, documentation ──
│
├── tools/
│   └── generate-sample-data.js     Script Node.js qui génère un fichier JSON de session
│                                   simulée (pour tester le session-viewer sans faire
│                                   une vraie session).
│
├── data/
│   └── README.md                   Explique le format des fichiers JSON de session exemple
│
├── schema/
│   └── session.schema.json         Schéma JSON formel (JSON Schema draft-07) décrivant
│                                   exactement la structure d'un fichier de session.
│                                   Peut être utilisé pour valider un fichier avec un
│                                   outil comme ajv ou jsonschema.
│
├── docs/
│   └── LOG_FORMAT.md               Documentation technique détaillée du format de log
│
├── rapport/
│   ├── rapport.tex                 Rapport PIR en LaTeX
│   └── README.md                   Instructions de compilation du rapport
│
├── package.json                    Dépendances Node.js (pour les tests uniquement)
├── PIR_WebGaze_UserStories.md      User stories du projet
├── TEST_CHECKLIST.md               Liste de vérification pour les tests utilisateur
└── TEST_PROTOCOL.md                Protocole expérimental (comment conduire une session)
```

---

## Les deux moteurs d'estimation du regard

### WebGazer.js

WebGazer est une bibliothèque open-source (Université Brown, 2016, licence GPLv3). Elle fait tout le travail d'estimation du regard de façon transparente.

**Ce qu'elle fait, étape par étape :**

1. **Elle détecte le visage** via TensorFlow.js (modèle TFFacemesh, 468 points faciaux) dans chaque image de la webcam.

2. **Elle extrait les patches oculaires** : des petites images 10×10 pixels autour de chaque œil, qui encodent approximativement où se trouve l'iris.

3. **Elle apprend lors de la calibration** : chaque clic sur un point de calibration lui fournit un exemple (image des yeux à cet instant → position de ce clic). Elle entraîne une régression ridge sur ces exemples.

4. **Elle prédit en continu** : à chaque nouvelle frame, elle sort directement `{x, y}` — les coordonnées écran estimées — à 10–30 Hz.

5. **Elle lisse le signal** en interne (filtre de Kalman).

**Ce que ce projet ajoute par-dessus WebGazer :**
- Calibration sur 25 points (au lieu de 9) pour couvrir tout l'écran.
- Validation sur 9 points avec erreur leave-one-out (honnête, non biaisée).
- Correction spatiale résiduelle (LOWESS/IDW) : après calibration, certaines zones de l'écran restent moins précises ; on mesure et corrige ces résidus.
- Filtre One Euro pour le lissage temps réel (moins de latence que Kalman sur les mouvements rapides).
- Journalisation de chaque point avec : luminosité, lunettes, stimulus en cours, élément DOM survolé.

**Limites :** précision typique 80–200 px, sensible aux mouvements de tête, 10–30 Hz.

---

### MediaPipe FaceLandmarker

MediaPipe est un framework ML de Google (Apache 2.0). Son modèle FaceLandmarker détecte **478 points 3D** du visage, dont les contours précis des iris et l'orientation complète de la tête.

**Pourquoi ça ne donne pas directement un point de regard ?**
MediaPipe sait où se trouve votre iris dans votre orbite et comment votre tête est orientée — mais il ne sait pas où vous regardez *sur l'écran*. Ce lien (features → coordonnées écran) est une régression que ce projet construit lui-même dans `mediapipe-engine.js`.

**Ce que fait `mediapipe-engine.js`, étape par étape :**

1. **Extraction des features** : à chaque frame, on calcule un vecteur numérique contenant la position de chaque iris dans son orbite (normalisée par rapport à la pose de la tête), les angles d'Euler (yaw/pitch/roll), l'échelle inter-oculaire (proxy de la distance à l'écran), et les scores de clignement.

2. **Régression ridge** : `W = (XᵀX + λI)⁻¹ Xᵀ Y`. X est la matrice des features collectées aux points de calibration, Y les positions écran correspondantes, λ est sélectionné automatiquement par validation croisée. Le résultat W est la matrice qui prédit `{x, y}` à partir des features.

3. **Correction spatiale** : identique à WebGazer — on mesure les résidus sur 9 points et on construit un champ de correction LOWESS/IDW.

4. **Validation leave-one-out** : pour chaque point de validation, on reconstruit le champ sans ce point, puis on mesure l'erreur. C'est cette erreur qui est reportée dans le JSON.

**Points forts vs WebGazer :** 478 landmarks précis, GPU (30–60 Hz), compensation native des mouvements de tête, calibration par poursuite disponible (suivre une bille des yeux → ~1000 samples vs ~250 pour les clics).

---

### Comparaison directe

| Critère | WebGazer.js | MediaPipe |
|---|---|---|
| Régression fournie | Oui — clé en main | Non — construite dans ce projet |
| Points de visage | ~468 (patches 2D) | 478 (3D + iris précis + pose) |
| Fréquence | 10–30 Hz | 30–60 Hz (GPU) |
| Précision typique | 80–200 px | 50–150 px |
| Comp. mouvements de tête | Partielle | Native (la pose est une feature) |
| Modes de calibration | Clics | Clics ou poursuite |
| Licence | GPLv3 | Apache 2.0 |

Les deux moteurs utilisent exactement les mêmes modules de calibration, de journalisation, de scénario de test et d'export — seul le bloc d'estimation du regard change.

---

## Format du fichier JSON exporté

À la fin de chaque session, l'application exporte un fichier `.json`. Ce fichier contient **tout** ce qui s'est passé pendant la session.

### Structure générale

```json
{
  "session":       { ... },   ← qui, quand, quel matériel, quelle précision
  "raw_gaze_data": [ ... ],   ← tous les points de regard, frame par frame
  "events":        [ ... ],   ← fixations et saccades détectées
  "aoi_hits":      [ ... ],   ← moments où le regard a touché une zone d'intérêt
  "interactions":  [ ... ]    ← événements UI : changement de graphique, export, etc.
}
```

---

### `session` — qui était là, dans quelles conditions

Contient les métadonnées de la session. C'est la "fiche participant" enrichie.

```json
{
  "id":                "3f29a1b2-c4d5-...",
  "format_version":    "1.2.0",
  "participant_id":    "P-20260628-A4B2ZK",
  "glasses":           "lunettes",
  "lighting":          "normale",
  "lux_measured":      342,
  "engine":            "mediapipe",
  "start_time":        "2026-06-28T10:14:00.000Z",
  "end_time":          "2026-06-28T10:28:00.000Z",
  "clock_origin_ms":   12345.6,
  "screen_resolution": { "width": 1920, "height": 1080 },
  "device_pixel_ratio": 1,
  "browser":           "Chrome/126",
  "calibration_score": { "mean_error_px": 92.4, "std_error_px": 31.0 },
  "config_snapshot":   { "lowess_bandwidth": 0.45, "one_euro_min_cutoff": 1.0 }
}
```

| Champ | Ce que c'est |
|---|---|
| `id` | Identifiant unique de la session (UUID généré automatiquement) |
| `participant_id` | Identifiant du participant, format `P-YYYYMMDD-XXXXXX`, montré à l'écran lors du formulaire |
| `glasses` | Ce que le participant a déclaré : `"non"`, `"lunettes"` ou `"lentilles"` |
| `lighting` | Luminosité déclarée : `"faible"`, `"normale"` ou `"forte"` |
| `lux_measured` | Valeur mesurée automatiquement par le capteur (ou par la webcam) au moment du formulaire, en lux. `null` si non disponible |
| `engine` | Moteur utilisé : `"webgazer"` ou `"mediapipe"` |
| `start_time` / `end_time` | Début et fin de la session, en format ISO 8601 (UTC) |
| `clock_origin_ms` | Valeur de `performance.now()` au démarrage — sert à convertir les `t_rel_ms` en temps absolu |
| `screen_resolution` | Résolution de l'écran physique en pixels |
| `device_pixel_ratio` | Ratio écran haute densité (ex. 2 sur Mac Retina). Toujours 1 si le patch DPI est actif |
| `calibration_score` | Erreur de calibration en pixels, calculée par leave-one-out. `mean_error_px` = erreur moyenne, `std_error_px` = écart-type |
| `config_snapshot` | Copie des paramètres de l'algorithme au moment de la session (pour pouvoir rejouer exactement le même traitement plus tard) |

---

### `raw_gaze_data` — tous les points de regard

C'est la liste brute des estimations du regard, une entrée par frame (environ toutes les 33–100 ms selon le moteur). Chaque entrée décrit exactement **où le participant regardait**, **dans quel contexte**, et **ce qu'il y avait à cet endroit**.

```json
{
  "x": 812,
  "y": 437,
  "raw_x": 800,
  "raw_y": 440,
  "timestamp": 1750599611123,
  "t_rel_ms": 4502.1,
  "confidence": 0.87,
  "source_module": "mediapipe",
  "lux": 342,
  "test_case_id": "tab-bar-cible1",
  "target_aoi_id": "bar-q3",
  "target_x": 1140,
  "target_y": 350,
  "dom": {
    "tag": "rect",
    "semantic_type": "bar",
    "text": "T3",
    "bbox": { "x": 1080, "y": 290, "width": 60, "height": 220 },
    "css_selector": "rect.bar.bar-q3"
  },
  "viz_state": {
    "active_view": "bar",
    "dataset": "ventes_trimestrielles",
    "current_aoi": "bar-q3",
    "zoom": 1,
    "filters": []
  }
}
```

| Champ | Ce que c'est |
|---|---|
| `x`, `y` | Coordonnées écran estimées **après correction spatiale** (en pixels, origine coin haut-gauche) |
| `raw_x`, `raw_y` | Coordonnées **avant** correction spatiale — la prédiction brute du modèle |
| `timestamp` | Heure absolue en millisecondes epoch (`Date.now()`). Lisible mais peut être affecté par la synchronisation NTP |
| `t_rel_ms` | **À utiliser pour les calculs de durée.** Temps écoulé depuis le démarrage de la session, en ms, fourni par `performance.now()` — horloge monotone qui ne recule jamais |
| `confidence` | Score de confiance de l'estimation, entre 0 et 1. Proche de 1 = yeux bien détectés, bien ouverts. Proche de 0 = estimation peu fiable (clignement, occlusion) |
| `source_module` | Moteur qui a produit ce point : `"webgazer"` ou `"mediapipe"` |
| `lux` | Luminosité ambiante en lux au moment de ce point (mise à jour en temps réel) |
| `test_case_id` | Identifiant du stimulus affiché à cet instant, ex. `"tab-bar-cible1"` (graphique barre, 1ère cible), `"tab-line-free"` (graphique ligne, phase libre). `null` hors scénario de test |
| `target_aoi_id` | Zone d'intérêt ciblée par le cercle rouge pendant la phase d'amorçage, ex. `"bar-q3"`. `null` en phase libre |
| `target_x`, `target_y` | Position du centre du cercle rouge à l'écran à cet instant. Permet de calculer l'erreur de direction du regard |
| `dom` | Élément HTML qui se trouve sous le point de regard estimé : balise, type sémantique, texte visible, boîte englobante, sélecteur CSS |
| `viz_state` | État de la visualisation au moment du point : quel graphique est actif, quel dataset, quel zoom, quels filtres sont appliqués |

**Pourquoi deux horloges ?**

| | `timestamp` | `t_rel_ms` |
|---|---|---|
| Valeur | Millisecondes depuis le 1er janvier 1970 | Millisecondes depuis le démarrage de la session |
| Source | `Date.now()` | `performance.now() − clock_origin_ms` |
| Utilisation | Affichage lisible, synchronisation avec des logs externes | **Calculs de durée, de vitesse, d'intervalle entre événements** |

→ Utilisez toujours `t_rel_ms` pour calculer une durée ou une vitesse. `timestamp` peut reculer si l'horloge système est ajustée ; `t_rel_ms` ne recule jamais.

---

### `events` — fixations et saccades

Contient les événements oculomoteurs extraits du signal brut. Il y a deux types :

**Une fixation** = moment où le regard reste relativement stable (le participant examine quelque chose).

```json
{
  "type": "fixation",
  "start_time": 1750599611000,
  "end_time":   1750599611280,
  "duration":   280,
  "details": {
    "x": 810,
    "y": 440,
    "points_count": 8
  }
}
```

| Champ | Ce que c'est |
|---|---|
| `duration` | Durée de la fixation en millisecondes |
| `x`, `y` | Position moyenne de la fixation (centroïde des points) |
| `points_count` | Nombre de points de regard inclus dans cette fixation |

Méthode de détection : **I-DT** (dispersion threshold). Une fenêtre glissante est déclarée fixation quand l'écart total `(max_x − min_x) + (max_y − min_y)` reste sous **80 px** pendant au moins **100 ms**. Algorithme O(n) par files monotones.

---

**Une saccade** = mouvement rapide du regard entre deux zones.

```json
{
  "type": "saccade",
  "start_time": 1750599611300,
  "end_time":   1750599611360,
  "duration":   60,
  "details": {
    "start_x": 810, "start_y": 440,
    "end_x":  1200, "end_y":   320,
    "amplitude":     421,
    "peak_velocity": 7200
  }
}
```

| Champ | Ce que c'est |
|---|---|
| `amplitude` | Distance parcourue en pixels entre le début et la fin |
| `peak_velocity` | Vitesse maximale atteinte pendant la saccade, en pixels/seconde |

Méthode de détection : **I-VT** (velocity threshold). Toute transition dont la vitesse instantanée dépasse **0.7 px/ms** est classée saccade.

---

### `aoi_hits` — passages sur les zones d'intérêt

Enregistre chaque fixation qui tombe sur une zone d'intérêt (AOI) du graphique.

```json
{
  "aoi_id":     "bar-q3",
  "aoi_label":  "T3 — 2024",
  "event_index": 12,
  "timestamp":   1750599611000,
  "t_rel_ms":    4200.0
}
```

| Champ | Ce que c'est |
|---|---|
| `aoi_id` | Identifiant de la zone d'intérêt (barre, point, colonne…) |
| `aoi_label` | Libellé lisible de la zone |
| `event_index` | Index dans `events[]` de la fixation correspondante (permet de croiser les deux listes) |

---

### `interactions` — événements de l'interface

Enregistre tout ce qui se passe côté UI pendant la session : début du test, changements de graphique, déclenchement du scénario, recalibrations en cours de session, export.

```json
{
  "type": "stimulus_shown",
  "details": {
    "phase": "amorce",
    "test_case_id": "tab-bar-cible1",
    "aoi": "bar-q2"
  },
  "timestamp":    1750599611000,
  "t_rel_ms":     4200.0,
  "source_module": "ui"
}
```

Types possibles :

| Type | Quand |
|---|---|
| `test_session_start` | Début du scénario de test |
| `test_session_end` | Fin du scénario |
| `stimulus_shown` | Cercle rouge apparu (phase amorce) ou disparition (phase libre) |
| `tab_change` | L'utilisateur a changé de graphique |
| `gaze_enter_aoi` | Le regard entre dans une zone d'intérêt |
| `online_recalibration` | Ctrl+clic : ajout d'un sample sans recalibrer (MediaPipe uniquement) |
| `export` | Déclenchement d'un export JSON/CSV/JSON-LD |

---

### Export JSON-LD (optionnel)

Format alternatif qui encode la session comme un **graphe de connaissances RDF**, exploitable dans des outils comme GraphDB ou Apache Jena Fuseki.

```json
{
  "@context": { "wga": "https://i3s.unice.fr/activity-tracker/vocab#" },
  "@graph": [
    { "@id": "urn:wga:session:3f29...", "@type": "wga:Session" },
    { "@id": "urn:wga:session:3f29...:fixation:0",
      "@type": "wga:Fixation",
      "wga:duration": 280, "wga:x": 810, "wga:y": 440 }
  ]
}
```

Types RDF définis : `wga:Session`, `wga:Participant`, `wga:Fixation`, `wga:Saccade`, `wga:AOIHit`, `wga:Interaction`.

---

## Scénario de test guidé

Après calibration, le test est entièrement automatique — l'expérimentateur n'a rien à faire.

```
Pour chaque graphique (Bar chart → Line chart → Scatter chart) :

  Phase 1 — Amorçage (3 secondes)
    Un cercle rouge pulsant apparaît sur une zone d'intérêt spécifique.
    Message affiché : « Regardez le cercle rouge »
    → Chaque point de regard pendant cette phase est étiqueté avec :
      test_case_id  = identifiant du stimulus
      target_aoi_id = identifiant de la cible
      target_x/y    = position du cercle

  Phase 2 — Exploration libre (15 secondes)
    Le cercle disparaît. Le participant explore librement.
    Un compteur défile. Le test_case_id est mis à jour ("tab-bar-free", etc.)

  → Passage automatique au graphique suivant.
```

L'analyse post-test compare, pour chaque phase d'amorçage, la distance entre le regard réel du participant et la cible — ce qui donne un score de suivi par stimulus.

---

## Tests automatisés

```bash
npm test
```

Les tests tournent sous Node.js, sans webcam. Ils couvrent :
- La correction spatiale (LOWESS/IDW)
- Le filtre One Euro
- La validation leave-one-out
- La structure du JSON exporté (tous les champs obligatoires)
- Les maths de la régression ridge (MediaPipe)
- La détection des fixations et saccades

---

## Prérequis

- **Navigateur** : Chrome recommandé (meilleur support WebGazer TFFacemesh + MediaPipe WebGL)
- **Webcam** fonctionnelle, éclairage correct, position ~60 cm de l'écran
- **Serveur HTTP local** (voir "Lancer l'application")
- **Node.js** uniquement pour `npm test` — pas nécessaire pour utiliser l'application

---

## Contexte académique

Projet PIR — Laboratoire i3S, Université Côte d'Azur.
Encadrement : Aline Menin.

Bibliothèques tierces :
- **WebGazer.js** — Université Brown, licence GPLv3 (Papoutsaki et al., IJCAI 2016)
- **MediaPipe** — Google, licence Apache 2.0
- **D3.js** — Observational HQ, licence ISC
