import bcrypt from "bcryptjs";
import db from "../db/pool.js";
import {
    createUser,
    findUserByEmail,
    findUserByUsername,
    findUserByUsernameOrEmail,
    updateUserVerificationToken,
    verifyUserEmailByToken
} from "../db/user.queries.js";
import {
    createEmailVerificationToken,
    inspectEmailVerificationToken
} from "../security/emailVerificationToken.js";
import { passwordLengthError } from "../security/passwordPolicy.js";
import { sendVerificationEmail } from "./email.service.js";

const SALT_ROUNDS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRegisterInput({ username, password, confirmPassword, email }) {
    return {
        username: username?.trim() || "",
        email: email?.trim().toLowerCase() || "",
        password: password || "",
        confirmPassword: confirmPassword || ""
    };
}

function buildRegisterValidationError({ username, password, confirmPassword, email }) {
    if (!username || !password || !confirmPassword || !email) {
        return "All fields are required";
    }

    if (username.length < 3) {
        return "Username must be at least 3 characters";
    }

    if (!EMAIL_PATTERN.test(email)) {
        return "Enter a valid email address";
    }

    const passwordError = passwordLengthError(password);
    if (passwordError) return passwordError;

    if (password !== confirmPassword) {
        return "Passwords do not match";
    }

    return null;
}

function duplicateUserMessage(err) {
    if (err.code !== "23505") return null;

    if (err.constraint?.includes("username")) {
        return "Username already exists";
    }

    if (err.constraint?.includes("email")) {
        return "Email already exists";
    }

    return "Already exists";
}

function makeVerificationToken(dependencies) {
    const options = {};
    if (dependencies.now !== undefined) options.now = dependencies.now;
    if (dependencies.randomBytes !== undefined) options.randomBytes = dependencies.randomBytes;
    if (dependencies.tokenTtlMs !== undefined) options.ttlMs = dependencies.tokenTtlMs;
    return createEmailVerificationToken(options);
}

export async function registerUser(input, dependencies = {}) {
    const values = normalizeRegisterInput(input);
    const validationError = buildRegisterValidationError(values);

    if (validationError) {
        return { ok: false, status: 400, error: validationError, values };
    }

    const findExistingUser = dependencies.findExistingUser || findUserByUsernameOrEmail;
    const existingUser = await findExistingUser(values);
    if (existingUser) {
        const sameUsername = existingUser.username?.toLowerCase() === values.username.toLowerCase();
        return {
            ok: false,
            status: 409,
            error: sameUsername ? "Username already exists" : "Email already exists",
            values
        };
    }

    const { token: verificationToken, expiresAt } = makeVerificationToken(dependencies);
    const hashPassword = dependencies.hashPassword || (password => bcrypt.hash(password, SALT_ROUNDS));
    const passwordHash = await hashPassword(values.password);
    const connectDb = dependencies.connectDb || (() => db.connect());
    const createUserRecord = dependencies.createUserRecord || createUser;
    const sendEmail = dependencies.sendEmail || sendVerificationEmail;
    const client = await connectDb();

    try {
        await client.query("BEGIN");

        await createUserRecord({
            username: values.username,
            passwordHash,
            email: values.email,
            verificationToken
        }, client);

        const emailResult = await sendEmail({
            email: values.email,
            verificationToken,
            expiresAt
        });

        await client.query("COMMIT");

        return {
            ok: true,
            email: values.email,
            verifyUrl: emailResult.verifyUrl,
            emailSent: emailResult.sent,
            verificationExpiresAt: expiresAt
        };
    } catch (err) {
        await client.query("ROLLBACK").catch(() => null);

        const duplicateMessage = duplicateUserMessage(err);
        if (duplicateMessage) {
            return { ok: false, status: 409, error: duplicateMessage, values };
        }

        throw err;
    } finally {
        client.release();
    }
}

export async function resendVerificationEmail(input, dependencies = {}) {
    const email = input?.email?.trim().toLowerCase() || "";
    if (!EMAIL_PATTERN.test(email)) {
        return { ok: false, status: 400, error: "Enter a valid email address", email };
    }

    const findByEmail = dependencies.findByEmail || findUserByEmail;
    const user = await findByEmail(email);

    // Keep the public response generic so this endpoint cannot enumerate accounts.
    if (!user || user.email_verified) {
        return { ok: true, email, sent: false };
    }

    const { token: verificationToken, expiresAt } = makeVerificationToken(dependencies);
    const connectDb = dependencies.connectDb || (() => db.connect());
    const updateVerificationToken = dependencies.updateVerificationToken || updateUserVerificationToken;
    const sendEmail = dependencies.sendEmail || sendVerificationEmail;
    const client = await connectDb();

    try {
        await client.query("BEGIN");
        const updated = await updateVerificationToken({
            userId: user.id,
            verificationToken
        }, client);

        let emailResult = { sent: false };
        if (updated) {
            emailResult = await sendEmail({
                email: user.email,
                verificationToken,
                expiresAt
            });
        }

        await client.query("COMMIT");
        return {
            ok: true,
            email,
            sent: Boolean(updated && emailResult.sent),
            verificationExpiresAt: updated ? expiresAt : null
        };
    } catch (err) {
        await client.query("ROLLBACK").catch(() => null);
        throw err;
    } finally {
        client.release();
    }
}

export async function authenticateUser({ username, password }) {
    const user = await findUserByUsername(username);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return { ok: false, error: "Invalid credentials" };
    }

    if (!user.email_verified) {
        return { ok: false, error: "Please verify your email first" };
    }

    return {
        ok: true,
        user: {
            id: user.id,
            username: user.username,
            role: user.role || "user"
        }
    };
}

export async function verifyEmailToken(token, dependencies = {}) {
    const normalizedToken = typeof token === "string" ? token.trim() : "";
    const tokenState = inspectEmailVerificationToken(normalizedToken, {
        now: dependencies.now === undefined ? Date.now : dependencies.now
    });

    if (!tokenState.ok) {
        if (tokenState.reason === "expired") {
            return {
                ok: false,
                status: 410,
                message: "Verification link has expired. Request a new verification email."
            };
        }

        return {
            ok: false,
            status: 400,
            message: "Verification link is invalid."
        };
    }

    const verifyByToken = dependencies.verifyByToken || verifyUserEmailByToken;
    const verifiedUser = await verifyByToken(normalizedToken);
    if (!verifiedUser) {
        return {
            ok: false,
            status: 400,
            message: "Verification link is invalid or has already been used."
        };
    }

    return {
        ok: true,
        status: 200,
        message: "Email verified! You can now log in."
    };
}
