<p align="center">
  <img src="public/images/phishtopia-logo-animated-1.gif" alt="Phishtopia animated logo" width="220">
</p>

<h1 align="center">Phishtopia.com</h1>

<p align="center">
  A growing full-stack web development hub built with Node.js, Express, EJS, PostgreSQL, and questionable amounts of caffeine.
</p>

<p align="center">
  <a href="https://phishtopia.com">Live Site</a>
</p>

---

## Overview

Phishtopia.com is a personal web development project hub and growing full-stack web application. It began as a place to showcase course projects and experiments, but it has grown into a larger Node.js/Express platform with authentication, PostgreSQL-backed features, third-party API integrations, original tools, and production-style deployment.

The project is actively evolving as I continue learning full-stack development, improving the architecture, and turning individual experiments into more polished applications.

---

## Current Status

**Phishtopia v2.0.0** is live on the production site.

This release merged the major site-structure refactor into `main`, keeping the live site stable while separating the application into cleaner routes, controllers, services, middleware, and database query modules.

Current production setup:

- Production URL: `https://phishtopia.com`
- VM name: `phishtopia-vm`
- Static IP: `34.73.92.179`
- Web server: Nginx
- App runtime: Node.js 22
- Process manager: PM2
- Database: local PostgreSQL on the VM
- HTTPS: Let's Encrypt certificates managed by Certbot
- Primary domain: `phishtopia.com`
- `www.phishtopia.com` redirects to `https://phishtopia.com`

Production request flow:

```text
Namecheap DNS
  -> GCP static IP
  -> Nginx
  -> Node / Express app on localhost:3002
  -> Local PostgreSQL on localhost:5432
```

The database is not exposed directly to the public internet. Users interact with the site through the web app, and the app talks to PostgreSQL locally on the VM.

---

## Latest Release

### v2.0.0 — Phishtopia v2 Foundation

Released after the major refactor and production deployment to `main`.

Highlights:

- Refactored the app from a large root server file into a cleaner `src/` architecture.
- Split authentication, YouList, page routes, services, middleware, and database logic into separate modules.
- Added email verification support and a development-friendly verification flow.
- Switched password hashing from native `bcrypt` to `bcryptjs` for better Android/Termux/Codespaces compatibility.
- Polished the homepage, projects page, auth screens, and YouList card layout.
- Confirmed production deploy, PM2 restart, and live `/health` check.

Release notes are tracked in [`docs/releases/v2.0.0.md`](docs/releases/v2.0.0.md).

---

## Production Management

Most production commands are run on the VM.

SSH into the VM:

```bash
gcloud compute ssh phishtopia-vm --zone=us-east1-b
```

The app currently lives at:

```text
/home/codespace/phishtopia
```

Sensitive runtime files are stored outside the Git repository:

```text
/home/codespace/phishtopia/.env
/home/codespace/phishtopia-secrets/db.env
/home/codespace/phishtopia-secrets/app.env
```

Do not commit secrets, `.env` files, SQL dumps, or backup files.

Check the running app:

```bash
sudo -u codespace env PM2_HOME=/home/codespace/.pm2 pm2 status
curl -I https://phishtopia.com/health
curl -I https://www.phishtopia.com/health
sudo systemctl status pm2-codespace --no-pager
sudo systemctl status certbot.timer --no-pager
```

View recent app logs:

```bash
sudo -u codespace env PM2_HOME=/home/codespace/.pm2 pm2 logs phishtopia --lines 50
```

View recent deploy output:

```bash
tail -80 /home/codespace/phishtopia-deploy.log
```

Production currently auto-deploys updates from `main` through the VM deploy timer. After pushing to `main`, confirm deployment with:

```bash
tail -80 /home/codespace/phishtopia-deploy.log
curl -I https://phishtopia.com/health
```

Manual deploy steps, if needed:

```bash
cd /home/codespace/phishtopia
git pull origin main
npm ci --omit=dev
sudo -u codespace env PM2_HOME=/home/codespace/.pm2 pm2 restart phishtopia --update-env
sudo -u codespace env PM2_HOME=/home/codespace/.pm2 pm2 save
```

---

## Current Features

### Project Hub

A collection of web development projects, experiments, and course-inspired builds organized through a central projects page.

### YouList

YouList is a movie and TV list application using the TMDB API. Users can search for titles, view details, and add personal comments to movies and shows.

Current features include:

- TMDB search integration
- Movie and TV detail views
- User authentication
- Email verification support
- User comments
- PostgreSQL-backed storage
- Pagination
- API response caching
- Mobile-friendly layout
- Desktop two-column card layout

### EchoTrace

EchoTrace is an Eve Echoes player intelligence tool that analyzes public killmail data to identify player activity patterns.

Current features include:

- Player search by name or ID
- Killer and victim filtering
- Date range filtering
- Top regions, constellations, and systems
- Activity-by-hour visualization
- Legacy `/player-int` route support

