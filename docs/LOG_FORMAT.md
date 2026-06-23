# Format de journalisation — WebGaze Activity Tracker

Ce document décrit le format structuré d'export d'une session de suivi du regard.
Le schéma formel (validable) se trouve dans
[`schema/session.schema.json`](../schema/session.schema.json) (JSON Schema draft-07).

- **Version du format** : `1.2.0` (`session.format_version`).
- **Producteur** : `GazeLogger.export()` (JSON) et `GazeLogger.exportJsonLd()` (JSON-LD).

> **Nouveautés v1.2.0** (demandes encadrante PIR) : confiance de prédiction et
> `source_module` sur chaque point de regard, descripteur DOM détaillé de l'objet
> observé, état de la visualisation (`viz_state` + section `viz_states`), et
> `source_module` sur toutes les entrées pour identifier le module émetteur.

---

## 1. Vue d'ensemble

Une session exportée est un objet JSON à cinq sections :

```json
{
  "session":       { ... },
  "raw_gaze_data": [ ... ],
  "events":        [ ... ],
  "aoi_hits":      [ ... ],
  "interactions":  [ ... ]
}
```

### Horloges

Chaque enregistrement temporel porte **deux** horloges :

| Champ | Source | Usage |
|-------|--------|-------|
| `timestamp` | `Date.now()` (epoch ms) | Horodatage absolu, lisible, mais sujet aux ajustements d'horloge système. |
| `t_rel_ms`  | `performance.now()` relatif à `session.clock_origin_ms` | **Horloge monotone** — à privilégier pour durées, vélocités et synchronisation. |

> Pour tout calcul de durée ou de vitesse, utilisez `t_rel_ms` : il ne recule jamais.

---

## 2. `session` — métadonnées

```json
{
  "id": "3f29…-…",
  "format_version": "1.1.0",
  "participant_id": "P01",
  "start_time": "2026-06-22T13:40:11.000Z",
  "end_time":   "2026-06-22T13:48:55.000Z",
  "clock_origin_ms": 12345.6,
  "screen_resolution": { "width": 1920, "height": 1080 },
  "device_pixel_ratio": 1,
  "user_agent": "Mozilla/5.0 …",
  "browser": "Chrome",
  "calibration_score": { "mean_error_px": 92.4, "std_error_px": 31.0 },
  "calibration_version": "2026-04-29-debug-webgazer-01",
  "config_snapshot": { "one_euro_min_cutoff": 1.0, "lowess_bandwidth": 0.45, … }
}
```

`config_snapshot` fige les paramètres de filtrage/correction qui influencent les données,
indispensable pour **reproduire ou comparer** deux sessions a posteriori.

---

## 3. `raw_gaze_data` — points de regard

Un point par frame, **après** correction spatiale et lissage, enrichi de tout le
contexte disponible.

