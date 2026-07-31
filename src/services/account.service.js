import bcrypt from "bcryptjs";

import db from "../db/pool.js";
import {
    deleteUserSessions,
    findOtherUserByEmail,
    findOtherUserByUsername,
    findUserAccountById,
    setPendingEmailChange,
    updatePasswordHash,
    updateUsername,
    verifyPendingEmailChangeByToken
} from "../db/user.queries.js";
import {
    createEmailVerificationToken,
    inspectEmailVerificationToken
} from "../security/emailVerificationToken.js";
import { sendEmailChangeVerificationEmail } from "./email.service.js";

const SALT_ROUNDS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_USERNAME_LENGTH = 50;
const MAX_PASSWORD_LENGTH = 128;

function publicAccount(user) {
    if (!user) return null;

    return {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerified: Boolean(user.email_verified),
        pendingEmail: user.pending_email || null,
        role: user.role || "user"
    };
}

function makeVerificationToken(dependencies) {
    const options = {};
    if (dependencies.now !== undefined) options.now = dependencies.now;
    if (dependencies.randomBytes !== undefined) options.randomBytes = dependencies.randomBytes;
    if (dependencies.tokenTtlMs !== undefined) options.ttlMs = dependencies.tokenTtlMs;
    return createEmailVerificationToken(options);
}

async function loadUser(userId, dependencies) {
    const findAccount = dependencies.findAccount || findUserAccountById;
    return findAccount(userId);
}

async function currentPasswordMatches(user, currentPassword, dependencies) {
    if (!currentPassword) return false;
    const comparePassword = dependencies.comparePassword || bcrypt.compare;
    return comparePassword(currentPassword, user.password_hash);
}

function duplicateMessage(error, fallback) {
    if (error?.code !== "23505") return null;
    return fallback;
}

export async function getAccountDetails(userId, dependencies = {}) {
    const user = await loadUser(userId, dependencies);
    if (!user) {
        return { ok: false, status: 404, error: "Account not found." };
    }

    return { ok: true, account: publicAccount(user) };
}

export async function changeAccountUsername(input, dependencies = {}) {
    const userId = input?.userId;
    const username = input?.username?.trim() || "";
    const currentPassword = input?.currentPassword || "";

    if (username.length < 3 || username.length > MAX_USERNAME_LENGTH) {
        return {
            ok: false,
            status: 400,
            error: `Username must be between 3 and ${MAX_USERNAME_LENGTH} characters.`
        };
    }

    const user = await loadUser(userId, dependencies);
    if (!user) return { ok: false, status: 404, error: "Account not found." };

    if (!(await currentPasswordMatches(user, currentPassword, dependencies))) {
        return { ok: false, status: 400, error: "Current password is incorrect." };
    }

    if (username === user.username) {
        return { ok: false, status: 400, error: "That is already your username." };
    }

    const findConflict = dependencies.findUsernameConflict || findOtherUserByUsername;
    if (await findConflict({ userId, username })) {
        return { ok: false, status: 409, error: "Username already exists." };
    }

    const connectDb = dependencies.connectDb || (() => db.connect());
    const updateRecord = dependencies.updateUsernameRecord || updateUsername;
    const removeSessions = dependencies.deleteSessions || deleteUserSessions;
    const client = await connectDb();

    try {
        await client.query("BEGIN");
        const updated = await updateRecord({ userId, username }, client);
        if (!updated) throw new Error("Account disappeared during username update.");
        await removeSessions(userId, client);
        await client.query("COMMIT");
        return { ok: true, account: publicAccount(updated) };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => null);
        const message = duplicateMessage(error, "Username already exists.");
        if (message) return { ok: false, status: 409, error: message };
        throw error;
    } finally {
        client.release();
    }
}