---

## Tech Stack

### Application

- Node.js 22
- Express 5
- EJS
- PostgreSQL
- bcryptjs
- express-session
- connect-pg-simple
- express-rate-limit
- Nodemailer
- Axios
- node-fetch
- TMDB API
- Echoes.mobi killmail API

### Production Infrastructure

- Google Cloud Compute Engine
- Debian 12
- Nginx reverse proxy
- PM2 process manager
- Local PostgreSQL
- Certbot / Let's Encrypt HTTPS
- Namecheap DNS
- GitHub-based deploy flow

### Development / Utility Tooling

- GitHub Codespaces
- Termux / Android development testing
- Google Cloud SDK
- SSH tunnels for safe remote database access
- Docker for local testing and one-off utility work

---

## Project Structure

The v2 refactor separates the app into clearer layers:

```text
src/
  app.js
  cache/
  config/
  controllers/
  db/
  middleware/
  routes/
  services/
```

Compatibility shims remain for some older App Brewery route paths while mature features continue moving into the newer structure.

---

## Project Goals

Phishtopia is both a portfolio and a learning platform. My goals are to keep improving it as a real production-style application while practicing:

- Full-stack application architecture
- Authentication and session handling
- API integration
- PostgreSQL schema design
- Deployment and cloud migration
- Linux server administration
- Nginx reverse proxy configuration
- Process management with PM2
- DNS and HTTPS configuration
- User-focused interface design
- Performance, caching, and logging
- Clean project organization

---

## Planned Improvements

- Add automatic local PostgreSQL backups.
- Add password reset and account management.
- Continue moving mature projects out of the old App Brewery structure.
- Add better analytics and usage tracking.
- Continue improving EchoTrace and YouList with more polished features.
- Add new practical tools after the v2 foundation remains stable.
- Review dependency audit warnings separately from feature work.

---

## Local Development

Clone the repository:

```bash
git clone https://github.com/PhishyOne/Phishtopia.com.git
cd Phishtopia.com
```

Install dependencies:

```bash
npm install
```

Create a local `.env` file in the project root. Do not commit it.

Important environment variables include:

```bash
PORT=3002
NODE_ENV=development
SESSION_SECRET=

DATABASE_URL=
DB_SSL=false

TMDB_API_KEY=
EMAIL_USER=
EMAIL_PASS=
SEND_EMAIL=false

PREWARM_TMDB_CACHE=false
LOG_SESSIONS=false
LOG_UNIQUE_STATIC_IPS=false
LOG_DB_CONFIG=false
```

Start the server:

```bash
npm start
```

The app runs locally on:

```text
http://localhost:3002
```

Health check:

```text
http://localhost:3002/health
```

---

## Codespaces / Termux Database Access

The production database is local-only on the VM. For development tools outside the VM, use an SSH tunnel instead of exposing PostgreSQL to the internet.

Tunnel pattern:

```text
Codespace or Termux
  -> 127.0.0.1:5433
  -> SSH tunnel
  -> GCP VM 127.0.0.1:5432
  -> PostgreSQL
```

Extension or local app connection settings:

```text
Host: 127.0.0.1
Port: 5433
Database: phishtopia
Username: phishtopia
SSL: false / disabled
```

The production app itself does not need this tunnel because it runs on the same VM as PostgreSQL.

---

## Docker

Docker is available for local testing and one-off utility work. The production VM currently runs the app directly with Node.js and PM2 rather than running the app container.

Build locally:

```bash
docker build -t phishtopia .
```

Run locally with an env file:

```bash
docker run --rm \
  --env-file .env \
  -p 8080:8080 \
  phishtopia
```

Then visit:

```text
http://localhost:8080/health
```

---

## Database Notes

The application supports a full `DATABASE_URL` connection string. Production currently uses local PostgreSQL on the VM. Sessions are stored in PostgreSQL through `connect-pg-simple`, using the shared configured database pool.

Current production database basics:

```text
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=phishtopia
DB_USER=phishtopia
DB_SSL=false
```

To inspect the production database from the VM:

```bash
sudo -u codespace bash -lc '
set -a
source /home/codespace/phishtopia-secrets/db.env
set +a

psql "$DATABASE_URL"
'
```

To create a manual backup from the VM:

```bash
sudo -u codespace bash -lc '
set -a
source /home/codespace/phishtopia-secrets/db.env
set +a

mkdir -p /home/codespace/backups
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="/home/codespace/backups/phishtopia-prod-$(date +%Y%m%d%H%M%S).dump"
'
```

Do not commit database dumps or backup files to GitHub.

---

## Notes

This project is actively under development. Some features are experimental, and parts of the codebase still reflect its origin as a learning/coursework project.

The long-term goal is to continue refactoring Phishtopia into a cleaner, scalable, production-style web application while keeping it useful, creative, and fun to build.

---

## Author

Built by PhishyOne as part of an ongoing web development learning journey.
