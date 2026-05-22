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
    NODE_ENV,
    LOG_DB_CONFIG
} = process.env;

const isProd = NODE_ENV === "production";
const sslDisabled = DB_SSL === "false";
const sslConfig = sslDisabled ? false : { rejectUnauthorized: false };
const logDbConfig = LOG_DB_CONFIG === "true";

if (logDbConfig) {
    console.log("Database env check:", {
        hasDatabaseUrl: Boolean(DATABASE_URL),
        hasDbHost: Boolean(DB_HOST),
        hasDbName: Boolean(DB_NAME),
        nodeEnv: NODE_ENV || null,
        sslDisabled
    });
}

if (!DATABASE_URL && !DB_HOST) {
    throw new Error("Database configuration missing: set DATABASE_URL or DB_HOST.");
}

function buildDatabaseUrlConfig(databaseUrl) {
    const url = new URL(databaseUrl);

    return {
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        host: url.hostname,
        port: Number(url.port || 5432),
        database: url.pathname.replace("/", ""),
        ssl: sslConfig
    };
}

const poolConfig = DATABASE_URL
    ? buildDatabaseUrlConfig(DATABASE_URL)
    : {
        user: DB_USER,
        password: DB_PASSWORD,
        host: DB_HOST,
        port: Number(DB_PORT || 5432),
        database: DB_NAME,
        ssl: isProd && !sslDisabled ? sslConfig : false
    };

if (logDbConfig) {
    console.log("Database connection target:", {
        host: poolConfig.host,
        port: poolConfig.port,
        database: poolConfig.database,
        hasUser: Boolean(poolConfig.user),
        hasPassword: Boolean(poolConfig.password),
        ssl: Boolean(poolConfig.ssl)
    });
}

const pool = new pg.Pool(poolConfig);

pool.on("connect", () => {
    if (logDbConfig) console.log("Connected to Postgres successfully!");
});
pool.on("error", (err) => console.error("Postgres pool error:", err));

export default pool;
