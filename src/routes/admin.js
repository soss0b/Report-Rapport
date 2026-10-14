const express = require('express');
const { requireAdmin, verifyCsrf, parseId, httpError } = require('../middleware');
const { hashPassword, validatePassword } = require('../auth');
const { findReport } = require('../reports');

const ROLES = ['technicien', 'admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function adminRoutes({ sessions }) {
  const router = express.Router();
  router.use(requireAdmin);

  // ----- Rapports -----

  function readFilters(query) {
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '');
    return {
      technicien: parseId(query.technicien) || '',
      statut: ['brouillon', 'soumis'].includes(query.statut) ? query.statut : '',
      du: date(query.du),
      au: date(query.au),
      q: str(query.q).slice(0, 100),
    };
  }

  function queryReports(db, filters) {
    const where = [];
    const params = [];
    if (filters.technicien) {
      where.push('r.user_id = ?');
      params.push(filters.technicien);
    }
    if (filters.statut) {
      where.push('r.status = ?');
      params.push(filters.statut);
    }
    if (filters.du) {
      where.push('r.intervention_date >= ?');
      params.push(filters.du);
    }
    if (filters.au) {
      where.push('r.intervention_date <= ?');
      params.push(filters.au);
    }
    if (filters.q) {
      where.push(`(r.client LIKE ? ESCAPE '\\' OR r.site LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\')`);
      const like = `%${filters.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      params.push(like, like, like);
    }
    return db
      .prepare(
        `SELECT r.*, u.name AS technician_name,
                (SELECT COUNT(*) FROM photos p WHERE p.report_id = r.id) AS photo_count
         FROM reports r JOIN users u ON u.id = r.user_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY r.intervention_date DESC, r.id DESC`,
      )
      .all(...params);
  }

  router.get('/rapports', (req, res) => {
    const db = req.app.locals.db;
    const filters = readFilters(req.query);
    const reports = queryReports(db, filters);
    const technicians = db.prepare('SELECT id, name FROM users ORDER BY name').all();
    const exportQuery = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== ''),
    ).toString();
    res.render('admin/reports', { title: 'Tous les rapports', reports, technicians, filters, exportQuery });
  });

  router.get('/rapports.csv', (req, res) => {
    const reports = queryReports(req.app.locals.db, readFilters(req.query));
    const columns = [
      ['N°', 'id'],
      ['Date', 'intervention_date'],
      ['Début', 'start_time'],
      ['Fin', 'end_time'],
      ['Technicien', 'technician_name'],
      ['Client', 'client'],
      ['Site / adresse', 'site'],
      ["Type d'intervention", 'intervention_type'],
      ['Description', 'description'],
      ['Matériel / pièces', 'materials'],
      ['Observations', 'observations'],
      ['Signataire', 'signer_name'],
      ['Statut', 'status'],
      ['Photos', 'photo_count'],
      ['Soumis le', 'submitted_at'],
    ];
    const cell = (value) => {
      let text = value == null ? '' : String(value);
      // Neutralise les formules tableur (injection CSV).
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const lines = [columns.map(([label]) => cell(label)).join(';')];
    for (const report of reports) lines.push(columns.map(([, key]) => cell(report[key])).join(';'));
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rapports-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    res.send('﻿' + lines.join('\r\n'));
  });

  router.post('/rapports/:id/rouvrir', verifyCsrf, (req, res, next) => {
    const db = req.app.locals.db;
    const report = findReport(db, parseId(req.params.id));
    if (!report) return next(httpError(404, 'Rapport introuvable.'));
    db.prepare(
      "UPDATE reports SET status = 'brouillon', submitted_at = NULL, updated_at = datetime('now') WHERE id = ?",
    ).run(report.id);
    req.flash('success', `Rapport n°${report.id} rouvert : le technicien peut à nouveau le modifier.`);
    res.redirect(`/rapports/${report.id}`);
  });

  // ----- Utilisateurs -----

  router.get('/utilisateurs', (req, res) => {
    const users = req.app.locals.db
      .prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id) AS report_count
         FROM users u ORDER BY u.active DESC, u.name`,
      )
      .all();
    res.render('admin/users', { title: 'Utilisateurs', users });
  });

  router.get('/utilisateurs/nouveau', (req, res) => {
    res.render('admin/user-form', { title: 'Nouvel utilisateur', target: null, values: { role: 'technicien' }, errors: {} });
  });

  function readUserForm(body) {
    return {
      name: String(body.name || '').trim(),
      email: String(body.email || '').trim().toLowerCase(),
      role: ROLES.includes(body.role) ? body.role : 'technicien',
      active: body.active === '1' ? 1 : 0,
    };
  }

  function validateUser(db, values, excludeId) {
    const errors = {};
    if (!values.name || values.name.length > 100) errors.name = 'Nom obligatoire (100 caractères max).';
    if (!EMAIL_RE.test(values.email) || values.email.length > 200) errors.email = 'Adresse email invalide.';
    else if (db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(values.email, excludeId || 0)) {
      errors.email = 'Cette adresse email est déjà utilisée.';
    }
    return errors;
  }

  router.post('/utilisateurs', verifyCsrf, (req, res) => {
    const db = req.app.locals.db;
    const values = readUserForm(req.body);
    const errors = validateUser(db, values);
    const passwordError = validatePassword(req.body.password);
    if (passwordError) errors.password = passwordError;
    if (Object.keys(errors).length) {
      return res.status(400).render('admin/user-form', { title: 'Nouvel utilisateur', target: null, values, errors });
    }
    db.prepare('INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, ?, 1)').run(
      values.name,
      values.email,
      hashPassword(req.body.password),
      values.role,
    );
    req.flash('success', `Compte créé pour ${values.name}. Communiquez-lui son mot de passe provisoire.`);
    res.redirect('/admin/utilisateurs');
  });

  function loadUser(req, next) {
    const target = req.app.locals.db.prepare('SELECT * FROM users WHERE id = ?').get(parseId(req.params.id));
    if (!target) next(httpError(404, 'Utilisateur introuvable.'));
    return target;
  }

  router.get('/utilisateurs/:id', (req, res, next) => {
    const target = loadUser(req, next);
    if (!target) return;
    res.render('admin/user-form', { title: `Modifier ${target.name}`, target, values: target, errors: {} });
  });

  router.post('/utilisateurs/:id', verifyCsrf, (req, res, next) => {
    const db = req.app.locals.db;
    const target = loadUser(req, next);
    if (!target) return;
    const values = readUserForm(req.body);
    const errors = validateUser(db, values, target.id);
    if (target.id === req.user.id) {
      if (values.role !== 'admin') errors.role = 'Vous ne pouvez pas retirer vos propres droits administrateur.';
      if (!values.active) errors.active = 'Vous ne pouvez pas désactiver votre propre compte.';
    }
    if (Object.keys(errors).length) {
      return res
        .status(400)
        .render('admin/user-form', { title: `Modifier ${target.name}`, target, values: { ...target, ...values }, errors });
    }
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?').run(
      values.name,
      values.email,
      values.role,
      values.active,
      target.id,
    );
    if (!values.active || values.role !== target.role) sessions.destroyAll(target.id);
    req.flash('success', 'Utilisateur mis à jour.');
    res.redirect('/admin/utilisateurs');
  });

  router.post('/utilisateurs/:id/mot-de-passe', verifyCsrf, (req, res, next) => {
    const db = req.app.locals.db;
    const target = loadUser(req, next);
    if (!target) return;
    const passwordError = validatePassword(req.body.password);
    if (passwordError) {
      return res.status(400).render('admin/user-form', {
        title: `Modifier ${target.name}`,
        target,
        values: target,
        errors: { password: passwordError },
      });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), target.id);
    if (target.id === req.user.id) sessions.destroyOthers(target.id, req.session.session_id);
    else sessions.destroyAll(target.id);
    req.flash('success', `Mot de passe de ${target.name} réinitialisé.`);
    res.redirect('/admin/utilisateurs');
  });

  return router;
};
