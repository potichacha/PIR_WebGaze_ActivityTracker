/**
 * test-gaze-capture.js — Tests unitaires pour gaze-capture.js (US-2.1)
 * Exécution : node tests/test-gaze-capture.js
 */

'use strict';

// ── Stubs navigateur ──────────────────────────────────────────────────────────
global.window = global;
global.window.addEventListener = () => {};

// WebGazer stub complet
let gazeListener = null;
let webgazerStarted = false;
let webgazerEnded   = false;
let mouseListenersRemoved = false;
let webgazerError = null;

global.webgazer = {
  setGazeListener(fn)          { gazeListener = fn; return this; },
  clearGazeListener()          { gazeListener = null; return this; },
  removeMouseEventListeners()  { mouseListenersRemoved = true; return this; },
  begin()                      {
    webgazerStarted = true;
    if (webgazerError) return Promise.reject(webgazerError);
    return Promise.resolve(this);
  },
  end()                        { webgazerEnded = true; return this; },
  showVideo()                  { return this; },
  showFaceOverlay()            { return this; },
  showFaceFeedbackBox()        { return this; },
  showPredictionPoints()       { return this; },
};

// navigator.mediaDevices stub (succès par défaut)
let mediaDevicesGranted = true;
try {
  Object.defineProperty(global, 'navigator', {
    value: {
      mediaDevices: {
        getUserMedia(constraints) {
          if (!mediaDevicesGranted) {
            const err = new Error('Permission denied');
            err.name = 'NotAllowedError';
            return Promise.reject(err);
          }
          return Promise.resolve({ tracks: [], getTracks: () => [{ stop: () => {} }] });
        },
      },
    },
    writable: true, configurable: true,
  });
} catch (_) {}

global.document = {
  getElementById: () => null,
  createElement:  (tag) => ({
    style: { cssText: '' }, id: '', innerHTML: '', textContent: '',
    appendChild: () => {}, setAttribute: () => {},
  }),
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
};

// Charger le module
require('../src/gaze-capture/gaze-capture.js');

// ── Utilitaires de test ───────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓  ${msg}`); passed++; }
  else       { console.error(`  ✗  ${msg}`); failed++; }
}
function section(name) { console.log(`\n── ${name} ──`); }

