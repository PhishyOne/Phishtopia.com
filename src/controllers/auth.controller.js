import { pageLocals } from "../config/pageAssets.js";
import {
    authenticateUser,
    registerUser,
    resendVerificationEmail,
    verifyEmailToken
} from "../services/auth.service.js";
import {
    destroySession,
    establishAuthenticatedSession
} from "../services/session.service.js";
import {
    safePostLoginRedirect,
    safeSameSiteReferer
} from "../utils/redirects.js";

const LOG_AUTH_EVENTS = process.env.LOG_AUTH_EVENTS === "true";
const LOCAL_DB_MESSAGE = "This action is unavailable in the local preview because no database is configured.";
const GENERIC_RESEND_MESSAGE = "If an unverified account exists for that address, a new verification email has been sent.";

function isLocalDatabaseUnavailable(error) {
    return process.env.NODE_ENV !== "production" && error?.code === "DB_CONFIG_MISSING";
}

function renderRegister(res, {
    error = null,
    username = "",
    email = "",
    status = 200
} = {}) {
    return res.status(status).render("register", pageLocals("register", {
        error,
        username,
        email,
        password: ""
    }));
}

function renderLogin(res, {
    error = null,
    username = "",
    returnTo = "",
    status = 200
} = {}) {
    return res.status(status).render("login", pageLocals("login", {
        error,
        username,
        password: "",
        returnTo
    }));
}

function renderResendVerification(res, {
    error = null,
    message = null,
    email = "",
    status = 200
} = {}) {
    return res.status(status).render("resend-verification", pageLocals("resendVerification", {
        error,
        message,
        email
    }));
}

export function showRegister(req, res) {
    return renderRegister(res);
}

export function showLogin(req, res) {
    if (Object.hasOwn(req.query, "returnTo")) {
        const returnTo = safePostLoginRedirect(req.query.returnTo, null);
        if (returnTo) req.session.returnTo = returnTo;
        else delete req.session.returnTo;
    }

    const returnTo = safePostLoginRedirect(req.session.returnTo, null) || "";
    return renderLogin(res, { returnTo });
}

export function showResendVerification(req, res) {
    return renderResendVerification(res);
}

export function createVerifyEmailHandler({ verifyToken = verifyEmailToken } = {}) {
    return async function verifyEmailHandler(req, res) {
        res.set("Cache-Control", "no-store");
        res.set("Referrer-Policy", "no-referrer");

        try {
            const result = await verifyToken(req.query.token);
            return res.status(result.status).type("text/plain").send(result.message);
        } catch (err) {
            console.error(err);
            if (isLocalDatabaseUnavailable(err)) {
                return res.status(503).type("text/plain").send(LOCAL_DB_MESSAGE);
            }
            return res.status(500).type("text/plain").send("Server error");
        }
    };
}

export const verifyEmail = createVerifyEmailHandler();

export async function register(req, res) {
    const { username, password, email } = req.body;
    const confirmPassword = req.body.confirm_password ?? req.body.confirmPassword;

    try {
        const result = await registerUser({ username, password, confirmPassword, email });

        if (!result.ok) {
            return renderRegister(res, {
                status: result.status || 400,
                error: result.error,
                username: result.values?.username || username,
                email: result.values?.email || email
            });
        }

        return res.render("check-email", pageLocals("checkEmail", {
            email: result.email,
            verifyUrl: result.verifyUrl,
            emailSent: result.emailSent,
            verificationExpiresAt: result.verificationExpiresAt
        }));
    } catch (err) {
        console.error(err);
        if (isLocalDatabaseUnavailable(err)) {
            return renderRegister(res, {
                status: 503,
                error: LOCAL_DB_MESSAGE,
                username,
                email
            });
        }
        return res.status(500).send("Server error");
    }
}

export async function resendVerification(req, res) {
    const email = req.body.email;

    try {
        const result = await resendVerificationEmail({ email });
        if (!result.ok) {
            return renderResendVerification(res, {
                status: result.status || 400,
                error: result.error,
                email: result.email || email
            });
        }

        return renderResendVerification(res, {
            message: GENERIC_RESEND_MESSAGE,
            email: ""
        });
    } catch (err) {
        console.error(err);
        if (isLocalDatabaseUnavailable(err)) {
            return renderResendVerification(res, {
                status: 503,
                error: LOCAL_DB_MESSAGE,
                email
            });
        }
        return res.status(500).send("Server error");
    }
}

export function resolveLoginReturnTo(bodyReturnTo, sessionReturnTo, fallback = "/") {
    const postedReturnTo = safePostLoginRedirect(bodyReturnTo, null);
    if (postedReturnTo) return postedReturnTo;

    return safePostLoginRedirect(sessionReturnTo, fallback);
}

export async function login(req, res) {
    const { username, password } = req.body;
    const returnTo = resolveLoginReturnTo(req.body.returnTo, req.session.returnTo, null) || "";
    if (LOG_AUTH_EVENTS) console.log("Login attempt:", { username });

    try {
        const result = await authenticateUser({ username, password });

        if (!result.ok) {
            return renderLogin(res, {
                error: result.error,
                username,
                returnTo
            });
        }

        const redirectTo = returnTo || "/dashboard";
        await establishAuthenticatedSession(req, result.user);

        return res.redirect(redirectTo);
    } catch (err) {
        console.error(err);
        if (isLocalDatabaseUnavailable(err)) {
            return renderLogin(res, {
                status: 503,
                error: LOCAL_DB_MESSAGE,
                username,
                returnTo
            });
        }
        return res.status(500).send("Server error");
    }
}

export async function logout(req, res) {
    const redirectTo = safeSameSiteReferer(req.get("Referer"), "/");

    try {
        await destroySession(req);
        res.clearCookie("sid", { path: "/" });
        return res.redirect(redirectTo);
    } catch (err) {
        console.error(err);
        return res.status(500).send("Logout failed");
    }
}
