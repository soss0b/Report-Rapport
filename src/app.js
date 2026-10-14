const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { openDatabase } = require('./db');
const {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  parseCookies,
  createSessionStore,
  createLoginLimiter,
} = require('./auth');

function createApp(options = {}) {
  const config = {
    dbFile: options.dbFile || process.env.DB_FILE || path.join(__dirname, '..', 'data', 'rapports.db'),
    uploadDir: options.uploadDir || process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads'),
    secureCookies: options.secureCookies ?? process.env.NODE_ENV === 'production',
    trustProxy: options.trustProxy ?? process.env.TRUST_PROXY,
  };
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const db = openDatabase(config.dbFile);
  const sessions = createSessionStore(db);
  const loginLimiter = createLoginLimiter();

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy === 'true' ? true : config.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.db = db;
  app.locals.config = config;
  app.locals.fmtDate = (value) => (value ? String(value).split('-').reverse().join('/') : '');
  app.locals.fmtDateTime = (value) =>
    value
      ? new Date(String(value).replace(' ', 'T') + 'Z').toLocaleString('fr-FR', {
          timeZone: process.env.DISPLAY_TIMEZONE || 'Europe/Paris',
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : '';
  app.locals.statusLabel = (status) => (status === 'soumis' ? 'Soumis' : 'Brouillon');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; " +
        "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    });
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));

  // Chargement de la session à partir du cookie.
  app.use((req, res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = sessions.load(token);
    res.locals.user = null;
    res.locals.flash = null;
    res.locals.csrfToken = '';
    res.locals.currentPath = req.path;
    if (session) {
      req.session = session;
      req.user = { id: session.id, name: session.name, email: session.email, role: session.role };
      res.locals.user = req.user;
      res.locals.csrfToken = session.csrf;
      if (session.flash) {
        try {
          res.locals.flash = JSON.parse(session.flash);
        } catch {
          res.locals.flash = null;
        }
        sessions.setFlash(session.session_id, null);
      }
    }
    req.flash = (type, message) => {
      if (req.session) sessions.setFlash(req.session.session_id, { type, message });
    };
    next();
  });

  const helpers = {
    sessions,
    loginLimiter,
    startSession(res, userId) {
      const token = sessions.create(userId);
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.secureCookies,
        maxAge: SESSION_TTL_MS,
        path: '/',
      });
    },
    clearSession(req, res) {
      if (req.session) sessions.destroy(req.session.session_id);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
    },
  };

  app.use(require('./routes/auth')(helpers));
  app.use(require('./routes/reports')(helpers));
  app.use('/admin', require('./routes/admin')(helpers));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Page introuvable', message: "La page demandée n'existe pas." });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status === 403 || err.status === 404 || err.status === 413) {
      return res.status(err.status).render('error', { title: 'Erreur', message: err.expose ? err.message : 'Requête refusée.' });
    }
    console.error(err);
    res.status(500).render('error', { title: 'Erreur', message: 'Une erreur inattendue est survenue.' });
  });

  return app;
}

module.exports = { createApp };
