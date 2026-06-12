import bcrypt from "bcrypt";
import crypto from "crypto";
import { createUser, findUserByUsername, verifyUserEmailByToken } from "../db/user.queries.js";
import { sendVerificationEmail } from "./email.service.js";

const SALT_ROUNDS = 10;

function buildRegisterValidationError({ username, password, confirmPassword, email }) {
    if (!username || !password || !confirmPassword || !email) {
        return "All fields are required";
    }

    if (password !== confirmPassword) {
        return "Passwords do not match";
    }

    if (password.length < 8) {
        return "Password must be at least 8 characters";
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

export async function registerUser({ username, password, confirmPassword, email }) {
    const validationError = buildRegisterValidationError({ username, password, confirmPassword, email });
    if (validationError) {
        return { ok: false, status: 400, error: validationError };
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    try {
        await createUser({ username, passwordHash, email, verificationToken });
        await sendVerificationEmail({ email, verificationToken });
        return { ok: true };
    } catch (err) {
        const duplicateMessage = duplicateUserMessage(err);
        if (duplicateMessage) {
            return { ok: false, status: 409, error: duplicateMessage };
        }

        throw err;
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
