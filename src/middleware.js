const crypto = require('node:crypto');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return next(httpError(403, 'Accès réservé aux administrateurs.'));
  next();
}

function verifyCsrf(req, res, next) {
  const sent = String((req.body && req.body._csrf) || '');
  const expected = req.session ? req.session.csrf : '';
  const ok =
    expected &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return next(httpError(403, 'Jeton de sécurité invalide. Rechargez la page et réessayez.'));
  next();
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

module.exports = { httpError, requireAuth, requireAdmin, verifyCsrf, parseId };
