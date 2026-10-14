(function () {
  'use strict';

  // Service worker (application installable sur l'écran d'accueil).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    setupConfirmations();
    setupPrint();
    setupAutosaveCleanup();
    var form = document.querySelector('form.report-form');
    if (form) {
      setupSignature();
      setupPhotoPreview();
      setupAutosave(form);
      setupSubmitGuard(form);
    }
  });

  function setupConfirmations() {
    document.addEventListener('submit', function (event) {
      var form = event.target;
      var submitter = event.submitter;
      var message = (submitter && submitter.getAttribute('data-confirm')) || form.getAttribute('data-confirm');
      if (message && !window.confirm(message)) event.preventDefault();
    }, true);
  }

  function setupPrint() {
    document.querySelectorAll('[data-print]').forEach(function (button) {
      button.addEventListener('click', function () { window.print(); });
    });
  }

  function setupSubmitGuard(form) {
    // Évite les doubles envois (réseau lent sur le terrain).
    form.addEventListener('submit', function (event) {
      if (event.defaultPrevented) return;
      setTimeout(function () {
        form.querySelectorAll('button[type="submit"]').forEach(function (b) { b.disabled = true; });
      }, 0);
    });
  }

  // ----- Signature -----
  function setupSignature() {
    var canvas = document.getElementById('signature-canvas');
    var input = document.getElementById('signature');
    var existing = document.getElementById('signature-existing');
    var clear = document.getElementById('signature-clear');
    if (!canvas || !input) return;
    var ctx = canvas.getContext('2d');
    var drawing = false;
    var dirty = false;
    var last = null;

    function resize() {
      var ratio = window.devicePixelRatio || 1;
      var rect = canvas.getBoundingClientRect();
      var previous = dirty ? canvas.toDataURL() : null;
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
      if (previous) {
        var img = new Image();
        img.onload = function () { ctx.drawImage(img, 0, 0, rect.width, rect.height); };
        img.src = previous;
      }
    }

    function point(event) {
      var rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    canvas.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      if (!dirty && existing && !existing.hidden) {
        existing.hidden = true;
      }
      drawing = true;
      last = point(event);
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = '#111827';
      ctx.fill();
      dirty = true;
    });
    canvas.addEventListener('pointermove', function (event) {
      if (!drawing) return;
      event.preventDefault();
      var p = point(event);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    function end() {
      if (!drawing) return;
      drawing = false;
      input.value = canvas.toDataURL('image/png');
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    clear.addEventListener('click', function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirty = false;
      input.value = '';
      if (existing) existing.hidden = true;
    });

    resize();
    window.addEventListener('resize', resize);
  }

  // ----- Aperçu des photos sélectionnées -----
  function setupPhotoPreview() {
    var input = document.getElementById('photos');
    var preview = document.getElementById('photos-preview');
    var info = document.getElementById('photos-info');
    if (!input || !preview) return;
    input.addEventListener('change', function () {
      preview.innerHTML = '';
      Array.prototype.forEach.call(input.files, function (file) {
        var img = document.createElement('img');
        img.alt = file.name;
        img.src = URL.createObjectURL(file);
        var wrapper = document.createElement('div');
        wrapper.className = 'photo';
        wrapper.appendChild(img);
        preview.appendChild(wrapper);
      });
      if (info) {
        info.textContent = input.files.length
          ? input.files.length + ' photo(s) sélectionnée(s) — elles seront envoyées à l’enregistrement.'
          : '10 photos max. par envoi, 10 Mo chacune.';
      }
    });
  }

  // ----- Sauvegarde locale du formulaire (en cas de perte de réseau) -----
  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function setupAutosave(form) {
    var store = storage();
    var key = 'autosave:' + form.getAttribute('data-autosave');
    if (!store) return;
    var fields = form.querySelectorAll('input[name]:not([type=hidden]):not([type=file]), textarea[name], select[name]');
    var hasErrors = !!document.querySelector('.field-error');

    var saved = null;
    try { saved = JSON.parse(store.getItem(key) || 'null'); } catch (e) { saved = null; }
    if (saved && !hasErrors) {
      var restored = false;
      fields.forEach(function (field) {
        if (Object.prototype.hasOwnProperty.call(saved, field.name) && saved[field.name] !== field.value) {
          field.value = saved[field.name];
          restored = true;
        }
      });
      if (restored) {
        var note = document.createElement('div');
        note.className = 'alert alert-warning';
        note.textContent = 'Une saisie non envoyée a été restaurée depuis cet appareil.';
        form.parentNode.insertBefore(note, form);
      }
    }

    function save() {
      var data = {};
      fields.forEach(function (field) { data[field.name] = field.value; });
      try { store.setItem(key, JSON.stringify(data)); } catch (e) { /* stockage plein */ }
    }
    form.addEventListener('input', save);
    form.addEventListener('change', save);
  }

  function setupAutosaveCleanup() {
    var store = storage();
    var el = document.querySelector('[data-clear-autosave]');
    if (!store || !el) return;
    el.getAttribute('data-clear-autosave').split(',').forEach(function (key) {
      try { store.removeItem('autosave:' + key.trim()); } catch (e) { /* ignoré */ }
    });
  }
})();
