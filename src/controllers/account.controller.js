import { pageLocals } from "../config/pageAssets.js";
import { passwordPolicyLocals } from "../security/passwordPolicy.js";
import {
    changeAccountPassword,
    changeAccountUsername,
    deleteAccount as deletePhishtopiaAccount,
    getAccountDetails,
    requestAccountEmailChange,
    verifyAccountEmailChange
} from "../services/account.service.js";
import {
    destroySession,
    establishAuthenticatedSession
} from "../services/session.service.js";

const LOCAL_DB_MESSAGE = "Account management is unavailable in the local preview because no database is configured.";

function isLocalDatabaseUnavailable(error) {
    return process.env.NODE_ENV !== "production" && error?.code === "DB_CONFIG_MISSING";
}

function noticeFromQuery(value) {
    const notices = {
        username: "Username updated.",
        email: "Verification link sent to the new email address. Your current email remains active until you confirm the change.",
        password: "Password updated. Other signed-in sessions were closed."
    };

    return notices[value] || null;
}

function renderAccount(res, {
    account,
    error = null,
    notice = null,
    section = null,
    values = {},
    status = 200
}) {
    return res.status(status).render("account/index", pageLocals("account", {
        ...passwordPolicyLocals(),
        disableAnalytics: true,
        account,
        error,
        notice,
        section,
        values
    }));
}

async function renderCurrentAccount(req, res, options = {}) {
    const result = await getAccountDetails(req.session.user.id);
    if (!result.ok) {
        return res.status(result.status || 404).type("text/plain").send(result.error);
    }

    return renderAccount(res, {
        account: result.account,
        ...options
    });
}

function clearSessionCookie(res) {
    res.clearCookie("sid", {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax"
    });
}

export async function showAccount(req, res) {
    try {
        return await renderCurrentAccount(req, res, {
            notice: noticeFromQuery(req.query.updated)
        });
    } catch (error) {
        console.error(error);
        if (isLocalDatabaseUnavailable(error)) {
            return res.status(503).type("text/plain").send(LOCAL_DB_MESSAGE);
        }
        return res.status(500).type("text/plain").send("Server error");
    }
}

export function showAccountDeleted(req, res) {
    return res.render("account/deleted", pageLocals("accountDeleted", {
        disableAnalytics: true,
        robotsContent: "noindex, nofollow"
    }));
}

export async function changeUsername(req, res) {
    const username = req.body.username;

    try {
        const result = await changeAccountUsername({
            userId: req.session.user.id,
            username,
            currentPassword: req.body.currentPassword
        });

        if (!result.ok) {
            return await renderCurrentAccount(req, res, {
                status: result.status || 400,
                error: result.error,
                section: "username",
                values: { username }
            });
        }

        await establishAuthenticatedSession(req, {
            ...req.session.user,
            username: result.account.username,
            role: result.account.role
        });

        return res.redirect("/account?updated=username");
    } catch (error) {
        console.error(error);
        if (isLocalDatabaseUnavailable(error)) {
            return res.status(503).type("text/plain").send(LOCAL_DB_MESSAGE);
        }
        return res.status(500).type("text/plain").send("Server error");
    }
}

export async function requestEmailChange(req, res) {
    const email = req.body.email;

    try {
        const result = await requestAccountEmailChange({
            userId: req.session.user.id,
            email,
            currentPassword: req.body.currentPassword
        });

        if (!result.ok) {
            return await renderCurrentAccount(req, res, {
                status: result.status || 400,
                error: result.error,
                section: "email",
                values: { email }
            });
        }

        return res.redirect("/account?updated=email");
    } catch (error) {
        console.error(error);
        if (isLocalDatabaseUnavailable(error)) {
            return res.status(503).type("text/plain").send(LOCAL_DB_MESSAGE);
        }
        return res.status(500).type("text/plain").send("Server error");
    }
}

export async function changePassword(req, res) {
    try {
        const result = await changeAccountPassword({
            userId: req.session.user.id,
            currentPassword: req.body.currentPassword,
            newPassword: req.body.newPassword,
            confirmPassword: req.body.confirmPassword
        });

        if (!result.ok) {
            return await renderCurrentAccount(req, res, {
                status: result.status || 400,
                error: result.error,
                section: "password"
            });
        }

        await establishAuthenticatedSession(req, {
            id: result.account.id,
            username: result.account.username,
            role: result.account.role
        });

        return res.redirect("/account?updated=password");
    } catch (error) {
        console.error(error);
        if (isLocalDatabaseUnavailable(error)) {
            return res.status(503).type("text/plain").send(LOCAL_DB_MESSAGE);
        }
        return res.status(500).type("text/plain").send("Server error");
    }
}

export async function deleteAccount(req, res) {
    try {
        const result = await deletePhishtopiaAccount({
            userId: req.session.user.id,
            currentPassword: req.body.currentPassword,
            confirmation: req.body.confirmation
        });

        if (!result.ok) {
            return await renderCurrentAccount(req, res, {
                status: result.status || 400,
                error: result.error,
                section: "delete"
            });
        }

        try {
            await destroySession(req);
        } catch (error) {
            console.error("Failed to destroy the deleted account session.");
        }

        clearSessionCookie(res);
        return res.redirect("/account/deleted");
    } catch (error) {
        console.error(error);
        if (isLocalDatabaseUnavailable(error)) {
            return res.status(503).type("text/plain").send(LOCAL_DB_MESSAGE);
        }
        return res.status(500).type("text/plain").send("Server error");
    }
}

export function createVerifyEmailChangeHandler({ verifyToken = verifyAccountEmailChange } = {}) {
    return async function verifyEmailChangeHandler(req, res) {
        res.set("Cache-Control", "no-store");
        res.set("Referrer-Policy", "no-referrer");

        try {
            const result = await verifyToken(req.query.token);
            return res.status(result.status).type("text/plain").send(result.message);
        } catch (error) {
            console.error(error);
            if (isLocalDatabaseUnavailable(error)) {
                return res.status(503).type("text/plain").send(LOCAL_DB_MESSAGE);
            }
            return res.status(500).type("text/plain").send("Server error");
        }
    };
}

export const verifyEmailChange = createVerifyEmailChangeHandler();
