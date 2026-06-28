/**
 * participant-form.js — Formulaire participant partagé entre les deux moteurs.
 *
 * Champs : correction visuelle + luminosité ambiante (auto-renseignée si disponible).
 * Aucun nom ni prénom. L'ID est généré, affiché en grand, et noté par le participant.
 *
 * API :
 *   ParticipantForm.show(opts)
 *     opts.accentColor  {string}    couleur d'accent CSS (défaut '#4ecdc4')
 *     opts.engine       {string}    'webgazer' | 'mediapipe'
 *     opts.lux          {number}    luminosité mesurée (lux) — pré-remplit le champ
 *     opts.onDone       {function}  callback(data)
 *
 *   data retourné :
 *     { participant_id, glasses, lighting, date, engine, screen_resolution }
 */
(function (global) {
  'use strict';

  var _INP =
    'width:100%;background:#0d1b2a;border:1px solid #2c3e50;border-radius:8px;color:#eee;'
    + 'padding:9px 12px;box-sizing:border-box;font-size:.93rem;outline:none;font-family:inherit;'
    + 'transition:border-color .2s;';

  function _genId() {
    var now = new Date();
    var d = now.getFullYear().toString()
      + ('0' + (now.getMonth() + 1)).slice(-2)
      + ('0' + now.getDate()).slice(-2);
    // 6 chars alphanumériques pour garantir l'unicité en session de labo
    var rand = '';
    while (rand.length < 6) rand += Math.random().toString(36).slice(2).toUpperCase();
    return 'P-' + d + '-' + rand.slice(0, 6);
  }

  function show(opts) {
    opts = opts || {};
    var accent = opts.accentColor || '#4ecdc4';
    var engine = opts.engine || null;
    var luxHint = (opts.lux != null) ? Math.round(opts.lux) : null;
    var id = _genId();

    var engineBadge = engine
      ? '<span style="font-size:.72rem;background:rgba(78,205,196,.12);border:1px solid rgba(78,205,196,.2);'
        + 'border-radius:999px;padding:2px 10px;color:' + accent + ';margin-left:8px;font-weight:600;">'
        + engine + '</span>'
      : '';

    var overlay = document.createElement('div');
    overlay.id = 'pf-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99000;'
      + 'display:flex;align-items:center;justify-content:center;'
      + 'font-family:"Segoe UI",Arial,sans-serif;';

    overlay.innerHTML =
      '<div style="background:#16213e;border-radius:16px;padding:32px 36px;width:90%;max-width:420px;'
      + 'color:#eee;box-shadow:0 20px 60px rgba(0,0,0,.6);">'

      // En-tête
      + '<h3 style="margin:0 0 4px;font-size:1.1rem;display:flex;align-items:center;">'
      + '<span style="color:' + accent + ';">Informations participant</span>' + engineBadge
      + '</h3>'
      + '<p style="margin:0 0 20px;color:#9aa6c0;font-size:.81rem;line-height:1.5;">'
      + 'Notez votre identifiant avant de continuer — il sera utilisé pour retrouver vos données.</p>'

      // ID — affiché en grand, copier visuellement
      + '<div style="background:#0a1628;border:2px solid ' + accent + ';border-radius:10px;'
      + 'padding:14px 18px;margin-bottom:22px;text-align:center;">'
      + '<div style="font-size:.72rem;color:#9aa6c0;margin-bottom:4px;letter-spacing:.05em;text-transform:uppercase;">Votre identifiant</div>'
      + '<div id="pf-id-display" style="font-family:monospace;font-size:1.55rem;color:' + accent + ';'
      + 'font-weight:800;letter-spacing:.12em;">' + id + '</div>'
      + '</div>'

      // Correction visuelle
      + '<div style="margin-bottom:14px;">'
      + '<label style="display:block;font-size:.8rem;color:#9aa6c0;margin-bottom:5px;">Correction visuelle</label>'
      + '<select id="pf-glasses" style="' + _INP + '">'
      + '<option value="non">Aucune</option>'
      + '<option value="lunettes">Lunettes</option>'
      + '<option value="lentilles">Lentilles</option>'
      + '</select>'
      + '</div>'

      // Luminosité
      + '<div style="margin-bottom:22px;">'
      + '<label style="display:block;font-size:.8rem;color:#9aa6c0;margin-bottom:5px;">'
      + 'Luminosité ambiante'
      + (luxHint != null ? ' <span style="color:' + accent + ';font-size:.75rem;">(mesurée : ' + luxHint + ' lux)</span>' : '')
      + '</label>'
      + '<select id="pf-lighting" style="' + _INP + '">'
      + '<option value="faible">Faible — store fermé / lampe de bureau</option>'
      + '<option value="normale" selected>Normale — bureau éclairé</option>'
      + '<option value="forte">Forte — lumière naturelle directe</option>'
      + '</select>'
      + '</div>'

      // Bouton
      + '<button id="pf-go" style="width:100%;background:' + accent + ';color:#0f0f1a;border:none;'
      + 'border-radius:8px;padding:12px;font-weight:700;font-size:.98rem;cursor:pointer;'
      + 'transition:opacity .15s;">Commencer →</button>'

      + '</div>';

    document.body.appendChild(overlay);

    setTimeout(function () {
      var el = document.getElementById('pf-glasses');
      if (el) el.focus();
    }, 60);

    function _submit() {
      overlay.remove();
      if (opts.onDone) {
        opts.onDone({
          participant_id:    id,
          glasses:           document.getElementById('pf-glasses').value,
          lighting:          document.getElementById('pf-lighting').value,
          lux_measured:      luxHint,
          date:              new Date().toISOString().slice(0, 10),
          engine:            engine || null,
          screen_resolution: (typeof screen !== 'undefined')
            ? screen.width + 'x' + screen.height : null,
        });
      }
    }

    document.getElementById('pf-go').addEventListener('click', _submit);

    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') _submit();
    });

    ['pf-glasses', 'pf-lighting'].forEach(function (fid) {
      var el = document.getElementById(fid);
      if (!el) return;
      el.addEventListener('focus', function () { this.style.borderColor = accent; });
      el.addEventListener('blur',  function () { this.style.borderColor = '#2c3e50'; });
    });
  }

  global.ParticipantForm = { show: show };

})(typeof window !== 'undefined' ? window : global);
