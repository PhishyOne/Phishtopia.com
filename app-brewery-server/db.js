import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { DB_USER, DB_PASSWORD, DB_HOST, DB_NAME, DB_PORT } = process.env;

const db = new pg.Client({
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    port: DB_PORT || 5432,
    database: DB_NAME,
    ssl: {
        rejectUnauthorized: false // required for some hosted Postgres like RDS
    }
});

try {
    await db.connect();
    console.log("Connected to Postgres successfully!");
} catch (err) {
    console.error("Failed to connect to Postgres:", err);
}

export default db;