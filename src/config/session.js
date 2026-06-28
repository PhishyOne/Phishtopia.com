import session from "express-session";

function buildCookieConfig(isProd) {
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        maxAge: 1000 * 60 * 60 * 2
    };
}

export async function buildSessionMiddleware() {
    const isProd = process.env.NODE_ENV === "production";
    const hasDbConfig = Boolean(process.env.DATABASE_URL || process.env.DB_HOST);

    const baseConfig = {
        name: "sid",
        secret: process.env.SESSION_SECRET || "devsecret",
        resave: false,
        saveUninitialized: false,
        cookie: buildCookieConfig(isProd)
    };

    if (!hasDbConfig) {
        if (isProd) {
            throw new Error("Session database configuration missing in production.");
        }

        console.warn("Using in-memory session store for local development.");

        return session(baseConfig);
    }

    const connectPgSimple = (await import("connect-pg-simple")).default;
    const pool = (await import("../db/pool.js")).default;
    const PgSession = connectPgSimple(session);

    return session({
        ...baseConfig,
        store: new PgSession({
            pool,
            tableName: "session",
            createTableIfMissing: true
        })
    });
}