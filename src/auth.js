const crypto = require('node:crypto');

const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 jours

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Hash factice pour que la durée de réponse ne révèle pas si un email existe.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  }
  if (password.length > 200) return 'Le mot de passe est trop long.';
  return null;
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    try {
      cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // cookie mal formé : ignoré
    }
  }
  return cookies;
}

function createSessionStore(db) {
  const stmts = {
    insert: db.prepare('INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)'),
    find: db.prepare(`
      SELECT s.id AS session_id, s.csrf, s.flash, s.expires_at,
             u.id, u.name, u.email, u.role, u.active
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`),
    remove: db.prepare('DELETE FROM sessions WHERE id = ?'),
    removeForUser: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?'),
    removeAllForUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    setFlash: db.prepare('UPDATE sessions SET flash = ? WHERE id = ?'),
  };

  return {
    create(userId) {
      const token = crypto.randomBytes(32).toString('hex');
      const csrf = crypto.randomBytes(24).toString('hex');
      stmts.purge.run(Date.now());
      stmts.insert.run(sha256(token), userId, csrf, Date.now() + SESSION_TTL_MS);
      return token;
    },
    load(token) {
      if (!token || typeof token !== 'string') return null;
      const row = stmts.find.get(sha256(token));
      if (!row) return null;
      if (row.expires_at < Date.now() || !row.active) {
        stmts.remove.run(row.session_id);
        return null;
      }
      return row;
    },
    destroy(sessionId) {
      stmts.remove.run(sessionId);
    },
    destroyOthers(userId, keepSessionId) {
      stmts.removeForUser.run(userId, keepSessionId);
    },
    destroyAll(userId) {
      stmts.removeAllForUser.run(userId);
    },
    setFlash(sessionId, flash) {
      stmts.setFlash.run(flash ? JSON.stringify(flash) : null, sessionId);
    },
  };
}

// Limitation simple des tentatives de connexion (en mémoire).
function createLoginLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map();
  const key = (ip, email) => `${ip}|${String(email).toLowerCase()}`;
  return {
    isBlocked(ip, email) {
      const entry = attempts.get(key(ip, email));
      if (!entry) return false;
      if (entry.resetAt < Date.now()) {
        attempts.delete(key(ip, email));
        return false;
      }
      return entry.count >= max;
    },
    fail(ip, email) {
      const k = key(ip, email);
      const entry = attempts.get(k);
      if (!entry || entry.resetAt < Date.now()) {
        attempts.set(k, { count: 1, resetAt: Date.now() + windowMs });
      } else {
        entry.count += 1;
      }
    },
    reset(ip, email) {
      attempts.delete(key(ip, email));
    },
  };
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  validatePassword,
  DUMMY_HASH,
  parseCookies,
  createSessionStore,
  createLoginLimiter,
};
