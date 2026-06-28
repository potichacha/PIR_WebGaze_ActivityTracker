/**
 * participant-form.js
 *
 * Formulaire participant partagé entre les deux moteurs de suivi du regard.
 * Il ne demande aucun nom ni prénom : un identifiant est généré automatiquement,
 * affiché en grand pour que le participant le note, puis renvoyé à l'appelant.
 *
 * Les champs collectés sont la correction visuelle et la luminosité ambiante
 * (pré-remplie lorsqu'une mesure en lux est fournie).
 *
 * Structure HTML : le module clone l'élément <template id="pf-modal"> présent
 * dans la page hôte. Les valeurs dynamiques (couleur d'accent, identifiant,
 * moteur, mesure en lux) sont injectées via textContent et la propriété CSS
 * personnalisée --pf-accent — aucune chaîne HTML n'est construite en JS.
 * Les styles statiques proviennent de participant-form.css.
 *
 * API publique :
 *   ParticipantForm.show(opts)
 *     opts.accentColor  {string}    couleur d'accent CSS (défaut '#4ecdc4')
 *     opts.engine       {string}    'webgazer' | 'mediapipe'
 *     opts.lux          {number}    luminosité mesurée (lux), pré-remplit l'info
 *     opts.onDone       {function}  callback(data)
 *
 *   data renvoyé :
 *     { participant_id, glasses, lighting, lux_measured, date, engine, screen_resolution }
 */
