const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

let server;
let baseUrl;
let db;
let uploadDir;

before(async () => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapports-test-'));
  const app = createApp({ dbFile: ':memory:', uploadDir, secureCookies: false });
  db = app.locals.db;
  const insert = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
  insert.run('Admin', 'admin@test.fr', hashPassword('admin-pass'), 'admin');
  insert.run('Tech Un', 'tech1@test.fr', hashPassword('tech1-pass'), 'technicien');
  insert.run('Tech Deux', 'tech2@test.fr', hashPassword('tech2-pass'), 'technicien');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  async function request(url, options = {}) {
    const res = await fetch(baseUrl + url, {
      redirect: 'manual',
      ...options,
      headers: { ...(options.headers || {}), cookie },
    });
    for (const setCookie of res.headers.getSetCookie()) {
      const pair = setCookie.split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair;
    }
    return res;
  }
  return {
    request,
    get: (url) => request(url),
    post: (url, data) =>
      request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString(),
      }),
    async csrf(url = '/compte') {
      const html = await (await request(url)).text();
      return html.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    },
  };
}

async function login(email, password) {
  const c = client();
  const res = await c.post('/login', { email, password });
  assert.equal(res.status, 302, `connexion de ${email}`);
  return c;
}

function reportForm(token, fields, files = []) {
  const form = new FormData();
  form.set('_csrf', token);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const file of files) form.append('photos', file.blob, file.name);
  return form;
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('les pages protégées redirigent vers la connexion', async () => {
  const c = client();
  for (const url of ['/', '/rapports', '/admin/rapports', '/admin/utilisateurs']) {
    const res = await c.get(url);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
  }
});

test('connexion refusée avec un mauvais mot de passe', async () => {
  const res = await client().post('/login', { email: 'tech1@test.fr', password: 'mauvais' });
  assert.equal(res.status, 401);
  assert.match(await res.text(), /Email ou mot de passe incorrect/);
});

test('un technicien ne peut pas accéder à l’administration', async () => {
  const tech = await login('tech1@test.fr', 'tech1-pass');
  assert.equal((await tech.get('/admin/rapports')).status, 403);
  assert.equal((await tech.get('/admin/utilisateurs')).status, 403);
  const token = await tech.csrf();
  const res = await tech.post('/admin/utilisateurs', {
    _csrf: token,
    name: 'Pirate',
    email: 'pirate@test.fr',
    password: 'motdepasse',
    role: 'admin',
  });
  assert.equal(res.status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('pirate@test.fr').n, 0);
});

test('seul un admin crée des comptes, et le nouveau compte peut se connecter', async () => {
  const admin = await login('admin@test.fr', 'admin-pass');
  const token = await admin.csrf();
  const res = await admin.post('/admin/utilisateurs', {
    _csrf: token,
    name: 'Nouveau Tech',
    email: 'Nouveau@Test.fr',
    password: 'provisoire1',
    role: 'technicien',
  });
  assert.equal(res.status, 302);
  await login('nouveau@test.fr', 'provisoire1');

  const duplicate = await admin.post('/admin/utilisateurs', {
    _csrf: token,
    name: 'Doublon',
    email: 'nouveau@test.fr',
    password: 'provisoire1',
    role: 'technicien',
  });
  assert.equal(duplicate.status, 400);
});

test('les requêtes sans jeton CSRF sont refusées', async () => {
  const admin = await login('admin@test.fr', 'admin-pass');
  const res = await admin.post('/admin/utilisateurs', {
    name: 'X',
    email: 'x@test.fr',
    password: 'motdepasse',
    role: 'admin',
  });
  assert.equal(res.status, 403);
});

