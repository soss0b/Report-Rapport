# Rapports d'intervention — application web mobile

Application web (PWA) permettant aux techniciens de saisir leurs rapports d'intervention
depuis leur téléphone (Android ou iPhone), sans passer par les stores : on l'ouvre dans le
navigateur et on peut l'**ajouter à l'écran d'accueil** pour l'utiliser comme une vraie application.

## Fonctionnalités

**Tous les utilisateurs**
- Page de connexion (email + mot de passe), limitation des tentatives.
- Changement de son mot de passe (« Mon compte »).

**Techniciens**
- Création d'un rapport : date, horaires, client, site, type d'intervention, travaux réalisés,
  matériel utilisé, observations.
- Ajout de **photos** directement depuis l'appareil photo du téléphone.
- **Signature du client** au doigt sur l'écran.
- Enregistrement en brouillon, puis **soumission** (le rapport est alors verrouillé).
- Sauvegarde automatique de la saisie sur le téléphone en cas de perte de réseau.
- Impression / export PDF d'un rapport.

**Administrateurs**
- **Seul un admin peut créer des comptes** (technicien ou admin), modifier, désactiver un compte
  ou réinitialiser un mot de passe. Il n'y a pas d'inscription libre.
- Consultation de **tous les rapports** de tous les techniciens, avec filtres (technicien, statut,
  période, recherche texte) et **export CSV** (Excel).
- Réouverture d'un rapport soumis pour correction par le technicien.

## Tester sans rien installer (GitHub Codespaces)

1. Sur la page GitHub du dépôt, choisir la branche `claude/app-rapports-techniciens`.
2. Bouton vert **Code** → onglet **Codespaces** → **Create codespace on claude/app-rapports-techniciens**.
3. Patienter 2 à 3 minutes : l'installation et le démarrage sont automatiques.
4. Ouvrir l'onglet **Ports** en bas, puis l'icône 🌐 de la ligne 3000.
5. Se connecter avec `admin@exemple.fr` / `admin1234`.

Pour tester sur un téléphone : dans l'onglet **Ports**, clic droit sur 3000 → *Port Visibility* →
*Public*, puis ouvrir la même adresse sur le téléphone. Penser à arrêter le codespace après usage
(github.com/codespaces).

## Tester en local

Prérequis : [Node.js](https://nodejs.org) 22.13 ou plus récent (version « LTS »), et Git.

```bash
git clone https://github.com/soss0b/Report-Rapport.git
cd Report-Rapport
git checkout claude/app-rapports-techniciens
npm install
```

Copier `.env.example` en `.env` (Windows : `copy .env.example .env`, Mac/Linux : `cp .env.example .env`),
puis lancer :

```bash
npm start
```

Ouvrir http://localhost:3000 et se connecter avec `admin@exemple.fr` / `admin1234`
(valeurs du fichier `.env`, à changer). Le premier administrateur est créé au démarrage s'il n'en
existe aucun. On peut aussi en créer un avec `npm run create-admin -- admin@exemple.fr "Nom Prénom"`.

**Tester depuis son téléphone** : téléphone et ordinateur sur le même Wi-Fi, ouvrir
`http://<adresse IP de l'ordinateur>:3000` (adresse IP visible avec `ipconfig` sous Windows).
Si la page ne s'ouvre pas, autoriser Node.js dans le pare-feu Windows. L'installation sur l'écran
d'accueil n'est possible qu'en HTTPS, donc une fois l'application en ligne.

Remise à zéro : arrêter le serveur (Ctrl+C) et supprimer le dossier `data/`.

Tests automatisés : `npm test`

## Mise en production

Les téléphones doivent accéder à l'application en **HTTPS** (obligatoire pour l'installation
sur l'écran d'accueil et pour la sécurité des mots de passe).

Avec Docker :

```bash
docker build -t rapports .
docker run -d -p 3000:3000 -v rapports-data:/app/data \
  -e ADMIN_EMAIL=admin@exemple.fr -e ADMIN_PASSWORD='un-mot-de-passe-solide' \
  -e TRUST_PROXY=1 rapports
```

Placer devant un reverse proxy HTTPS (Caddy, Nginx, Traefik…) ou utiliser un hébergeur
(Render, Railway, Fly.io, Scaleway, OVH…) avec un **volume persistant** monté sur `/app/data`.

| Variable           | Rôle                                                              | Défaut                |
|--------------------|-------------------------------------------------------------------|-----------------------|
| `PORT`             | Port d'écoute                                                     | `3000`                |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Premier admin, créé s'il n'en existe aucun | —           |
| `DB_FILE`          | Fichier de base SQLite                                            | `data/rapports.db`    |
| `UPLOAD_DIR`       | Dossier des photos                                                | `data/uploads`        |
| `NODE_ENV`         | `production` active les cookies sécurisés (HTTPS uniquement)       | —                     |
| `TRUST_PROXY`      | À définir (`1`) derrière un reverse proxy                          | —                     |
| `DISPLAY_TIMEZONE` | Fuseau horaire d'affichage                                        | `Europe/Paris`        |

**Sauvegardes** : tout est dans le dossier `data/` (base SQLite + photos). Le sauvegarder régulièrement.

## Installer sur le téléphone

- **iPhone (Safari)** : bouton Partager → « Sur l'écran d'accueil ».
- **Android (Chrome)** : menu ⋮ → « Installer l'application » / « Ajouter à l'écran d'accueil ».

## Structure

```
src/        serveur Express (routes, authentification, base SQLite)
views/      pages (EJS)
public/     CSS, JavaScript client (signature, photos, sauvegarde locale), manifest PWA, icônes
scripts/    création d'admin, génération des icônes
test/       tests automatisés
```