(function (global) {
  'use strict';

  function padTwoDigits(value) {
    return ('0' + value).slice(-2);
  }

  function todayCompact() {
    var now = new Date();
    return now.getFullYear().toString()
      + padTwoDigits(now.getMonth() + 1)
      + padTwoDigits(now.getDate());
  }

  function randomSuffix() {
    var suffix = '';
    while (suffix.length < 6) {
      suffix += Math.random().toString(36).slice(2).toUpperCase();
    }
    return suffix.slice(0, 6);
  }

  function generateId() {
    return 'P-' + todayCompact() + '-' + randomSuffix();
  }

  function roundedLuxHint(opts) {
    if (opts.lux == null) {
      return null;
    }
    return Math.round(opts.lux);
  }

  function screenResolution() {
    if (typeof screen === 'undefined') {
      return null;
    }
    return screen.width + 'x' + screen.height;
  }

  function buildOverlayFromTemplate(id, accent, engine, luxHint) {
    var tmpl = document.getElementById('pf-modal');
    var overlay = tmpl.content.cloneNode(true).firstElementChild;

    overlay.style.setProperty('--pf-accent', accent);

    overlay.querySelector('#pf-id-display').textContent = id;

    var badge = overlay.querySelector('.pf-engine-badge');
    if (engine) {
      badge.textContent = engine;
    } else {
      badge.style.display = 'none';
    }

    var luxNote = overlay.querySelector('.pf-lux-note');
    if (luxHint != null) {
      luxNote.textContent = '(mesurée : ' + luxHint + ' lux)';
    } else {
      luxNote.style.display = 'none';
    }

    return overlay;
  }

  function buildOverlayFromDOM(id, accent, engine, luxHint) {
    var overlay = document.createElement('div');
    overlay.id = 'pf-overlay';
    overlay.style.setProperty('--pf-accent', accent);

    var card = document.createElement('div');
    card.className = 'pf-card';

    var title = document.createElement('h3');
    title.className = 'pf-title';

    var titleText = document.createElement('span');
    titleText.className = 'pf-title-text';
    titleText.textContent = 'Informations participant';
    title.appendChild(titleText);

    if (engine) {
      var badge = document.createElement('span');
      badge.className = 'pf-engine-badge';
      badge.textContent = engine;
      title.appendChild(badge);
    }

    var hint = document.createElement('p');
    hint.className = 'pf-hint';
    hint.textContent = 'Notez votre identifiant avant de continuer — il sera utilisé pour retrouver vos données.';

    var idBox = document.createElement('div');
    idBox.className = 'pf-id-box';

    var idLabel = document.createElement('div');
    idLabel.className = 'pf-id-label';
    idLabel.textContent = 'Votre identifiant';

    var idDisplay = document.createElement('div');
    idDisplay.id = 'pf-id-display';
    idDisplay.textContent = id;

    idBox.appendChild(idLabel);
    idBox.appendChild(idDisplay);

    var glassesField = document.createElement('div');
    glassesField.className = 'pf-field';

    var glassesLabel = document.createElement('label');
    glassesLabel.className = 'pf-label';
    glassesLabel.htmlFor = 'pf-glasses';
    glassesLabel.textContent = 'Correction visuelle';

    var glassesSelect = document.createElement('select');
    glassesSelect.id = 'pf-glasses';
    glassesSelect.className = 'pf-select';
    [['non', 'Aucune'], ['lunettes', 'Lunettes'], ['lentilles', 'Lentilles']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      glassesSelect.appendChild(opt);
    });

    glassesField.appendChild(glassesLabel);
    glassesField.appendChild(glassesSelect);

    var lightingField = document.createElement('div');
    lightingField.className = 'pf-field pf-field--last';

    var lightingLabel = document.createElement('label');
    lightingLabel.className = 'pf-label';
    lightingLabel.htmlFor = 'pf-lighting';
    lightingLabel.textContent = 'Luminosité ambiante';

    if (luxHint != null) {
      var luxNote = document.createElement('span');
      luxNote.className = 'pf-lux-note';
      luxNote.textContent = ' (mesurée : ' + luxHint + ' lux)';
      lightingLabel.appendChild(luxNote);
    }

    var lightingSelect = document.createElement('select');
    lightingSelect.id = 'pf-lighting';
    lightingSelect.className = 'pf-select';
    [
      ['faible',   'Faible — store fermé / lampe de bureau'],
      ['normale',  'Normale — bureau éclairé'],
      ['forte',    'Forte — lumière naturelle directe'],
    ].forEach(function (pair, i) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      if (i === 1) {
        opt.selected = true;
      }
      lightingSelect.appendChild(opt);
    });

    lightingField.appendChild(lightingLabel);
    lightingField.appendChild(lightingSelect);

    var submit = document.createElement('button');
    submit.id = 'pf-go';
    submit.className = 'pf-submit';
    submit.textContent = 'Commencer →';

    card.appendChild(title);
    card.appendChild(hint);
    card.appendChild(idBox);
    card.appendChild(glassesField);
    card.appendChild(lightingField);
    card.appendChild(submit);
    overlay.appendChild(card);

    return overlay;
  }

  function createOverlay(id, accent, engine, luxHint) {
    if (typeof document !== 'undefined' && document.getElementById('pf-modal')) {
      return buildOverlayFromTemplate(id, accent, engine, luxHint);
    }
    return buildOverlayFromDOM(id, accent, engine, luxHint);
  }

  function focusFirstField() {
    setTimeout(function () {
      var el = document.getElementById('pf-glasses');
      if (el) {
        el.focus();
      }
    }, 60);
  }

  function collectData(id, engine, luxHint) {
    return {
      participant_id:    id,
      glasses:           document.getElementById('pf-glasses').value,
      lighting:          document.getElementById('pf-lighting').value,
      lux_measured:      luxHint,
      date:              new Date().toISOString().slice(0, 10),
      engine:            engine || null,
      screen_resolution: screenResolution(),
    };
  }

  function show(opts) {
    opts = opts || {};
    var accent = opts.accentColor || '#4ecdc4';
    var engine = opts.engine || null;
    var luxHint = roundedLuxHint(opts);
    var id = generateId();

    var overlay = createOverlay(id, accent, engine, luxHint);
    document.body.appendChild(overlay);
    focusFirstField();

    function submit() {
      var data = collectData(id, engine, luxHint);
      overlay.remove();
      if (opts.onDone) {
        opts.onDone(data);
      }
    }

    document.getElementById('pf-go').addEventListener('click', submit);
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        submit();
      }
    });
  }

  global.ParticipantForm = { show: show };

})(typeof window !== 'undefined' ? window : global);
