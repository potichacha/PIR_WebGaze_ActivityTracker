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

// ─────────────────────────────────────────────────────────────────────────────
section('Test 10 : point de regard enrichi (confiance, module, DOM, viz_state)');
Logger.clear();
Logger.init('P02', null);
Logger.setModule('webgazer');
assert(Logger.getModule() === 'webgazer', 'setModule/getModule');
const fakeEl = {
  nodeType: 1, tagName: 'rect', id: '', classList: ['bar', 'bar-q3'],
  dataset: { aoiType: 'bar', value: '42' },
  getBoundingClientRect: () => ({ left: 10, top: 20, width: 30, height: 40 }),
  textContent: 'T3', getAttribute: () => null, parentElement: null,
};
const dom = Logger.describeDom(fakeEl);
assert(dom.semantic_type === 'bar', 'describeDom : type sémantique = bar');
assert(dom.text === 'T3', 'describeDom : texte capturé');
assert(dom.data.value === '42', 'describeDom : data-* capturés');
assert(dom.bbox.width === 30, 'describeDom : bbox capturée');
assert(dom.css_selector === 'rect.bar.bar-q3', 'describeDom : sélecteur CSS');
assert(Logger.describeDom(null) === null, 'describeDom(null) → null');

const vs = { active_view: 'bar', dataset: 'd1', zoom: 1, current_aoi: 'bar-q3' };
Logger.logRawPoint(500, 300, 1700, { confidence: 0.87, source_module: 'webgazer', raw_x: 480, raw_y: 310, dom: dom, viz_state: vs });
const rp = Logger.export().raw_gaze_data[0];
assert(rp.confidence === 0.87, 'confidence loguée');
assert(rp.source_module === 'webgazer', 'source_module logué');
assert(rp.raw_x === 480 && rp.raw_y === 310, 'coordonnées brutes loguées');
assert(rp.dom && rp.dom.semantic_type === 'bar', 'DOM attaché au point');
assert(rp.viz_state && rp.viz_state.active_view === 'bar', 'viz_state attaché au point');
// source_module par défaut
Logger.logRawPoint(1, 1, 2);
assert(Logger.export().raw_gaze_data[1].source_module === 'webgazer', 'source_module par défaut = module courant');

section('Test 11 : logVizState + section viz_states');
Logger.logVizState({ active_view: 'line', dataset: 'temp' });
const exp = Logger.export();
assert(Array.isArray(exp.viz_states), 'section viz_states présente');
assert(exp.viz_states.length === 1, 'un état de visu enregistré');
assert(exp.viz_states[0].state.active_view === 'line', 'état correct');
assert(Logger.getCurrentVizState().active_view === 'line', 'getCurrentVizState');

section('Test 12 : AOI hit enrichi (DOM + viz_state)');
Logger.logAOIHit('bar-q3', 'T3', 0, 1700, { source_module: 'post_processing', dom: dom, viz_state: vs });
const hit = Logger.export().aoi_hits[0];
assert(hit.source_module === 'post_processing', 'AOI hit : source_module');
assert(hit.dom.semantic_type === 'bar', 'AOI hit : DOM attaché');
assert(hit.viz_state.active_view === 'bar', 'AOI hit : viz_state attaché');

section('Test 13 : confiance moyenne dans getStats');
const stats2 = Logger.getStats();
assert(typeof stats2.meanConfidence === 'number', 'getStats.meanConfidence calculée');
assert(stats2.vizStates === 1, 'getStats.vizStates');

section('Test 14 : format_version courant');
assert(Logger.FORMAT_VERSION === '1.3.0', 'FORMAT_VERSION = 1.3.0');

section('Test 15 : export CSV');
Logger.clear();
Logger.init('P03', null);
Logger.setModule('mediapipe');
Logger.logRawPoint(100, 200, 1700, { confidence: 0.9, source_module: 'mediapipe',
  dom: { semantic_type: 'bar', text: 'T3', id: 'b1' }, viz_state: { active_view: 'bar', dataset: 'd', current_aoi: 'bar-q3' } });
Logger.logRawPoint(150, 250, 1701, { confidence: 0.4 });
const csv = Logger.exportCsv();
const rows = csv.split('\n');
assert(rows.length === 3, 'CSV : entête + 2 lignes');
assert(rows[0].indexOf('confidence') !== -1 && rows[0].indexOf('source_module') !== -1, 'entête contient les colonnes clés');
assert(rows[1].indexOf('bar') !== -1 && rows[1].indexOf('0.9') !== -1, 'ligne 1 : DOM + confiance');
// Échappement CSV des valeurs à virgule/guillemet
Logger.logRawPoint(1, 1, 1, { dom: { semantic_type: 'label', text: 'a,b "c"' } });
const csv2 = Logger.exportCsv();
assert(csv2.indexOf('"a,b ""c"""') !== -1, 'échappement CSV des caractères spéciaux');

section('Test 16 : confidenceColor');
assert(/^rgb\(231,76,60\)$/.test(Logger.confidenceColor(0)), 'confiance 0 → rouge');
assert(/^rgb\(39,174,96\)$/.test(Logger.confidenceColor(1)), 'confiance 1 → vert');
assert(/^rgb\(230,126,34\)$/.test(Logger.confidenceColor(0.5)), 'confiance 0.5 → orange');
assert(/^rgb\(/.test(Logger.confidenceColor(null)), 'valeur nulle → couleur neutre valide');

section('Test 17 : v1.3 — lux, contexte test, participant');
assert(Logger.FORMAT_VERSION === '1.3.0', 'FORMAT_VERSION = 1.3.0');
Logger.clear();
Logger.init('p1', { mean_error_px: 88 }, { first_name: 'Léa', last_name: 'Dupont', glasses: 'non', engine: 'webgazer' });
var sess = Logger.export().session;
assert(sess.first_name === 'Léa' && sess.last_name === 'Dupont', 'prénom/nom dans la session');
assert(sess.glasses === 'non', 'lunettes dans la session');
assert(sess.engine === 'webgazer', 'moteur dans la session');
Logger.setLux(420);
assert(Logger.getLux() === 420, 'setLux/getLux');
Logger.setTestContext('tc-2', 'point-3');
Logger.logRawPoint(50, 60, 100);
var p = Logger.export().raw_gaze_data[0];
assert(p.lux === 420, 'lux injecté dans le point');
assert(p.test_case_id === 'tc-2', 'test_case_id injecté');
assert(p.target_aoi_id === 'point-3', 'target_aoi_id injecté');
Logger.clearTestContext();
Logger.logRawPoint(1, 1, 2);
var p2 = Logger.export().raw_gaze_data[1];
assert(p2.test_case_id === undefined, 'contexte test effacé après clearTestContext');
assert(p2.lux === 420, 'lux toujours présent hors contexte test');
// lux explicite dans meta prioritaire
Logger.logRawPoint(2, 2, 3, { lux: 99 });
assert(Logger.export().raw_gaze_data[2].lux === 99, 'lux du meta prioritaire');
// CSV contient les nouvelles colonnes
assert(Logger.exportCsv().split('\n')[0].indexOf('lux') !== -1, 'CSV contient colonne lux');
assert(Logger.exportCsv().split('\n')[0].indexOf('test_case_id') !== -1, 'CSV contient colonne test_case_id');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════');
console.log(`  Résultats : ${passed} ✓ réussis / ${failed} ✗ échoués`);
console.log('══════════════════════════════════════════════════════\n');
if (failed > 0) process.exit(1);
else { console.log('  Tous les tests GazeLogger passent.\n'); process.exit(0); }
