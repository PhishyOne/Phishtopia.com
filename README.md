<p align="center">
  <img src="public/images/phishtopia-logo-animated-1.gif" alt="Phishtopia animated logo" width="220">
</p>

<h1 align="center">Phishtopia.com</h1>

<p align="center">
  A growing full-stack web application for practical tools, strange experiments, and projects that became more serious than originally intended.
</p>

<p align="center">
  <a href="https://phishtopia.com">Live Site</a>
</p>

---

## Overview

Phishtopia is a personal development hub and production Node.js application built around useful tools, original projects, and ongoing computer-science work. It began as a collection of course exercises and experiments, then grew into a PostgreSQL-backed platform with authentication, user accounts, third-party APIs, responsive interfaces, automated deployment, monitoring, backups, and controlled operations tooling.

The current application uses Node.js, Express, EJS, and PostgreSQL with a deliberately simple server-rendered architecture. The project favors small reviewed changes, mobile-friendly workflows, measurable verification, and preserving known-good production behavior over rewrites for their own sake.

---

## Current Status

**Phishtopia v2 is live at `https://phishtopia.com`.**

Recent work on `main` includes:

- a general signed-in dashboard that keeps Phishtopia app-neutral
- responsive mobile navigation grouped by purpose
- clearer registration and account password guidance
- modern password visibility controls
- self-service account deletion with CSRF protection and transactional cleanup
- a public plain-English privacy page
- a cleaner shared footer and mobile dashboard layout
- page-specific Open Graph and Twitter/X metadata
- dedicated opaque 1200×630 social share cards for Home, YouList, EchoTrace, StoreCalc, Archive, Contact, and Privacy
- tests that lock the reviewed share-card files and reject alpha-channel regressions
- a public canonical sitemap
- crawler-friendly `robots.txt` guidance that excludes private and utility routes

Production runs on a Google Cloud VM and normally auto-deploys updates from `main` through the VM deployment timer. A merge is not considered fully verified until the VM deploy log and public health endpoints confirm the deployed revision.

### Production request flow

```text
Namecheap / Cloudflare DNS
  -> GCP static IP
  -> Nginx
  -> Node / Express on localhost:3002
  -> local PostgreSQL on localhost:5432
```

The database is not exposed directly to the public internet.

---

## Main Features

### Dashboard

Signed-in users land on a general Phishtopia dashboard rather than being pushed into one particular application. It provides a compact mobile-first starting point for projects and account management.

A future issue tracks a small “Continue where you left off” section, but it will not be added until individual features expose trustworthy resumable activity.

### YouList

YouList is a personal movie and television watchlist using the TMDB API.

Current capabilities include:

- movie and television search
- title details, cast, crew, posters, genres, and release information
- authenticated personal lists
- user comments and notes
- PostgreSQL-backed storage
- pagination and API caching
- responsive card layouts

### EchoTrace

EchoTrace analyzes public EVE Echoes killmail data to identify character activity patterns and connections.

Current capabilities include:

- player search by name or ID
- killer and victim filtering
- date-range filtering
- region, constellation, and system summaries
- activity-by-hour visualization
- public page-specific sharing metadata

The canonical public route is `/echotrace`.

### StoreCalc Online

StoreCalc Online is the web successor to an earlier Bash and Android commissary-order calculator originally designed around Hays State Prison commissary ordering.

The current `/storecalc` page establishes the public project location and branding. The next major development phase is to turn it into a clean, tested calculator with plain JavaScript calculation functions, a phone-friendly order workflow, and no unnecessary account or database dependency in the first release.

### Project Archive

The public `/archive` page preserves selected earlier projects and course work without forcing retired implementation details into the active application.

The most recent preserved source snapshot is kept on:

```text
archive/course-projects-2026-07-28
```

That branch is historical reference material, not a production deployment branch.

### Privacy and Account Controls

Phishtopia includes:

- a public `/privacy` page written in plain language
- account settings and password controls
- browser-form CSRF protection
- secure self-service account deletion
- transactional deletion of owned account data
- privacy-conscious limits on logging and diagnostics

### Social Sharing and SEO

Public pages publish distinct titles, descriptions, share images, image dimensions, MIME types, and accessible image alt text. Authentication, account, and dashboard pages retain a safe branded fallback and are not intended as public search landing pages.

The dedicated share cards are reproducible through:

```text
scripts/generate-social-cards.py
```

The public crawler files are:

```text
/robots.txt
/sitemap.xml
```

The sitemap contains only public canonical pages. Private, authenticated, internal, health, readiness, and query-result routes are omitted. `robots.txt` reinforces those boundaries for cooperative crawlers, but it is not treated as access control.

---

## Architecture

The application entry point is `index.js`, which loads `src/app.js`.

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

views/
  partials/
  ...page templates

public/
  images/
  js/
  share/
  styles/
  robots.txt
  sitemap.xml

test/
  ...Node test suites
