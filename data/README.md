# Jeux de données d'exemple

Sessions exportées au format du tracker (livrable L3).

| Fichier | Contenu |
|---------|---------|
| `session_SIM-P0X_*.json`   | Session au format JSON tabulaire (conforme à [`schema/session.schema.json`](../schema/session.schema.json)). |
| `session_SIM-P0X_*.jsonld` | Même session au format JSON-LD (graphe de connaissances). |

## ⚠️ Données simulées

Ces fichiers sont **générés** par [`tools/generate-sample-data.js`](../tools/generate-sample-data.js)
à des fins de démonstration du format et de la chaîne de post-traitement. Ils ne
proviennent **pas** de participants réels : `session.synthetic = true`, et les identifiants
sont préfixés `SIM-`.

Les **sessions réelles** collectées lors des tests utilisateurs (tâche T5) seront ajoutées
ici sous des identifiants `P01`, `P02`, … (sans préfixe `SIM-`).

## Régénérer

```bash
node tools/generate-sample-data.js
```

Trois profils de qualité décroissante sont simulés (bruit de 18, 35 et 60 px). On observe
que la dégradation de la qualité de calibration réduit fortement le nombre de fixations
détectables — illustration concrète d'une limite pratique de l'approche webcam.
