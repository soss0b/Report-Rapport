const express = require('express');
const { verifyPassword, hashPassword, validatePassword, DUMMY_HASH } = require('../auth');
const { requireAuth, verifyCsrf } = require('../middleware');

module.exports = function authRoutes({ startSession, clearSession, loginLimiter, sessions }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    if (!req.user) return res.redirect('/login');
    res.redirect(req.user.role === 'admin' ? '/admin/rapports' : '/rapports');
  });

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('login', { title: 'Connexion', email: '', error: null });
  });

  router.post('/login', (req, res) => {
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const ip = req.ip;
    const fail = (message, status = 401) =>
      res.status(status).render('login', { title: 'Connexion', email, error: message });

    if (loginLimiter.isBlocked(ip, email)) {
      return fail('Trop de tentatives. Réessayez dans quelques minutes.', 429);
    }

    const user = req.app.locals.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const valid = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid || !user.active) {
      loginLimiter.fail(ip, email);
      return fail('Email ou mot de passe incorrect.');
    }

    loginLimiter.reset(ip, email);
    if (req.session) sessions.destroy(req.session.session_id);
    startSession(res, user.id);
    res.redirect(user.role === 'admin' ? '/admin/rapports' : '/rapports');
  });

  router.post('/logout', requireAuth, verifyCsrf, (req, res) => {
    clearSession(req, res);
    res.redirect('/login');
  });

  router.get('/compte', requireAuth, (req, res) => {
    res.render('account', { title: 'Mon compte', error: null });
  });

  router.post('/compte/mot-de-passe', requireAuth, verifyCsrf, (req, res) => {
    const db = req.app.locals.db;
    const { current_password: current = '', new_password: next = '', confirm_password: confirm = '' } = req.body;
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const renderError = (error) => res.status(400).render('account', { title: 'Mon compte', error });

    if (!verifyPassword(String(current), user.password_hash)) return renderError('Mot de passe actuel incorrect.');
    const invalid = validatePassword(next);
    if (invalid) return renderError(invalid);
    if (next !== confirm) return renderError('Les deux nouveaux mots de passe ne correspondent pas.');

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
    sessions.destroyOthers(req.user.id, req.session.session_id);
    req.flash('success', 'Mot de passe modifié.');
    res.redirect('/compte');
  });

  return router;
};