```

Responsibilities are split across route modules, controllers, database query modules, services, middleware, EJS views, and page-specific assets. Retired course implementations are preserved in archive history instead of being treated as active compatibility architecture.

---

## Technology

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
- Axios and node-fetch
- TMDB API
- Echoes.mobi killmail API

### Production

- Google Cloud Compute Engine
- Debian 12
- Nginx
- PM2
- local PostgreSQL
- Cloudflare and Namecheap DNS management
- Certbot / Let’s Encrypt
- GitHub-based deployment from `main`
- automated PostgreSQL backups and monitoring alerts

### Development Workflow

- GitHub branches and pull requests
- GitHub Actions CI
- GitHub Codespaces
- Termux and Android testing
- Google Cloud SDK
- SSH tunnels for private database access
- Docker for local and one-off testing

---

## Production Management

The application directory on the VM is:

```text
/home/codespace/phishtopia
```

Sensitive runtime configuration is stored outside the repository. Never commit `.env` files, credentials, secret values, SQL dumps, session material, or backup files.

### Verify production

```bash
sudo -u codespace env PM2_HOME=/home/codespace/.pm2 pm2 status
curl -fsS https://phishtopia.com/health
curl -fsS https://phishtopia.com/ready
sudo systemctl status pm2-codespace --no-pager
sudo systemctl status certbot.timer --no-pager
```

### Review deployment activity

```bash
tail -80 /home/codespace/phishtopia-deploy.log
```

After a merge to `main`, confirm that the deploy log identifies the expected commit and that both public health endpoints succeed.

### View recent application logs

```bash
sudo -u codespace env PM2_HOME=/home/codespace/.pm2 \
  pm2 logs phishtopia --lines 50
```

### Manual deployment fallback

Use only when the normal deployment timer has failed or a controlled manual deployment is explicitly intended.

```bash
cd /home/codespace/phishtopia
git pull --ff-only origin main
npm ci --omit=dev
sudo -u codespace env PM2_HOME=/home/codespace/.pm2 \
  pm2 restart phishtopia --update-env
sudo -u codespace env PM2_HOME=/home/codespace/.pm2 pm2 save
```

A manual deployment still requires public health verification and log review.

---

## Local Development

```bash
git clone https://github.com/PhishyOne/Phishtopia.com.git
cd Phishtopia.com
npm install
```

Create a local `.env` file in the repository root. Do not commit it.

Common environment variables include:

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

Start the application:

```bash
npm start
```

Run the tests:

```bash
npm test
```

Local health endpoint:

```text
http://localhost:3002/health
```

---

## Private Database Access

Production PostgreSQL listens locally on the VM. Development tools should use an SSH tunnel rather than exposing PostgreSQL publicly.

```text
Codespace or Termux
  -> 127.0.0.1:5433
  -> SSH tunnel
  -> VM 127.0.0.1:5432
  -> PostgreSQL
```

Typical client settings:

```text
Host: 127.0.0.1
Port: 5433
Database: phishtopia
Username: phishtopia
SSL: disabled for the local tunnel endpoint
```

---

## Docker

Production runs directly under Node.js and PM2, but Docker remains useful for local testing and isolated utility work.

```bash
docker build -t phishtopia .
docker run --rm --env-file .env -p 8080:8080 phishtopia
```

Then open:

```text
http://localhost:8080/health
```

---

## Near-Term Roadmap

### 1. Finish the bounded SEO follow-up

Most of issue #72 is complete, including distinct page metadata, reviewed share cards, a public canonical sitemap, and crawler guidance that excludes private and utility routes. Remaining follow-up includes:

- add homepage `WebSite` structured data
- verify deployed pages with social preview tools
- verify `phishtopia.com` in Google Search Console
- submit the sitemap and request indexing for the main public pages
- import the verified property into Bing Webmaster Tools

### 2. Build StoreCalc Online

The next feature-development priority is the StoreCalc MVP:

- confirm the original calculator rules and item model
- isolate calculation logic into testable plain functions
- design the phone-first order interface
- add focused validation and calculation tests
- avoid accounts, persistence, and facility-specific sensitive data until the core calculator is correct

### 3. Resume controlled Ops work when practical

Issue #15 tracks the durable controlled operations and job layer. That work remains valuable, but it is larger and riskier than the bounded SEO cleanup or StoreCalc MVP. It should resume only with enough uninterrupted time to inspect existing branch state, preserve partial work, and verify every safety boundary.

### 4. Deferred reliability and security work

Later phases include:

- structured production logging with request IDs and strict sensitive-data exclusions
- `/.well-known/security.txt`
- transactional-email provider evaluation
- passkeys and federated sign-in with safe account linking
- personalized resumable dashboard activity after feature data supports it

---

## Working Rules

- Use branches and reviewable pull requests; do not push feature work directly to `main`.
- Preserve rollback paths and known-good production behavior.
- Keep secrets and private operational data out of GitHub, logs, comments, and assistant output.
- Prefer focused tests that prove the failure mode being fixed.
- Treat a passing structural test as insufficient when the result is visual; inspect the actual rendered asset.
- Verify automatic deployment instead of assuming a merge reached production.

---

## Author

Built by PhishyOne as an ongoing computer-science, web-development, and production-operations project.
