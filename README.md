# PIR WebGaze Activity Tracker

Prototype du **composant de suivi du regard** d'un *Activity Tracker* pour visualisations
web, réalisé dans le cadre d'un projet PIR (Laboratoire i3S, Université Côte d'Azur).

Le système estime la direction du regard à partir d'une **webcam standard** dans le
navigateur via [WebGazer.js](https://webgazer.cs.brown.edu/), extrait des **événements de
haut niveau** (fixations, saccades) et journalise l'activité multimodale (regard +
interactions) dans un **format structuré** exportable, y compris en **JSON-LD** pour
intégration dans un graphe de connaissances.

---

## Fonctionnalités

- **Capture du regard** dans le navigateur (WebGazer.js, webcam standard, aucun matériel
  spécialisé).
- **Calibration avancée** : grille 5×5 (25 points), correction spatiale continue
  (LOWESS/IDW), augmentation de données synthétiques, validation 9 points avec score de
  généralisation par leave-one-out, compensation des mouvements de tête.
- **Lissage temps réel** par filtre One Euro (réduit le tremblement sans ajouter de lag).
- **Post-traitement** : détection de fixations (I-DT) et de saccades (I-VT).
- **Journalisation structurée** : points bruts, événements, hits AOI, interactions.
- **Export** JSON tabulaire **et** JSON-LD (graphe de connaissances).
- **Suite de tests** unitaires (237 tests, sans webcam).

## Prérequis

- Navigateur récent — **Chrome recommandé** (meilleur support WebGazer/TFFacemesh).
- Webcam fonctionnelle, bonne luminosité, ~60 cm de l'écran.
- Un serveur HTTP local (la webcam `getUserMedia` ne fonctionne pas en `file://`).
- [Node.js](https://nodejs.org/) pour lancer les tests (et, en option, le serveur).

> **WebGazer.js** est chargé par les pages HTML. Vérifiez la balise `<script>`
> correspondante dans `index.html` (CDN ou copie locale `webgazer.min.js`).

## Lancer l'application

Depuis le dossier du projet :

```bash
# Option Python (équivalent au script "serve")
python -m http.server 8080

# ou option Node
npx http-server -p 8080
```

Puis ouvrir **http://localhost:8080/choose.html** dans Chrome (plein écran `F11`
recommandé). Cette page d'accueil permet de choisir le **moteur de suivi du regard** :

- **WebGazer.js** (`index.html`) — solution clé-en-main, mapping écran intégré.
- **MediaPipe FaceLandmarker** (`index-mediapipe.html`) — détection iris haute
  précision + pose de tête, régression écran apprise à la calibration, compensation
  de tête native.

Autoriser la webcam, puis suivre le parcours :

1. Formulaire participant → 2. Positionnement → 3. Calibration (25 points) →
4. Validation (9 points) → 5. Démo sur graphiques → 6. Export.

Les deux moteurs partagent la même chaîne d'analyse (fixations/saccades), le même
journal (`GazeLogger`) et le même format d'export.

Le protocole de test détaillé est dans [`TEST_PROTOCOL.md`](TEST_PROTOCOL.md).

## Lancer les tests

```bash
npm test
```

Exécute les tests de [`tests/`](tests/) (logique de calibration, détection
fixations/saccades, capture). Aucune webcam requise — les API navigateur sont stubées.

## Structure du projet

```
.
├── choose.html             Page d'accueil — choix du moteur (WebGazer / MediaPipe)
├── index.html              Application WebGazer (calibration + démo + export)
├── index-mediapipe.html    Application MediaPipe (même chaîne d'analyse)
├── demo.html               Variante démo autonome (WebGazer)
├── calibration.html        Page de calibration seule
├── participant-form.html   Formulaire participant
├── package.json            Scripts npm (serve, test, generate-data)
├── schema/
│   └── session.schema.json JSON Schema du format d'export (draft-07)
├── src/
│   ├── gaze-capture/       Module de capture WebGazer (GazeCapture)
│   ├── gaze-engine/        Moteur MediaPipe : features iris + ridge (MediaPipeEngine)
│   ├── calibration/        Calibration, filtres, I-DT/I-VT (Calibration)
│   ├── logger/             Journalisation + export JSON/JSON-LD (GazeLogger)
│   ├── gaze-viz/           Heatmap + scanpath du regard en fin de session (GazeViz)
│   ├── barchart/ linechart/ scatterchart/   Visualisations de démonstration
├── tests/                  Tests unitaires Node (326 tests)
├── docs/
│   └── LOG_FORMAT.md       Documentation du format de log
├── rapport/                Rapport technique (LaTeX)
└── data/                   Jeux de données d'exemple (sessions JSON)
```

## Modules (API publique)

| Module | Global | Rôle |
|--------|--------|------|
| `src/gaze-capture/gaze-capture.js` | `GazeCapture` | Démarre/arrête WebGazer, émet les points de regard |
| `src/gaze-engine/mediapipe-engine.js` | `MediaPipeEngine` | Moteur alternatif : features iris + pose de tête → régression ridge → point écran |
| `src/calibration/calibration.js`   | `Calibration` | Calibration, correction spatiale, lissage, fixations/saccades |
| `src/logger/gaze-logger.js`         | `GazeLogger`  | Journalisation et export structuré |

### Moteur MediaPipe (`MediaPipeEngine`)

Contrairement à WebGazer, MediaPipe ne fournit pas de point de regard à l'écran : il
fournit 478 landmarks faciaux (iris inclus) + une matrice de pose 3D. Le moteur
construit un vecteur de **features** (position relative de l'iris dans chaque orbite,
ouverture des yeux, orientation de la tête) puis apprend une **régression ridge**
features → coordonnées écran pendant la calibration. La compensation des mouvements de
tête est ainsi **native** (la pose fait partie des features). La couche mathématique
(`MediaPipeEngine._math` : `extractFeatures`, `ridgeSolve`, `predictLinear`) est pure
et couverte par les tests.

Exemple minimal :

```js
GazeLogger.init('P01', { mean_error_px: 90 });
GazeCapture.onGazeData(p => {
  const c = Calibration.smoothPrediction(p.x, p.y, p.timestamp);
  if (c) GazeLogger.logRawPoint(c.x, c.y, p.timestamp);
});
await GazeCapture.start();
// … fin de session …
const fixations = Calibration.detectFixations(GazeLogger.export().raw_gaze_data, 80, 100);
GazeLogger.download();        // JSON
GazeLogger.downloadJsonLd();  // JSON-LD
```

## Format d'export

Voir [`docs/LOG_FORMAT.md`](docs/LOG_FORMAT.md) et le schéma
[`schema/session.schema.json`](schema/session.schema.json). Deux représentations :

- **JSON tabulaire** — `session`, `raw_gaze_data`, `events`, `aoi_hits`, `interactions`.
- **JSON-LD** — mêmes données sous forme de graphe typé (`wga:Session`, `wga:Fixation`,
  `wga:Saccade`, `wga:AOIHit`, `wga:Interaction`…), prêt pour un graphe de connaissances.

## Limitations connues

- Précision dépendante de l'éclairage, de la webcam et de l'immobilité de la tête
  (limite intrinsèque du suivi du regard par webcam).
- Fréquence d'échantillonnage variable selon la machine (typiquement 10–30 Hz).
- Dérive temporelle possible sur les longues sessions, atténuée par la compensation de
  tête et la micro-recalibration.

## Licence / contexte

Projet académique PIR — encadrement : Aline Menin (i3S, Université Côte d'Azur).
WebGazer.js est distribué sous licence GPLv3 par l'Université Brown.