test('cycle de vie d’un rapport : brouillon, photo, soumission, verrouillage', async () => {
  const tech = await login('tech1@test.fr', 'tech1-pass');
  const token = await tech.csrf('/rapports/nouveau');

  const created = await tech.request('/rapports', {
    method: 'POST',
    body: reportForm(
      token,
      {
        intervention_date: '2026-10-14',
        start_time: '08:30',
        end_time: '10:00',
        client: 'Client <script>alert(1)</script>',
        site: 'Quai 3',
        intervention_type: 'Maintenance préventive',
        description: '',
        action: 'save',
      },
      [{ blob: new Blob([PNG_1PX], { type: 'image/png' }), name: 'photo.png' }],
    ),
  });
  assert.equal(created.status, 302);
  const reportUrl = created.headers.get('location').split('?')[0];
  const id = Number(reportUrl.split('/').pop());

  const page = await (await tech.get(reportUrl)).text();
  assert.match(page, /Brouillon/);
  assert.ok(!page.includes('<script>alert(1)</script>'), 'le contenu est échappé');
  const photoId = page.match(/\/photos\/(\d+)/)[1];
  const photo = await tech.get(`/photos/${photoId}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');

  // Soumission refusée sans description.
  const invalid = await tech.request(reportUrl, {
    method: 'POST',
    body: reportForm(token, { intervention_date: '2026-10-14', client: 'ACME', description: '', action: 'submit' }),
  });
  assert.equal(invalid.status, 400);

  const submitted = await tech.request(reportUrl, {
    method: 'POST',
    body: reportForm(token, {
      intervention_date: '2026-10-14',
      client: 'ACME',
      description: 'Remplacement du moteur',
      signer_name: 'M. Client',
      signature: 'data:image/png;base64,' + PNG_1PX.toString('base64'),
      action: 'submit',
    }),
  });
  assert.equal(submitted.status, 302);
  const row = db.prepare('SELECT status, submitted_at, signature FROM reports WHERE id = ?').get(id);
  assert.equal(row.status, 'soumis');
  assert.ok(row.submitted_at);
  assert.ok(row.signature.startsWith('data:image/png'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos WHERE report_id = ?').get(id).n, 1);

  // Un rapport soumis n'est plus modifiable.
  const locked = await tech.request(reportUrl, {
    method: 'POST',
    body: reportForm(token, { intervention_date: '2026-10-14', client: 'Modifié', description: 'x', action: 'save' }),
  });
  assert.equal(locked.status, 403);
  assert.equal(db.prepare('SELECT client FROM reports WHERE id = ?').get(id).client, 'ACME');

  // Un autre technicien ne voit ni le rapport ni ses photos.
  const other = await login('tech2@test.fr', 'tech2-pass');
  assert.equal((await other.get(reportUrl)).status, 404);
  assert.equal((await other.get(`/photos/${photoId}`)).status, 404);
  assert.ok(!(await (await other.get('/rapports')).text()).includes('ACME'));

  // L'admin voit tous les rapports, peut filtrer, exporter et rouvrir.
  const admin = await login('admin@test.fr', 'admin-pass');
  assert.equal((await admin.get(reportUrl)).status, 200);
  assert.match(await (await admin.get('/admin/rapports')).text(), /ACME/);
  assert.match(await (await admin.get('/admin/rapports?q=ACME&statut=soumis')).text(), /<strong>ACME<\/strong>/);
  assert.doesNotMatch(await (await admin.get('/admin/rapports?statut=brouillon&q=ACME')).text(), /<strong>ACME<\/strong>/);
  const csv = await (await admin.get('/admin/rapports.csv')).text();
  assert.match(csv, /"ACME"/);
  assert.match(csv, /Remplacement du moteur/);

  const adminToken = await admin.csrf();
  assert.equal((await admin.post(`/admin/rapports/${id}/rouvrir`, { _csrf: adminToken })).status, 302);
  assert.equal(db.prepare('SELECT status FROM reports WHERE id = ?').get(id).status, 'brouillon');
});

test('un compte désactivé est déconnecté et ne peut plus se connecter', async () => {
  const admin = await login('admin@test.fr', 'admin-pass');
  const tech = await login('tech2@test.fr', 'tech2-pass');
  const target = db.prepare('SELECT id FROM users WHERE email = ?').get('tech2@test.fr');
  const token = await admin.csrf();
  const res = await admin.post(`/admin/utilisateurs/${target.id}`, {
    _csrf: token,
    name: 'Tech Deux',
    email: 'tech2@test.fr',
    role: 'technicien',
  });
  assert.equal(res.status, 302);
  assert.equal((await tech.get('/rapports')).status, 302);
  assert.equal((await client().post('/login', { email: 'tech2@test.fr', password: 'tech2-pass' })).status, 401);
});

test('un admin ne peut pas se retirer ses propres droits', async () => {
  const admin = await login('admin@test.fr', 'admin-pass');
  const me = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@test.fr');
  const token = await admin.csrf();
  const res = await admin.post(`/admin/utilisateurs/${me.id}`, {
    _csrf: token,
    name: 'Admin',
    email: 'admin@test.fr',
    role: 'technicien',
    active: '1',
  });
  assert.equal(res.status, 400);
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(me.id).role, 'admin');
});

test('changement de mot de passe par l’utilisateur', async () => {
  const tech = await login('tech1@test.fr', 'tech1-pass');
  const token = await tech.csrf();
  const res = await tech.post('/compte/mot-de-passe', {
    _csrf: token,
    current_password: 'tech1-pass',
    new_password: 'nouveau-pass',
    confirm_password: 'nouveau-pass',
  });
  assert.equal(res.status, 302);
  await login('tech1@test.fr', 'nouveau-pass');
});