export async function requestAccountEmailChange(input, dependencies = {}) {
    const userId = input?.userId;
    const email = input?.email?.trim().toLowerCase() || "";
    const currentPassword = input?.currentPassword || "";

    if (!EMAIL_PATTERN.test(email)) {
        return { ok: false, status: 400, error: "Enter a valid email address." };
    }

    const user = await loadUser(userId, dependencies);
    if (!user) return { ok: false, status: 404, error: "Account not found." };

    if (!(await currentPasswordMatches(user, currentPassword, dependencies))) {
        return { ok: false, status: 400, error: "Current password is incorrect." };
    }

    if (email === user.email?.toLowerCase()) {
        return { ok: false, status: 400, error: "That is already your email address." };
    }

    const findConflict = dependencies.findEmailConflict || findOtherUserByEmail;
    if (await findConflict({ userId, email })) {
        return { ok: false, status: 409, error: "Email address is already in use." };
    }

    const { token: verificationToken, expiresAt } = makeVerificationToken(dependencies);
    const connectDb = dependencies.connectDb || (() => db.connect());
    const setPendingEmail = dependencies.setPendingEmail || setPendingEmailChange;
    const sendEmail = dependencies.sendEmail || sendEmailChangeVerificationEmail;
    const client = await connectDb();

    try {
        await client.query("BEGIN");
        const updated = await setPendingEmail({
            userId,
            email,
            verificationToken
        }, client);
        if (!updated) throw new Error("Account disappeared during email update.");

        const emailResult = await sendEmail({
            email,
            verificationToken,
            expiresAt
        });

        await client.query("COMMIT");
        return {
            ok: true,
            account: publicAccount(updated),
            emailSent: emailResult.sent,
            verifyUrl: emailResult.verifyUrl,
            verificationExpiresAt: expiresAt
        };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => null);
        const message = duplicateMessage(error, "Email address is already in use.");
        if (message) return { ok: false, status: 409, error: message };
        throw error;
    } finally {
        client.release();
    }
}

export async function changeAccountPassword(input, dependencies = {}) {
    const userId = input?.userId;
    const currentPassword = input?.currentPassword || "";
    const newPassword = input?.newPassword || "";
    const confirmPassword = input?.confirmPassword || "";

    if (newPassword.length < 8 || newPassword.length > MAX_PASSWORD_LENGTH) {
        return {
            ok: false,
            status: 400,
            error: `New password must be between 8 and ${MAX_PASSWORD_LENGTH} characters.`
        };
    }

    if (newPassword !== confirmPassword) {
        return { ok: false, status: 400, error: "New passwords do not match." };
    }

    const user = await loadUser(userId, dependencies);
    if (!user) return { ok: false, status: 404, error: "Account not found." };

    if (!(await currentPasswordMatches(user, currentPassword, dependencies))) {
        return { ok: false, status: 400, error: "Current password is incorrect." };
    }

    const comparePassword = dependencies.comparePassword || bcrypt.compare;
    if (await comparePassword(newPassword, user.password_hash)) {
        return { ok: false, status: 400, error: "Choose a password you are not already using." };
    }

    const hashPassword = dependencies.hashPassword || (password => bcrypt.hash(password, SALT_ROUNDS));
    const passwordHash = await hashPassword(newPassword);
    const connectDb = dependencies.connectDb || (() => db.connect());
    const updateRecord = dependencies.updatePasswordRecord || updatePasswordHash;
    const removeSessions = dependencies.deleteSessions || deleteUserSessions;
    const client = await connectDb();

    try {
        await client.query("BEGIN");
        const updated = await updateRecord({ userId, passwordHash }, client);
        if (!updated) throw new Error("Account disappeared during password update.");
        await removeSessions(userId, client);
        await client.query("COMMIT");
        return { ok: true, account: publicAccount(updated) };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => null);
        throw error;
    } finally {
        client.release();
    }
}

export async function verifyAccountEmailChange(token, dependencies = {}) {
    const normalizedToken = typeof token === "string" ? token.trim() : "";
    const tokenState = inspectEmailVerificationToken(normalizedToken, {
        now: dependencies.now === undefined ? Date.now : dependencies.now
    });

    if (!tokenState.ok) {
        return {
            ok: false,
            status: tokenState.status,
            message: tokenState.reason === "expired"
                ? "Email-change link has expired. Request another change from your account page."
                : "Email-change link is invalid."
        };
    }

    const verifyByToken = dependencies.verifyByToken || verifyPendingEmailChangeByToken;
    const updated = await verifyByToken(normalizedToken);
    if (!updated) {
        return {
            ok: false,
            status: 400,
            message: "Email-change link is invalid, already used, or the address is no longer available."
        };
    }

    return {
        ok: true,
        status: 200,
        message: `Email updated to ${updated.email}. You can return to Phishtopia.`
    };
}