```json
{
  "x": 812, "y": 437, "raw_x": 800, "raw_y": 440,
  "timestamp": 1750599611123, "t_rel_ms": 4502.1,
  "confidence": 0.87, "source_module": "webgazer",
  "dom": { "tag": "rect", "semantic_type": "bar", "text": "T3",
           "bbox": { "x": 1080, "y": 290, "width": 60, "height": 220 },
           "data": { "aoiType": "bar", "value": "42" }, "css_selector": "rect.bar.bar-q3" },
  "viz_state": { "active_view": "bar", "dataset": "ventes_trimestrielles",
                 "current_aoi": "bar-q3", "zoom": 1, "filters": [] }
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `x`, `y` | number | Coordonnées écran corrigées (px). |
| `raw_x`, `raw_y` | number | Coordonnées brutes avant correction. |
| `timestamp` / `t_rel_ms` | number | Horloges epoch / monotone. |
| `confidence` | number | Confiance de la prédiction ∈ [0,1]. |
| `source_module` | string | `webgazer` ou `mediapipe`. |
| `dom` | object | Descripteur de l'objet DOM observé (cf. §6bis). |
| `viz_state` | object | État de la visualisation au moment du regard (cf. §6ter). |

### 3bis. Descripteur DOM (`dom`)

Identifie précisément l'objet regardé (barre, axe, point, légende…) :
`tag`, `id`, `classes`, **`semantic_type`** (bar/axis/legend/point/line/label),
`bbox`, `text`, `aria_label`, `data` (attributs `data-*`), `css_selector`.
Produit par `GazeLogger.describeDom(element)`.

### 3ter. État de la visualisation (`viz_state` et section `viz_states`)

`active_view` (bar/line/scatter), `dataset`, `gaze_mode`, `current_aoi`,
`selection`, `zoom`, `filters`, `n_aois`, `viewport`. Chaque point de regard et
chaque hit AOI porte un instantané ; la section `viz_states[]` journalise en plus
chaque changement d'état (changement d'onglet…) avec horodatage.

---

## 4. `events` — fixations et saccades

Produits par post-traitement (`Calibration.detectFixations` / `detectSaccades`).

```json
{
  "type": "fixation",
  "start_time": 1750599611000,
  "end_time":   1750599611280,
  "duration":   280,
  "details": { "x": 810, "y": 440, "points_count": 8 }
}
```

| `type` | `details` |
|--------|-----------|
| `fixation` | `{ x, y, points_count }` — centroïde et nombre de points. |
| `saccade`  | `{ start_x, start_y, end_x, end_y, amplitude, peak_velocity }`. |

---

## 5. `aoi_hits` — zones d'intérêt

Fixation tombant dans une *Area Of Interest* d'une visualisation.

```json
{ "aoi_id": "bar-q3", "aoi_label": "T3 — 2024", "event_index": 12, "timestamp": …, "t_rel_ms": … }
```

`event_index` référence l'index dans `events[]` de la fixation concernée.

---

## 6. `interactions` — données multimodales

Journal des interactions utilisateur, complément du regard pour reconstituer
l'activité analytique.

```json
{ "type": "tab_change", "details": { "tab": "tab-linechart" }, "timestamp": …, "t_rel_ms": 8100.0 }
```

Types émis par le prototype :

| `type` | `details` | Sens |
|--------|-----------|------|
| `session_start` | `{ source }` | Démarrage de la capture. |
| `session_stop`  | `{ source }` | Arrêt de la capture. |
| `tab_change`    | `{ tab }` | Changement de visualisation. |
| `gaze_enter_aoi`| `{ aoi_id, x, y }` | Le regard entre dans une AOI. |
| `export`        | `{ formats }` | Export déclenché. |

Le type est libre : `logInteraction(type, details)` accepte n'importe quel `type`.

---

## 7. Export JSON-LD (graphe de connaissances)

`GazeLogger.exportJsonLd()` produit un document `@context` + `@graph` où chaque entité
devient un nœud typé sous le vocabulaire `wga:`
(`https://i3s.unice.fr/activity-tracker/vocab#`).

```json
{
  "@context": { "wga": "https://i3s.unice.fr/activity-tracker/vocab#", … },
  "@graph": [
    { "@id": "urn:wga:session:3f29…", "@type": "wga:Session",
      "wga:participant": { "@id": "urn:wga:participant:P01" }, … },
    { "@id": "urn:wga:session:3f29…:fixation:0", "@type": "wga:Fixation",
      "wga:inSession": { "@id": "urn:wga:session:3f29…" },
      "wga:duration": 280, "wga:x": 810, "wga:y": 440 },
    …
  ]
}
```

Types : `wga:Session`, `wga:Participant`, `wga:Fixation`, `wga:Saccade`, `wga:GazeEvent`,
`wga:AOIHit`, `wga:Interaction`. Ce format se charge directement dans un triple store
(RDF) pour alimenter le graphe de connaissances de l'Activity Tracker.

---

## 8. Validation

Le JSON tabulaire est validable contre le schéma, par exemple avec
[ajv-cli](https://github.com/ajv-validator/ajv-cli) :

```bash
npx ajv-cli validate -s schema/session.schema.json -d "data/session_*.json"
```
