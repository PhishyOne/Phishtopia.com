import { authenticateUser, registerUser, verifyEmailToken } from "../services/auth.service.js";
import {
    destroySession,
    establishAuthenticatedSession
} from "../services/session.service.js";
import {
    safeInternalRedirect,
    safeSameSiteReferer
} from "../utils/redirects.js";

const LOG_AUTH_EVENTS = process.env.LOG_AUTH_EVENTS === "true";
const LOCAL_DB_MESSAGE = "This action is unavailable in the local preview because no database is configured.";

function isLocalDatabaseUnavailable(error) {
    return process.env.NODE_ENV !== "production" && error?.code === "DB_CONFIG_MISSING";
}

function renderRegister(res, {
    error = null,
    username = "",
    email = "",
    status = 200
} = {}) {
    return res.status(status).render("register", {
        title: "Register",
        bodyClass: "register",
        extraStyles: [],
        extraScripts: [],
        error,
        username,
        email,
        password: ""
    });
}

function renderLogin(res, {
    error = null,
    username = "",
    status = 200
} = {}) {
    return res.status(status).render("login", {
        title: "Login",
        bodyClass: "auth",
        extraStyles: [],
        extraScripts: [],
        error,
        username,
        password: ""
    });
}

export function showRegister(req, res) {
    return renderRegister(res);
}

export function showLogin(req, res) {
    if (req.query.returnTo) {
        const returnTo = safeInternalRedirect(req.query.returnTo, null);
        if (returnTo) req.session.returnTo = returnTo;
        else delete req.session.returnTo;
    }

    return renderLogin(res);
}

export async function verifyEmail(req, res) {
    try {
        const result = await verifyEmailToken(req.query.token);
        return res.send(result.message);
    } catch (err) {
        console.error(err);
        if (isLocalDatabaseUnavailable(err)) {
            return res.status(503).send(LOCAL_DB_MESSAGE);
        }
        return res.status(500).send("Server error");
    }
}

export async function register(req, res) {
    const { username, password, email } = req.body;
    const confirmPassword = req.body.confirm_password ?? req.body.confirmPassword;

    try {
        const result = await registerUser({ username, password, confirmPassword, email });

        if (!result.ok) {
            return renderRegister(res, {
                error: result.error,
                username: result.values?.username || username,
                email: result.values?.email || email
            });
        }

        return res.render("check-email", {
            email: result.email,
            verifyUrl: result.verifyUrl,
            emailSent: result.emailSent
        });
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

export async function login(req, res) {
    const { username, password } = req.body;
    if (LOG_AUTH_EVENTS) console.log("Login attempt:", { username });

    try {
        const result = await authenticateUser({ username, password });

        if (!result.ok) {
            return renderLogin(res, {
                error: result.error,
                username
            });
        }

        const redirectTo = safeInternalRedirect(req.session.returnTo, "/");
        await establishAuthenticatedSession(req, result.user);

        return res.redirect(redirectTo);
    } catch (err) {
        console.error(err);
        if (isLocalDatabaseUnavailable(err)) {
            return renderLogin(res, {
                status: 503,
                error: LOCAL_DB_MESSAGE,
                username
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
