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

Phishtopia.com is my personal web development project hub and growing full-stack web application. It began as a place to showcase course projects and experiments, but it has grown into a larger Node.js/Express platform with authentication, PostgreSQL-backed features, third-party API integrations, and original tools.

The project is actively evolving as I continue learning full-stack development, improving the architecture, and turning individual experiments into more polished applications.

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

- Node.js
- Express
- EJS
- PostgreSQL
- bcrypt
- express-session
- express-rate-limit
- Nodemailer
- Axios
- TMDB API
- Echoes.mobi killmail API
- Heroku deployment

---

## Project Goals

Phishtopia is both a portfolio and a learning platform. My goals are to keep improving it as a real production-style application while practicing:

- Full-stack application architecture
- Authentication and session handling
- API integration
- PostgreSQL schema design
- Deployment and cloud migration
- User-focused interface design
- Performance, caching, and logging
- Clean project organization

---

## Planned Improvements

- Move hosting and database services toward Google Cloud
- Add better analytics and usage tracking
- Improve authentication flows, including email verification, password reset, and account management
- Add a `.env.example` file for easier local setup
- Add Docker support
- Add a health check route
- Improve project organization by separating routes, services, and database logic
- Move remaining mature projects out of the old App Brewery structure
- Continue improving EchoTrace and YouList with more polished features

---

## Local Development

Clone the repository:

git clone https://github.com/PhishyOne/Phishtopia.com.git
cd Phishtopia.com

Install dependencies:

npm install

Create a .env file in the project root:

DB_USER=
DB_PASSWORD=
DB_HOST=
DB_NAME=
DB_PORT=5432

SESSION_SECRET=
TMDB_API_KEY=

EMAIL_USER=

Start the server:

npm start

The app runs locally on:

http://localhost:3002


---

Notes

This project is actively under development. Some features are experimental, and parts of the codebase still reflect its origin as a learning/coursework project.

The long-term goal is to continue refactoring Phishtopia into a cleaner, scalable, production-style web application while keeping it useful, creative, and fun to build.


---

Author

Built by PhishyOne as part of an ongoing web development learning journey.

