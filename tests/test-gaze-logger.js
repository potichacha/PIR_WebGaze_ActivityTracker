/**
 * test-gaze-logger.js — Tests unitaires pour gaze-logger.js (US-3.1 + multimodal)
 * Exécution : node tests/test-gaze-logger.js
 */
'use strict';

// ── Stubs navigateur ──────────────────────────────────────────────────────────
global.window = global;
global.window.innerWidth  = 1920;
global.window.innerHeight = 1080;
global.window.devicePixelRatio = 1;
global.window.addEventListener = () => {};
let _perf = 0;
global.performance = { now: () => (_perf += 5) };
try {
  Object.defineProperty(global, 'navigator', {
    value: { userAgent: 'Test/1.0' }, writable: true, configurable: true,
  });
} catch (_) {}

require('../src/logger/gaze-logger.js');
const Logger = global.GazeLogger;

// ── Utilitaires de test ─────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓  ${msg}`); passed++; }
  else       { console.error(`  ✗  ${msg}`); failed++; }
}
function section(name) { console.log(`\n── ${name} ──`); }

// ─────────────────────────────────────────────────────────────────────────────
section('Test 1 : API publique');
['init','logRawPoint','logEvent','logAOIHit','logInteraction','export',
 'exportJsonLd','download','downloadJsonLd','clear','getStats','isInitialized']
  .forEach(m => assert(typeof Logger[m] === 'function', `GazeLogger.${m} est une fonction`));
assert(typeof Logger.FORMAT_VERSION === 'string', 'FORMAT_VERSION défini');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 2 : init / isInitialized');
assert(Logger.isInitialized() === false, 'Non initialisé avant init()');
Logger.init('P01', { mean_error_px: 90, std_error_px: 20 });
assert(Logger.isInitialized() === true, 'Initialisé après init()');
const exp0 = Logger.export();
assert(exp0.session.participant_id === 'P01', 'participant_id enregistré');
assert(exp0.session.format_version === Logger.FORMAT_VERSION, 'format_version dans la session');
assert(typeof exp0.session.clock_origin_ms === 'number', 'clock_origin_ms présent (horloge monotone)');
assert(exp0.session.calibration_score.mean_error_px === 90, 'calibration_score transmis');
assert(Array.isArray(exp0.interactions), 'section interactions présente');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 3 : logRawPoint + double horloge');
Logger.logRawPoint(100.6, 200.4, 1700000000000);
const raw = Logger.export().raw_gaze_data;
assert(raw.length === 1, '1 point brut enregistré');
assert(raw[0].x === 101 && raw[0].y === 200, 'Coordonnées arrondies');
assert(raw[0].timestamp === 1700000000000, 'timestamp epoch conservé');
assert(typeof raw[0].t_rel_ms === 'number', 't_rel_ms (monotone) présent');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 4 : logInteraction (multimodal)');
Logger.logInteraction('tab_change', { tab: 'tab-linechart' });
Logger.logInteraction('gaze_enter_aoi', { aoi_id: 'bar-q3' });
const inter = Logger.export().interactions;
assert(inter.length === 2, '2 interactions enregistrées');
assert(inter[0].type === 'tab_change', 'type correct');
assert(inter[0].details.tab === 'tab-linechart', 'details préservés');
assert(typeof inter[0].t_rel_ms === 'number', 't_rel_ms sur interaction');
Logger.logInteraction(); // sans type → 'unknown'
assert(Logger.export().interactions[2].type === 'unknown', 'logInteraction sans type → unknown');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 5 : logEvent / logAOIHit');
Logger.logEvent({ type: 'fixation', start_time: 0, end_time: 280, duration: 280, details: { x: 810, y: 440 } });
Logger.logEvent({ type: 'saccade', start_time: 280, end_time: 320, duration: 40, details: { amplitude: 500 } });
Logger.logAOIHit('bar-q3', 'T3', 0, 1700000000500);
const e = Logger.export();
assert(e.events.length === 2, '2 événements');
assert(e.events[0].type === 'fixation', '1er événement = fixation');
assert(e.aoi_hits.length === 1, '1 hit AOI');
assert(e.aoi_hits[0].event_index === 0, 'event_index correct');
assert(typeof e.aoi_hits[0].t_rel_ms === 'number', 't_rel_ms sur hit AOI');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 6 : getStats');
const stats = Logger.getStats();
assert(stats.rawPoints === 1, 'getStats.rawPoints');
assert(stats.fixations === 1, 'getStats.fixations');
assert(stats.saccades === 1, 'getStats.saccades');
assert(stats.aoiHits === 1, 'getStats.aoiHits');
assert(stats.interactions === 3, 'getStats.interactions');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 7 : export JSON-LD (graphe de connaissances)');
const ld = Logger.exportJsonLd();
assert(ld['@context'] && ld['@graph'], 'Structure @context + @graph');
assert(Array.isArray(ld['@graph']), '@graph est un tableau');
const types = ld['@graph'].map(n => n['@type']);
assert(types.includes('wga:Session'), 'Nœud wga:Session présent');
assert(types.includes('wga:Participant'), 'Nœud wga:Participant présent');
assert(types.includes('wga:Fixation'), 'Nœud wga:Fixation présent');
assert(types.includes('wga:Saccade'), 'Nœud wga:Saccade présent');
assert(types.includes('wga:AOIHit'), 'Nœud wga:AOIHit présent');
assert(types.includes('wga:Interaction'), 'Nœud wga:Interaction présent');
const sessionNode = ld['@graph'].find(n => n['@type'] === 'wga:Session');
assert(sessionNode['wga:participant']['@id'].indexOf('P01') !== -1, 'Session liée au participant');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 8 : clear');
Logger.clear();
assert(Logger.isInitialized() === false, 'clear() réinitialise la session');
const empty = Logger.export();
assert(empty.raw_gaze_data.length === 0, 'raw_gaze_data vidé');
assert(empty.interactions.length === 0, 'interactions vidées');
assert(empty.session.participant_id === 'anonymous', 'Session fallback anonyme après clear');

// ─────────────────────────────────────────────────────────────────────────────
section('Test 9 : robustesse — appels sans session');
Logger.clear();
Logger.logRawPoint(1, 2, 3);          // ne doit rien casser
Logger.logInteraction('x', {});
Logger.logEvent({ type: 'fixation' });
assert(Logger.export().raw_gaze_data.length === 0, 'logRawPoint sans session ignoré');
assert(Logger.export().interactions.length === 0, 'logInteraction sans session ignoré');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════');
console.log(`  Résultats : ${passed} ✓ réussis / ${failed} ✗ échoués`);
console.log('══════════════════════════════════════════════════════\n');
if (failed > 0) process.exit(1);
else { console.log('  Tous les tests GazeLogger passent.\n'); process.exit(0); }
