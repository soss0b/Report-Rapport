const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { requireAuth, verifyCsrf, parseId, httpError } = require('../middleware');
const {
  INTERVENTION_TYPES,
  readReportForm,
  validateReport,
  findReport,
  reportPhotos,
  canView,
  canEdit,
} = require('../reports');

const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};
const MAX_PHOTOS_PER_REPORT = 20;

module.exports = function reportRoutes() {
  const router = express.Router();

  const upload = (req, res, next) => {
    const uploadDir = req.app.locals.config.uploadDir;
    const handler = multer({
      storage: multer.diskStorage({
        destination: uploadDir,
        filename: (r, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + IMAGE_TYPES[file.mimetype]),
      }),
      limits: { fileSize: 10 * 1024 * 1024, files: 10, fields: 30, fieldSize: 1.5 * 1024 * 1024 },
      fileFilter: (r, file, cb) => cb(null, Boolean(IMAGE_TYPES[file.mimetype])),
    }).array('photos', 10);

    handler(req, res, (err) => {
      if (!err) return next();
      removeUploaded(req.files);
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Une photo dépasse la taille maximale de 10 Mo.'
            : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
              ? 'Maximum 10 photos par envoi.'
              : "Erreur lors de l'envoi du formulaire.";
        return next(httpError(413, message));
      }
      next(err);
    });
  };

  const cleanupOnError = (req, res, next) => {
    // Supprime les photos téléversées si la requête échoue avant d'être enregistrée.
    res.on('finish', () => {
      if (!req.photosSaved) removeUploaded(req.files);
    });
    next();
  };

  function removeUploaded(files) {
    for (const file of files || []) fs.rm(file.path, { force: true }, () => {});
  }

  function renderForm(res, { report, values, errors, photos = [], status = 200 }) {
    res.status(status).render('reports/form', {
      title: report ? `Modifier le rapport n°${report.id}` : 'Nouveau rapport',
      report,
      values,
      errors,
      photos,
      interventionTypes: INTERVENTION_TYPES,
    });
  }

  function savePhotos(req, reportId) {
    const db = req.app.locals.db;
    const files = req.files || [];
    const existing = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE report_id = ?').get(reportId).n;
    const allowed = Math.max(0, MAX_PHOTOS_PER_REPORT - existing);
    const insert = db.prepare('INSERT INTO photos (report_id, filename, original_name, mime) VALUES (?, ?, ?, ?)');
    files.slice(0, allowed).forEach((file) => {
      insert.run(reportId, file.filename, file.originalname.slice(0, 200), file.mimetype);
    });
    removeUploaded(files.slice(allowed));
    req.photosSaved = true;
    return files.length > allowed;
  }

  router.get('/rapports', requireAuth, (req, res) => {
    const reports = req.app.locals.db
      .prepare(
        `SELECT r.id, r.intervention_date, r.client, r.site, r.intervention_type, r.status,
                (SELECT COUNT(*) FROM photos p WHERE p.report_id = r.id) AS photo_count
         FROM reports r WHERE r.user_id = ? ORDER BY r.intervention_date DESC, r.id DESC`,
      )
      .all(req.user.id);
    res.render('reports/list', { title: 'Mes rapports', reports });
  });

  router.get('/rapports/nouveau', requireAuth, (req, res) => {
    const today = new Date();
    const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    renderForm(res, { report: null, values: { intervention_date: local }, errors: {} });
  });

  router.post('/rapports', requireAuth, upload, cleanupOnError, verifyCsrf, (req, res) => {
    const db = req.app.locals.db;
    const values = readReportForm(req.body);
    const submit = req.body.action === 'submit';
    const errors = validateReport(values, { forSubmission: submit });
    if (Object.keys(errors).length) return renderForm(res, { report: null, values, errors, status: 400 });

    let reportId;
    db.exec('BEGIN');
    try {
      const result = db
        .prepare(
          `INSERT INTO reports (user_id, intervention_date, start_time, end_time, client, site, intervention_type,
             description, materials, observations, signer_name, signature, status, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${submit ? "datetime('now')" : 'NULL'})`,
        )
        .run(
          req.user.id,
          values.intervention_date,
          values.start_time || null,
          values.end_time || null,
          values.client,
          values.site,
          values.intervention_type,
          values.description,
          values.materials,
          values.observations,
          values.signer_name,
          values.signature || null,
          submit ? 'soumis' : 'brouillon',
        );
      reportId = Number(result.lastInsertRowid);
      const truncated = savePhotos(req, reportId);
      db.exec('COMMIT');
      req.flash(
        truncated ? 'warning' : 'success',
        (submit ? 'Rapport soumis.' : 'Brouillon enregistré.') +
          (truncated ? ` Limite de ${MAX_PHOTOS_PER_REPORT} photos atteinte : certaines n'ont pas été ajoutées.` : ''),
      );
    } catch (err) {
      db.exec('ROLLBACK');
      req.photosSaved = false;
      throw err;
    }
    res.redirect(`/rapports/${reportId}?saved=1`);
  });

  router.get('/rapports/:id', requireAuth, (req, res, next) => {
    const db = req.app.locals.db;
    const report = findReport(db, parseId(req.params.id));
    if (!canView(req.user, report)) return next(httpError(404, 'Rapport introuvable.'));
    res.render('reports/show', {
      title: `Rapport n°${report.id}`,
      report,
      photos: reportPhotos(db, report.id),
      editable: canEdit(req.user, report),
      justSaved: req.query.saved === '1',
    });
  });

  router.get('/rapports/:id/modifier', requireAuth, (req, res, next) => {
    const db = req.app.locals.db;
    const report = findReport(db, parseId(req.params.id));
    if (!canView(req.user, report)) return next(httpError(404, 'Rapport introuvable.'));
    if (!canEdit(req.user, report)) {
      req.flash('warning', 'Ce rapport ne peut plus être modifié.');
      return res.redirect(`/rapports/${report.id}`);
    }
    renderForm(res, { report, values: report, errors: {}, photos: reportPhotos(db, report.id) });
  });

  router.post('/rapports/:id', requireAuth, upload, cleanupOnError, verifyCsrf, (req, res, next) => {
    const db = req.app.locals.db;
    const report = findReport(db, parseId(req.params.id));
    if (!canView(req.user, report)) return next(httpError(404, 'Rapport introuvable.'));
    if (!canEdit(req.user, report)) return next(httpError(403, 'Ce rapport ne peut plus être modifié.'));

    const values = readReportForm(req.body);
    const submit = req.body.action === 'submit';
    const errors = validateReport(values, { forSubmission: submit });
    if (Object.keys(errors).length) {
      return renderForm(res, { report, values, errors, photos: reportPhotos(db, report.id), status: 400 });
    }

    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE reports SET intervention_date = ?, start_time = ?, end_time = ?, client = ?, site = ?,
           intervention_type = ?, description = ?, materials = ?, observations = ?, signer_name = ?, signature = ?,
           status = ?, updated_at = datetime('now'),
           submitted_at = ${submit ? "datetime('now')" : 'NULL'}
         WHERE id = ?`,
      ).run(
        values.intervention_date,
        values.start_time || null,
        values.end_time || null,
        values.client,
        values.site,
        values.intervention_type,
        values.description,
        values.materials,
        values.observations,
        values.signer_name,
        values.signature || null,
        submit ? 'soumis' : 'brouillon',
        report.id,
      );
      const truncated = savePhotos(req, report.id);
      db.exec('COMMIT');
      req.flash(
        truncated ? 'warning' : 'success',
        (submit ? 'Rapport soumis.' : 'Modifications enregistrées.') +
          (truncated ? ` Limite de ${MAX_PHOTOS_PER_REPORT} photos atteinte : certaines n'ont pas été ajoutées.` : ''),
      );
    } catch (err) {
      db.exec('ROLLBACK');
      req.photosSaved = false;
      throw err;
    }
    res.redirect(`/rapports/${report.id}?saved=1`);
  });

  router.post('/rapports/:id/supprimer', requireAuth, verifyCsrf, (req, res, next) => {
    const db = req.app.locals.db;
    const report = findReport(db, parseId(req.params.id));
    if (!canView(req.user, report)) return next(httpError(404, 'Rapport introuvable.'));
    if (!canEdit(req.user, report)) return next(httpError(403, 'Seuls les brouillons peuvent être supprimés.'));
    const photos = reportPhotos(db, report.id);
    db.prepare('DELETE FROM reports WHERE id = ?').run(report.id);
    removeUploaded(photos.map((p) => ({ path: path.join(req.app.locals.config.uploadDir, p.filename) })));
    req.flash('success', 'Brouillon supprimé.');
    res.redirect('/rapports');
  });

  router.post('/rapports/:id/photos/:photoId/supprimer', requireAuth, verifyCsrf, (req, res, next) => {
    const db = req.app.locals.db;
    const report = findReport(db, parseId(req.params.id));
    if (!canView(req.user, report)) return next(httpError(404, 'Rapport introuvable.'));
    if (!canEdit(req.user, report)) return next(httpError(403, 'Ce rapport ne peut plus être modifié.'));
    const photo = db
      .prepare('SELECT * FROM photos WHERE id = ? AND report_id = ?')
      .get(parseId(req.params.photoId), report.id);
    if (photo) {
      db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
      removeUploaded([{ path: path.join(req.app.locals.config.uploadDir, photo.filename) }]);
      req.flash('success', 'Photo supprimée.');
    }
    res.redirect(`/rapports/${report.id}/modifier`);
  });

  router.get('/photos/:id', requireAuth, (req, res, next) => {
    const db = req.app.locals.db;
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(parseId(req.params.id));
    const report = photo && findReport(db, photo.report_id);
    if (!photo || !canView(req.user, report)) return next(httpError(404, 'Photo introuvable.'));
    res.set({
      'Content-Type': photo.mime,
      'Cache-Control': 'private, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.sendFile(path.join(req.app.locals.config.uploadDir, photo.filename), (err) => {
      if (err && !res.headersSent) next(httpError(404, 'Photo introuvable.'));
    });
  });

  return router;
};
