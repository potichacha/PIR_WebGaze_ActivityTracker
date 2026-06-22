# Rapport technique (LaTeX)

Première version du rapport technique du projet (livrable L4).

## Compiler

Avec une distribution TeX (TeX Live, MiKTeX) :

```bash
pdflatex rapport.tex
pdflatex rapport.tex   # 2e passe pour la table des matières et les références
```

Le fichier `rapport.pdf` est produit.

### Sans installation locale

Copier `rapport.tex` dans [Overleaf](https://www.overleaf.com/) (compilateur
`pdfLaTeX`, langue française gérée par `babel`). Aucune dépendance externe : seuls
des paquets standard sont utilisés.

## État

Version 1 — brouillon. Les sections T1–T4 et la validation logicielle sont
complètes. La section **T5 (évaluation utilisateur)** présente le protocole et un
cadre d'analyse ; elle doit être complétée avec les résultats des 3–5 participants
réels et, le cas échéant, des figures (distribution des erreurs de calibration,
captures d'écran).
