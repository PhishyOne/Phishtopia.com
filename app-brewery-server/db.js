import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { DATABASE_URL, DB_USER, DB_PASSWORD, DB_HOST, DB_NAME, DB_PORT, NODE_ENV } = process.env;
const isProd = NODE_ENV === "production";

const poolConfig = DATABASE_URL
    ? {
        connectionString: DATABASE_URL,
        ssl: isProd ? { rejectUnauthorized: false } : false
    }
    : {
        user: DB_USER,
        password: DB_PASSWORD,
        host: DB_HOST,
        port: DB_PORT || 5432,
        database: DB_NAME,
        ssl: isProd ? { rejectUnauthorized: false } : false
    };

const pool = new pg.Pool(poolConfig);

pool.on("connect", () => console.log("Connected to Postgres successfully!"));
pool.on("error", (err) => console.error("Postgres pool error:", err));

export default pool;
