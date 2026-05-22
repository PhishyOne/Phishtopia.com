import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const {
    DATABASE_URL,
    DB_USER,
    DB_PASSWORD,
    DB_HOST,
    DB_NAME,
    DB_PORT,
    DB_SSL,
    NODE_ENV
} = process.env;

const isProd = NODE_ENV === "production";
const sslDisabled = DB_SSL === "false";
const sslConfig = sslDisabled ? false : { rejectUnauthorized: false };

console.log("Database env check:", {
    hasDatabaseUrl: Boolean(DATABASE_URL),
    hasDbHost: Boolean(DB_HOST),
    hasDbName: Boolean(DB_NAME),
    nodeEnv: NODE_ENV || null,
    sslDisabled
});

if (!DATABASE_URL && !DB_HOST) {
    throw new Error("Database configuration missing: set DATABASE_URL or DB_HOST.");
}

const poolConfig = DATABASE_URL
    ? {
        connectionString: DATABASE_URL,
        ssl: sslConfig
    }
    : {
        user: DB_USER,
        password: DB_PASSWORD,
        host: DB_HOST,
        port: DB_PORT || 5432,
        database: DB_NAME,
        ssl: isProd && !sslDisabled ? sslConfig : false
    };

const pool = new pg.Pool(poolConfig);

pool.on("connect", () => console.log("Connected to Postgres successfully!"));
pool.on("error", (err) => console.error("Postgres pool error:", err));

export default pool;