import db from "./pool.js";

export async function createUser({ username, passwordHash, email, verificationToken }, executor = db) {
    const result = await executor.query(
        `
        INSERT INTO public.users (username, password_hash, email, verify_token)
        VALUES ($1, $2, $3, $4)
        RETURNING id, username, email
        `,
        [username, passwordHash, email, verificationToken]
    );

    return result.rows[0];
}

export async function findUserByUsername(username, executor = db) {
    const result = await executor.query(
        "SELECT * FROM public.users WHERE username = $1",
        [username]
    );

    return result.rows[0] || null;
}

export async function findUserByUsernameOrEmail({ username, email }, executor = db) {
    const result = await executor.query(
        `
        SELECT username, email
        FROM public.users
        WHERE LOWER(username) = LOWER($1)
           OR LOWER(email) = LOWER($2)
        LIMIT 1
        `,
        [username, email]
    );

    return result.rows[0] || null;
}

export async function verifyUserEmailByToken(token, executor = db) {
    const result = await executor.query(
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
