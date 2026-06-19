import bcrypt from "bcrypt";
import crypto from "crypto";
import db from "../../app-brewery-server/db.js";
import {
    createUser,
    findUserByUsername,
    findUserByUsernameOrEmail,
    verifyUserEmailByToken
} from "../db/user.queries.js";
import { sendVerificationEmail } from "./email.service.js";

const SALT_ROUNDS = 10;

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

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return "Enter a valid email address";
    }

    if (password.length < 8) {
        return "Password must be at least 8 characters";
    }

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

export async function registerUser(input) {
    const values = normalizeRegisterInput(input);
    const validationError = buildRegisterValidationError(values);

    if (validationError) {
        return { ok: false, status: 400, error: validationError, values };
    }

    const existingUser = await findUserByUsernameOrEmail(values);
    if (existingUser) {
        const sameUsername = existingUser.username?.toLowerCase() === values.username.toLowerCase();
        return {
            ok: false,
            status: 409,
            error: sameUsername ? "Username already exists" : "Email already exists",
            values
        };
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(values.password, SALT_ROUNDS);
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        await createUser({
            username: values.username,
            passwordHash,
            email: values.email,
            verificationToken
        }, client);

        const emailResult = await sendVerificationEmail({
            email: values.email,
            verificationToken
        });

        await client.query("COMMIT");

        return {
            ok: true,
            email: values.email,
            verifyUrl: emailResult.verifyUrl
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
            username: user.username
        }
    };
}

export async function verifyEmailToken(token) {
    if (!token) {
        return { ok: false, message: "Invalid token" };
    }

    const verifiedUser = await verifyUserEmailByToken(token);
    if (!verifiedUser) {
        return { ok: false, message: "Token invalid or expired" };
    }

    return { ok: true, message: "Email verified! You can now log in." };
}