function resetWebgazerState() {
  webgazerStarted = false;
  webgazerEnded   = false;
  mouseListenersRemoved = false;
  gazeListener    = null;
  webgazerError   = null;
  mediaDevicesGranted = true;
  GazeCapture.clearRawData();
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — API publique
// ─────────────────────────────────────────────────────────────────────────────
section('Test 1 : API publique exposée');
assert(typeof GazeCapture === 'object',             'GazeCapture est un objet global');
assert(typeof GazeCapture.start === 'function',     'GazeCapture.start est une fonction');
assert(typeof GazeCapture.stop === 'function',      'GazeCapture.stop est une fonction');
assert(typeof GazeCapture.onGazeData === 'function','GazeCapture.onGazeData est une fonction');
assert(typeof GazeCapture.offGazeData === 'function','GazeCapture.offGazeData est une fonction');
assert(typeof GazeCapture.getStatus === 'function', 'GazeCapture.getStatus est une fonction');
assert(typeof GazeCapture.getRawData === 'function','GazeCapture.getRawData est une fonction');
assert(typeof GazeCapture.clearRawData === 'function','GazeCapture.clearRawData est une fonction');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — État initial
// ─────────────────────────────────────────────────────────────────────────────
section('Test 2 : État initial');
assert(GazeCapture.getStatus() === 'idle',   'getStatus() = idle avant start()');
assert(Array.isArray(GazeCapture.getRawData()), 'getRawData() retourne un tableau');
assert(GazeCapture.getRawData().length === 0,   'getRawData() vide au départ');

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — start() en cas de succès
// ─────────────────────────────────────────────────────────────────────────────
section('Test 3 : start() — succès');
resetWebgazerState();

let startResolved = false;
GazeCapture.start().then(() => {
  startResolved = true;
}).catch(() => {});

// Vérifications synchrones (WebGazer.begin() est async mais le stub résout immédiatement)
// On utilise setImmediate pour laisser la microtask queue se vider
setImmediate(() => {
  assert(webgazerStarted,          'webgazer.begin() a été appelé');
  assert(mouseListenersRemoved,    'removeMouseEventListeners() appelé (anti-pollution modèle)');
  assert(gazeListener !== null,    'setGazeListener a été enregistré');

  setImmediate(() => {
    assert(GazeCapture.getStatus() === 'running', 'getStatus() = running après start()');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4 — Émission de données via le listener
    // ─────────────────────────────────────────────────────────────────────────
    section('Test 4 : Émission de points de regard');
    const received = [];
    GazeCapture.onGazeData(pt => received.push(pt));

    // Simuler 3 frames WebGazer
    gazeListener({ x: 100, y: 200 }, 33);
    gazeListener({ x: 300, y: 400 }, 33);
    gazeListener(null, 33);            // frame invalide — doit être ignorée
    gazeListener({ x: 500, y: 600 }, 33);

    assert(received.length === 3,          '3 points reçus (null filtré)');
    assert(received[0].x === 100,          'Point 1 x = 100');
    assert(received[0].y === 200,          'Point 1 y = 200');
    assert(Number.isFinite(received[0].timestamp), 'timestamp présent et fini');
    assert(received[2].x === 500,          'Point 3 x = 500');

    const raw = GazeCapture.getRawData();
    assert(raw.length === 3,               'getRawData() contient 3 points');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5 — offGazeData
    // ─────────────────────────────────────────────────────────────────────────
    section('Test 5 : offGazeData — désinscription callback');
    const before = received.length;
    GazeCapture.offGazeData(received.push.bind(received)); // mauvais ref → rien
    GazeCapture.offGazeData(pt => received.push(pt));      // lambda different → rien
    // Désinscription correcte
    const cb2 = pt => received.push(pt);
    GazeCapture.onGazeData(cb2);
    GazeCapture.offGazeData(cb2);
    gazeListener({ x: 700, y: 800 }, 33);
    // cb2 ne doit pas avoir reçu ce point (désinscrit), mais le premier callback oui
    assert(received.length === before + 1, 'Premier callback encore actif après offGazeData de cb2');
    assert(GazeCapture.getRawData().length === 4, 'getRawData() à 4 points');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6 — clearRawData
    // ─────────────────────────────────────────────────────────────────────────
    section('Test 6 : clearRawData');
    GazeCapture.clearRawData();
    assert(GazeCapture.getRawData().length === 0, 'getRawData() vide après clearRawData()');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7 — stop()
    // ─────────────────────────────────────────────────────────────────────────
    section('Test 7 : stop()');
    GazeCapture.stop();
    assert(webgazerEnded,                         'webgazer.end() appelé');
    assert(GazeCapture.getStatus() === 'idle',    'getStatus() = idle après stop()');
    assert(gazeListener === null,                 'gazeListener nettoyé après stop()');

    // Plus aucun callback ne doit recevoir de données après stop
    const countBefore = received.length;
    // On ne peut plus simuler via gazeListener (null), donc on vérifie juste le statut
    assert(GazeCapture.getStatus() !== 'running', 'plus en état running après stop()');

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8 — start() idempotent si déjà running
    // ─────────────────────────────────────────────────────────────────────────
    section('Test 8 : start() idempotent');
    resetWebgazerState();
    GazeCapture.start().then(() => {
      setImmediate(() => {
        const firstStarted = webgazerStarted;
        webgazerStarted = false;
        GazeCapture.start(); // second appel — ne doit pas relancer
        setImmediate(() => {
          assert(!webgazerStarted, 'start() une 2e fois ne relance pas webgazer.begin()');
          GazeCapture.stop();

          // ───────────────────────────────────────────────────────────────────
          // TEST 9 — Erreur permission refusée
          // ───────────────────────────────────────────────────────────────────
          section('Test 9 : Erreur permission webcam refusée');
          resetWebgazerState();
          mediaDevicesGranted = false;

          GazeCapture.start()
            .then(() => {
              assert(false, 'start() devrait rejeter si permission refusée');
              finalize();
            })
            .catch(err => {
              assert(GazeCapture.getStatus() === 'error',
                'getStatus() = error après refus permission');
              assert(typeof GazeCapture.getErrorMessage() === 'string',
                'getErrorMessage() retourne un string');
              assert(GazeCapture.getErrorMessage().length > 0,
                'Message d\'erreur non vide');

              // ───────────────────────────────────────────────────────────────
              // TEST 10 — getRawData retourne une copie
              // ───────────────────────────────────────────────────────────────
              section('Test 10 : getRawData retourne une copie indépendante');
              resetWebgazerState();
              mediaDevicesGranted = true;

              GazeCapture.start().then(() => {
                setImmediate(() => {
                  gazeListener({ x: 10, y: 20 }, 33);
                  const copy1 = GazeCapture.getRawData();
                  const copy2 = GazeCapture.getRawData();
                  assert(copy1 !== copy2, 'Deux appels getRawData() retournent des tableaux différents');
                  copy1.push({ x: 0, y: 0, timestamp: 0 }); // mutation de la copie
                  assert(GazeCapture.getRawData().length === 1, 'Mutation de la copie ne touche pas l\'état interne');
                  GazeCapture.stop();
                  finalize();
                });
              });
            });
        });
      });
    });
  });
});

function finalize() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  Résultats : ${passed} ✓ réussis / ${failed} ✗ échoués`);
  console.log('══════════════════════════════════════════════════════\n');
  if (failed > 0) process.exit(1);
  else { console.log('  Tous les tests GazeCapture passent.\n'); process.exit(0); }
}
