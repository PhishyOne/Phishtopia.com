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

Phishtopia.com is my personal web development project hub and growing full-stack web application. It began as a place to showcase course projects and experiments, but it has grown into a larger Node.js/Express platform with authentication, PostgreSQL-backed features, third-party API integrations, original tools, and production-style cloud deployment.

The project is actively evolving as I continue learning full-stack development, improving the architecture, and turning individual experiments into more polished applications.

---

## Production Status

Phishtopia is currently deployed on **Google Cloud Run** with a custom domain:

- Production URL: `https://phishtopia.com`
- Cloud Run service: `phishtopia`
- Region: `us-east1`
- Container images stored in Google Artifact Registry
- Runtime secrets managed through Google Secret Manager
- Continuous deployment enabled through Cloud Build from the `main` branch

The current production workflow is:

```bash
git add .
git commit -m "Update site"
git push origin main
```

A push to `main` triggers Cloud Build, builds the Docker image, pushes it to Artifact Registry, and deploys a new Cloud Run revision.

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
- User comments
- PostgreSQL-backed storage
- Pagination
- API response caching
- Optional TMDB cache prewarming controlled by environment variable

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
- bcrypt
- express-session
- connect-pg-simple
- express-rate-limit
- Nodemailer
- Axios
- node-fetch
- TMDB API
- Echoes.mobi killmail API

### Deployment / Infrastructure

- Docker
- Google Cloud Run
- Google Artifact Registry
- Google Secret Manager
- Google Cloud Build
- Google-managed HTTPS certificates
- Custom domain mapping for `phishtopia.com`

---

## Project Goals

Phishtopia is both a portfolio and a learning platform. My goals are to keep improving it as a real production-style application while practicing:

- Full-stack application architecture
- Authentication and session handling
- API integration
- PostgreSQL schema design
- Deployment and cloud migration
- Containerized application deployment
- Continuous deployment workflows
- User-focused interface design
- Performance, caching, and logging
- Clean project organization

---

## Planned Improvements

- Finish testing login/session behavior on the production domain
- Finish `www.phishtopia.com` certificate/canonical redirect verification
- Create a current Postgres production backup using a PostgreSQL 17 `pg_dump` client
- Evaluate whether to keep the current hosted PostgreSQL database or migrate to Cloud SQL for PostgreSQL
- Add better analytics and usage tracking
- Improve authentication flows, including email verification, password reset, and account management
- Improve project organization by separating routes, services, and database logic
- Move remaining mature projects out of the old App Brewery structure
- Continue improving EchoTrace and YouList with more polished features

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

Create a `.env` file in the project root. Use `.env.example` as the starting point:

```bash
cp .env.example .env
```

Important environment variables include:

```bash
PORT=3002
NODE_ENV=development
SESSION_SECRET=

DATABASE_URL=
# or DB_USER / DB_PASSWORD / DB_HOST / DB_NAME / DB_PORT

TMDB_API_KEY=
EMAIL_USER=
EMAIL_PASS=

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

## Docker

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

The application supports either a full `DATABASE_URL` connection string or split database variables such as `DB_USER`, `DB_HOST`, and `DB_NAME`.

Production currently uses `DATABASE_URL` from Google Secret Manager. Sessions are stored in PostgreSQL through `connect-pg-simple`, using the shared configured database pool.

Before migrating or deleting any old database provider, create a production backup. The current production database uses PostgreSQL 17, so use a PostgreSQL 17-compatible `pg_dump` client. One simple option is Docker:

```bash
DATABASE_URL="$(gcloud secrets versions access latest --secret=phishtopia-database-url)"

docker run --rm \
  -e DATABASE_URL="$DATABASE_URL" \
  -v "$PWD:/backup" \
  postgres:17 \
  pg_dump "$DATABASE_URL" \
    --format=custom \
    --no-owner \
    --no-acl \
    --file="/backup/phishtopia-prod-$(date +%Y%m%d%H%M%S).dump"
```

Do not commit database dumps or backup files to GitHub.

---

## Notes

This project is actively under development. Some features are experimental, and parts of the codebase still reflect its origin as a learning/coursework project.

The long-term goal is to continue refactoring Phishtopia into a cleaner, scalable, production-style web application while keeping it useful, creative, and fun to build.

---

## Author

Built by PhishyOne as part of an ongoing web development learning journey.
