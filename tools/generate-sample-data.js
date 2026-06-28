/**
 * generate-sample-data.js
 *
 * Génère des jeux de données d'exemple (livrable L3). Le script produit des
 * sessions synthétiques mais réalistes : un parcours de regard plausible (des
 * fixations sur des AOI, des saccades de transition et du bruit webcam) est
 * simulé, puis passé dans les vrais algorithmes de post-traitement (I-DT / I-VT)
 * et le vrai module de journalisation. Les fichiers produits sont donc
 * structurellement identiques à ceux d'une vraie session et conformes au schéma.
 *
 * Ces données sont simulées et ne doivent pas être confondues avec les sessions
 * réelles : le participant_id est préfixé « SIM- » et la session porte un
 * marqueur synthetic: true.
 *
 * Exécution : node tools/generate-sample-data.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

installBrowserStubs();

require('../src/calibration/calibration.js');
require('../src/logger/gaze-logger.js');
const Cal = global.Calibration;
const Logger = global.GazeLogger;

const AOIS = [
  { id: 'bar-q1', label: 'T1', x: 300,  y: 600 },
  { id: 'bar-q2', label: 'T2', x: 700,  y: 450 },
  { id: 'bar-q3', label: 'T3', x: 1100, y: 300 },
  { id: 'bar-q4', label: 'T4', x: 1500, y: 520 },
  { id: 'axis-y', label: 'Axe Y', x: 120, y: 540 },
];

const PROFILES = [
  { seed: 1001, noisePx: 18, fixations: 22 },
  { seed: 2002, noisePx: 35, fixations: 18 },
  { seed: 3003, noisePx: 60, fixations: 15 },
];

function installBrowserStubs() {
  global.window = global;
  global.window.innerWidth = 1920;
  global.window.innerHeight = 1080;
  global.window.devicePixelRatio = 1;
  global.window.addEventListener = () => {};
  try {
    Object.defineProperty(global, 'navigator', {
      value: { userAgent: 'Sample-Generator/1.0 (Node)' }, writable: true, configurable: true,
    });
  } catch (_) {}
  global.screen = { width: 1920, height: 1080 };
  global.performance = { now: (() => { let t = 0; return () => (t += 16.7); })() };

  const storeKV = {};
  global.localStorage = {
    getItem: k => storeKVOrNull(storeKV, k),
    setItem: (k, v) => { storeKV[k] = String(v); },
    removeItem: k => { delete storeKV[k]; },
  };
  global.document = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }),
    getElementById: () => null,
    head: { appendChild() {} },
    body: { appendChild() {} },
  };
}

function storeKVOrNull(store, key) {
  if (Object.prototype.hasOwnProperty.call(store, key)) {
    return store[key];
  }
  return null;
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gauss(rng, mean, sd) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function simulateGaze(rng, profile) {
  const points = [];
  let t = 0;
  const dt = 40;
  const noise = profile.noisePx;
  let prev = { x: 960, y: 540 };

  for (let i = 0; i < profile.fixations; i++) {
    const aoi = AOIS[Math.floor(rng() * AOIS.length)];

    const sacSteps = 2 + Math.floor(rng() * 2);
    for (let s = 1; s <= sacSteps; s++) {
      const a = s / sacSteps;
      points.push({
        x: prev.x + (aoi.x - prev.x) * a + gauss(rng, 0, noise),
        y: prev.y + (aoi.y - prev.y) * a + gauss(rng, 0, noise),
        timestamp: t,
      });
      t += dt;
    }

    const fixMs = 200 + Math.floor(rng() * 300);
    const nPts = Math.round(fixMs / dt);
    for (let p = 0; p < nPts; p++) {
      points.push({
        x: aoi.x + gauss(rng, 0, noise * 0.6),
        y: aoi.y + gauss(rng, 0, noise * 0.6),
        timestamp: t,
      });
      t += dt;
    }
    prev = aoi;
  }
  return points;
}

function logFixations(fixations) {
  fixations.forEach(f => Logger.logEvent({
    type: 'fixation', start_time: f.start_time, end_time: f.end_time,
    duration: f.duration, details: { x: f.x_center, y: f.y_center, points_count: f.points_count },
  }));
}

function logSaccades(saccades) {
  saccades.forEach(s => Logger.logEvent({
    type: 'saccade', start_time: s.start_time, end_time: s.end_time,
    duration: s.duration,
    details: { start_x: s.start_x, start_y: s.start_y, end_x: s.end_x, end_y: s.end_y,
               amplitude: s.amplitude, peak_velocity: s.peak_velocity },
  }));
}

function nearestAoi(fixation) {
  let best = null;
  let bestD = Infinity;
  AOIS.forEach(a => {
    const d = Math.hypot(fixation.x_center - a.x, fixation.y_center - a.y);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  });
  return { aoi: best, distance: bestD };
}

function logAoiHits(fixations) {
  fixations.forEach((f, i) => {
    const { aoi, distance } = nearestAoi(f);
    if (aoi && distance < 90) {
      Logger.logAOIHit(aoi.id, aoi.label, i, Date.now());
    }
  });
}

function buildSession(idx, profile) {
  const rng = makeRng(profile.seed);
  const pid = 'SIM-P' + String(idx).padStart(2, '0');

  Logger.clear();
  Logger.init(pid, { mean_error_px: profile.noisePx * 3.2, std_error_px: profile.noisePx });

  const gaze = simulateGaze(rng, profile);
  Logger.logInteraction('session_start', { source: 'generator' });
  gaze.forEach(p => Logger.logRawPoint(p.x, p.y, Date.now()));

  const fixations = Cal.detectFixations(gaze, 80, 100);
  const saccades = Cal.detectSaccades(gaze, 0.7);
  logFixations(fixations);
  logSaccades(saccades);
  logAoiHits(fixations);

  Logger.logInteraction('tab_change', { tab: 'tab-barchart' });
  if (fixations[3]) {
    Logger.logInteraction('gaze_enter_aoi', { aoi_id: 'bar-q3', x: 1100, y: 300 });
  }
  Logger.logInteraction('session_stop', { source: 'generator' });

  const json = Logger.export();
  json.session.synthetic = true;
  json.session.note = 'Données simulées (generate-sample-data.js) — non issues d\'un participant réel.';
  const jsonld = Logger.exportJsonLd();
  return { pid, json, jsonld, stats: Logger.getStats() };
}

function main() {
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  const summary = [];
  PROFILES.forEach((profile, i) => {
    const { pid, json, jsonld, stats } = buildSession(i + 1, profile);
    const base = 'session_' + pid + '_2026-06-22';
    fs.writeFileSync(path.join(outDir, base + '.json'), JSON.stringify(json, null, 2));
    fs.writeFileSync(path.join(outDir, base + '.jsonld'), JSON.stringify(jsonld, null, 2));
    summary.push({ pid, ...stats, noisePx: profile.noisePx });
    console.log(`✓ ${base}.json / .jsonld  —  ${stats.rawPoints} pts, ${stats.fixations} fix, ${stats.saccades} sacc, ${stats.aoiHits} AOI`);
  });

  console.log('\nRésumé :');
  console.table(summary);
  console.log(`\nFichiers écrits dans ${outDir}`);
}

main();
