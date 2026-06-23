# Checklist de validation manuelle (avec webcam)

Les 420 tests unitaires (`npm test`) valident la **logique**, mais pas la chaîne
navigateur complète (webcam, modèles, affichage). Cette checklist couvre ce qui ne
peut être vérifié qu'**en lançant l'application avec une vraie webcam**.

## Préparation

```bash
python -m http.server 8080
```
Ouvrir **http://localhost:8080/choose.html** dans **Chrome**, plein écran (`F11`),
bonne lumière, ~60 cm de l'écran. Autoriser la webcam quand demandé.

> Astuce : ouvrir la console (F12) pour repérer toute erreur de chargement.

---

## A. Page d'accueil

- [ ] La page `choose.html` affiche les **deux cartes** (WebGazer / MediaPipe).
- [ ] Chaque carte ouvre la bonne page.

## B. Moteur WebGazer (`index.html`)

- [ ] La caméra démarre, le retour vidéo s'affiche.
- [ ] **Si une calibration existe** : un **point rouge** apparaît et suit le regard
      (aperçu) sans rien enregistrer.
- [ ] « Démarrer la calibration » : les 25 points s'enchaînent, le mini-miroir
      **se déplace** pour ne pas masquer le point actif.
- [ ] Phase de validation : le **point de regard** est visible.
- [ ] Écran de score : erreur moyenne + LOO + par quadrant affichés.
- [ ] Démo : le curseur suit le regard ; sa **couleur** varie (rouge=faible
      confiance → vert=élevée).
- [ ] Fixer une barre quelques secondes → tooltip + surbrillance (dwell).
- [ ] Changer d'onglet (bar/line/scatter) fonctionne.
- [ ] **Zoom** : Ctrl+molette sur le graphique agrandit les barres (indicateur
      « zoom ×N » visible).
- [ ] **Filtre** : cliquer un trimestre dans la légende le masque/affiche.
- [ ] « Arrêter » → la **heatmap + scanpath** du regard s'affiche.
- [ ] « Export » télécharge **3 fichiers** : `.json`, `.jsonld`, `.csv`.

## C. Moteur MediaPipe (`index-mediapipe.html`)

- [ ] Le **modèle MediaPipe se charge** (pas d'erreur WASM/CDN en console ;
      nécessite Internet). Si échec GPU, passer `DELEGATE` à `'CPU'` dans
      `src/gaze-engine/mediapipe-engine.js`.
- [ ] **Si profil mémorisé** : la caméra démarre seule et un **point bleu** suit le
      regard (aperçu).
- [ ] « Calibrer » : formulaire participant → **écran de positionnement** avec
      détection du visage + feedback de distance (ovale vert quand correct).
- [ ] Calibration : le mini-miroir **fuit** le point actif.
- [ ] Validation : **point bleu** visible, suit le regard ; puis écran
      « Vérification du regard ».
- [ ] La couleur du point bleu varie selon la **confiance**.
- [ ] **Ctrl+clic** pendant le suivi affine le modèle (message « Modèle affiné »).
- [ ] Démo, zoom, filtre, heatmap, export : **identiques** à WebGazer.

## D. Contenu des données exportées (le plus important pour le PIR)

Ouvrir le fichier `.json` exporté et vérifier que `raw_gaze_data[0]` contient :

- [ ] `confidence` (nombre ∈ [0,1])
- [ ] `source_module` (`"webgazer"` ou `"mediapipe"`)
- [ ] `raw_x` / `raw_y`
- [ ] `dom` avec `semantic_type` (`"bar"`, `"axis"`, `"point"`…), `text`, `bbox`
- [ ] `viz_state` avec `active_view`, `dataset`, `zoom`, `filters`, `current_aoi`

Et au niveau session :
- [ ] `events` contient des `fixation` et `saccade`
- [ ] `aoi_hits` avec `dom` + `viz_state`
- [ ] `interactions` (session\_start/stop, tab\_change, export…)
- [ ] `viz_states` (au moins un, + un par zoom/filtre/onglet)

## E. Points de comparaison à noter (pour le rapport)

| Mesure | WebGazer | MediaPipe |
|--------|----------|-----------|
| Erreur validation moyenne (px) | | |
| Erreur corrigée LOO (px) | | |
| Confiance moyenne | | |
| Cadence ressentie (fluide ?) | | |
| Stabilité tête / dérive | | |

> ⚠️ La `confidence` n'a pas la même définition selon le moteur (cf. rapport) :
> à interpréter par moteur, pas en valeur absolue inter-moteurs.

---

## En cas de problème

- **Modèle MediaPipe ne charge pas** → vérifier la connexion Internet (CDN
  jsdelivr) ; basculer `DELEGATE: 'CPU'`.
- **Point très décalé** → recalibrer (lumière, distance, fixer chaque point).
- **Webcam refusée** → autoriser dans les réglages du site (cadenas Chrome).
