import { authenticateUser, registerUser, verifyEmailToken } from "../services/auth.service.js";

const LOG_AUTH_EVENTS = process.env.LOG_AUTH_EVENTS === "true";

function renderRegister(res, { error = null, username = "", email = "" } = {}) {
    return res.render("register", {
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

function renderLogin(res, { error = null, username = "" } = {}) {
    return res.render("login", {
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
        req.session.returnTo = req.query.returnTo;
    }

    return renderLogin(res);
}

export async function verifyEmail(req, res) {
    try {
        const result = await verifyEmailToken(req.query.token);
        return res.send(result.message);
    } catch (err) {
        console.error(err);
        return res.status(500).send("Server error");
    }
}

export async function register(req, res) {
    const { username, password, confirm_password: confirmPassword, email } = req.body;

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
            verifyUrl: result.verifyUrl
        });
    } catch (err) {
        console.error(err);
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

        req.session.user = result.user;

        const redirectTo = req.session.returnTo || "/";
        delete req.session.returnTo;

        return res.redirect(redirectTo);
    } catch (err) {
        console.error(err);
        return res.status(500).send("Server error");
    }
}

export function logout(req, res) {
    const referer = req.get("Referer");

    req.session.destroy(err => {
        if (err) return res.status(500).send("Logout failed");
        res.clearCookie("sid");
        res.redirect(referer || "/");
    });
}
