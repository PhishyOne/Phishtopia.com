import { randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function isValidToken(value) {
    return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function ensureCsrfToken(req) {
    if (!req.session) {
        throw new Error("Session middleware is required before CSRF middleware");
    }

    if (!isValidToken(req.session.csrfToken)) {
        req.session.csrfToken = randomBytes(TOKEN_BYTES).toString("base64url");
    }

    return req.session.csrfToken;
}

export function provideCsrfToken(req, res, next) {
    try {
        res.locals.csrfToken = ensureCsrfToken(req);
        next();
    } catch (error) {
        next(error);
    }
}

export function requireCsrfToken(req, res, next) {
    const expected = req.session?.csrfToken;
    const provided = req.get("x-csrf-token");

    if (!isValidToken(expected) || !isValidToken(provided)) {
        return res.status(403).json({ success: false, error: "Invalid request token" });
    }

    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (
        expectedBuffer.length !== providedBuffer.length ||
        !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
        return res.status(403).json({ success: false, error: "Invalid request token" });
    }

    next();
}
