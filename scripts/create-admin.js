// Usage : npm run create-admin -- <email> <nom> [mot_de_passe]
// Sans mot de passe en argument, il est demandé de manière interactive.
const path = require('node:path');
const readline = require('node:readline/promises');
const { openDatabase } = require('../src/db');
const { hashPassword, validatePassword } = require('../src/auth');

async function main() {
  const [email, name, passwordArg] = process.argv.slice(2);
  if (!email || !name) {
    console.error('Usage : npm run create-admin -- <email> "<Nom Prénom>" [mot_de_passe]');
    process.exit(1);
  }
  let password = passwordArg;
  if (!password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('Mot de passe (8 caractères min.) : ');
    rl.close();
  }
  const invalid = validatePassword(password);
  if (invalid) {
    console.error(invalid);
    process.exit(1);
  }

  const db = openDatabase(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'rapports.db'));
  const normalized = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existing) {
    db.prepare("UPDATE users SET name = ?, password_hash = ?, role = 'admin', active = 1 WHERE id = ?").run(
      name,
      hashPassword(password),
      existing.id,
    );
    console.log(`Utilisateur existant promu administrateur : ${normalized}`);
  } else {
    db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run(
      name,
      normalized,
      hashPassword(password),
    );
    console.log(`Administrateur créé : ${normalized}`);
  }
}

main();
