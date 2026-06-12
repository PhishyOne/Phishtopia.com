import db from "../../app-brewery-server/db.js";

export async function createUser({ username, passwordHash, email, verificationToken }) {
    const result = await db.query(
        `
        INSERT INTO public.users (username, password_hash, email, verify_token)
        VALUES ($1, $2, $3, $4)
        RETURNING id, username
        `,
        [username, passwordHash, email, verificationToken]
    );

    return result.rows[0];
}

export async function findUserByUsername(username) {
    const result = await db.query(
        "SELECT * FROM public.users WHERE username = $1",
        [username]
    );

    return result.rows[0] || null;
}

export async function verifyUserEmailByToken(token) {
    const result = await db.query(
        `
        UPDATE public.users
        SET email_verified = true, verify_token = NULL
        WHERE verify_token = $1
        RETURNING username
        `,
        [token]
    );

    return result.rows[0] || null;
}
