import session from "express-session";

export function buildCookieConfig(isProd) {
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 2
    };
}

export function resolveSessionSecret(isProd) {
    const secret = process.env.SESSION_SECRET?.trim();

    if (secret) {
        if (isProd && secret.length < 32) {
            throw new Error("SESSION_SECRET must be at least 32 characters in production.");
        }
        return secret;
    }

    if (isProd) {
        throw new Error("SESSION_SECRET is required in production.");
    }

    return "dev-only-session-secret-change-me";
}

export async function buildSessionMiddleware() {
    const isProd = process.env.NODE_ENV === "production";
    const hasDbConfig = Boolean(process.env.DATABASE_URL || process.env.DB_HOST);

    const baseConfig = {
        name: "sid",
        secret: resolveSessionSecret(isProd),
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
