import pg from "pg";

const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL, // from .env
    ssl: { rejectUnauthorized: false },        // needed for Heroku/Postgres
});

export default db;
