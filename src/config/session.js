import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pool from "../../app-brewery-server/db.js";

const PgSession = connectPgSimple(session);

export function buildSessionMiddleware() {
    const isProd = process.env.NODE_ENV === "production";

    return session({
        name: "sid",
        store: new PgSession({
            pool,
            tableName: "session",
            createTableIfMissing: true
        }),
        secret: process.env.SESSION_SECRET || "devsecret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: isProd,
            sameSite: isProd ? "none" : "lax",
            maxAge: 1000 * 60 * 60 * 2
        }
    });
}
