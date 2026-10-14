const { createApp } = require('./app');
const { hashPassword, validatePassword } = require('./auth');

const app = createApp();
const db = app.locals.db;

// Création du premier administrateur à partir des variables d'environnement.
const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
if (!hasAdmin) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Administrateur' } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD && !validatePassword(ADMIN_PASSWORD)) {
    db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run(
      ADMIN_NAME,
      ADMIN_EMAIL.trim().toLowerCase(),
      hashPassword(ADMIN_PASSWORD),
    );
    console.log(`Compte administrateur créé : ${ADMIN_EMAIL}`);
  } else {
    console.warn(
      "Aucun administrateur. Définissez ADMIN_EMAIL et ADMIN_PASSWORD (8 caractères min.) " +
        'ou lancez « npm run create-admin ».',
    );
  }
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Application démarrée sur http://localhost:${port}`));
