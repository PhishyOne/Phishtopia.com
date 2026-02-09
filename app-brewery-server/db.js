import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { DB_USER, DB_PASSWORD, DB_HOST, DB_NAME, DB_PORT } = process.env;

const pool = new pg.Pool({
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    port: DB_PORT || 5432,
    database: DB_NAME,
    ssl: { rejectUnauthorized: false }
});

pool.on("connect", () => console.log("Connected to Postgres successfully!"));
pool.on("error", (err) => console.error("Postgres pool error:", err));

export default pool;
