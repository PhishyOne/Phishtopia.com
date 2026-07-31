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
        SELECT id, username, email, email_verified
        FROM public.users
        WHERE LOWER(username) = LOWER($1)
           OR LOWER(email) = LOWER($2)
        LIMIT 1
        `,
        [username, email]
    );

    return result.rows[0] || null;
}

export async function findUserByEmail(email, executor = db) {
    const result = await executor.query(
        `
        SELECT id, email, email_verified
        FROM public.users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        `,
        [email]
    );

    return result.rows[0] || null;
}

export async function findUserAccountById(userId, executor = db) {
    const result = await executor.query(
        `
        SELECT
            id,
            username,
            email,
            email_verified,
            role,
            pending_email,
            password_hash
        FROM public.users
        WHERE id = $1
        LIMIT 1
        `,
        [userId]
    );

    return result.rows[0] || null;
}

export async function findUserAccountForDeletion(userId, executor = db) {
    const result = await executor.query(
        `
        SELECT
            id,
            username,
            email,
            email_verified,
            role,
            pending_email,
            password_hash
        FROM public.users
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
        `,
        [userId]
    );

    return result.rows[0] || null;
}

export async function findOtherUserByUsername({ userId, username }, executor = db) {
    const result = await executor.query(
        `
        SELECT id
        FROM public.users
        WHERE id <> $1
          AND LOWER(username) = LOWER($2)
        LIMIT 1
        `,
        [userId, username]
    );

    return result.rows[0] || null;
}

export async function findOtherUserByEmail({ userId, email }, executor = db) {
    const result = await executor.query(
        `
        SELECT id
        FROM public.users
        WHERE id <> $1
          AND (
              LOWER(email) = LOWER($2)
              OR LOWER(pending_email) = LOWER($2)
          )
        LIMIT 1
        `,
        [userId, email]
    );

    return result.rows[0] || null;
}

export async function updateUsername({ userId, username }, executor = db) {
    const result = await executor.query(
        `
        UPDATE public.users
        SET username = $1
        WHERE id = $2
        RETURNING id, username, email, email_verified, role, pending_email
        `,
        [username, userId]
    );

    return result.rows[0] || null;
}

export async function setPendingEmailChange({ userId, email, verificationToken }, executor = db) {
    const result = await executor.query(
        `
        UPDATE public.users
        SET pending_email = $1,
            pending_email_token = $2,
            pending_email_requested_at = NOW()
        WHERE id = $3
        RETURNING id, username, email, email_verified, role, pending_email
        `,
        [email, verificationToken, userId]
    );

    return result.rows[0] || null;
}

export async function verifyPendingEmailChangeByToken(token, executor = db) {
    const result = await executor.query(
        `
        UPDATE public.users AS target
        SET email = target.pending_email,
            email_verified = true,
            pending_email = NULL,
            pending_email_token = NULL,
            pending_email_requested_at = NULL
        WHERE target.pending_email_token = $1
          AND target.pending_email IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM public.users AS other
              WHERE other.id <> target.id
                AND LOWER(other.email) = LOWER(target.pending_email)
          )
        RETURNING id, username, email, email_verified, role
        `,
        [token]
    );

    return result.rows[0] || null;
}

export async function updatePasswordHash({ userId, passwordHash }, executor = db) {
    const result = await executor.query(
        `
        UPDATE public.users
        SET password_hash = $1
        WHERE id = $2
        RETURNING id, username, email, email_verified, role, pending_email
        `,
        [passwordHash, userId]
    );

    return result.rows[0] || null;
}

export async function deleteUserSessions(userId, executor = db) {
    await executor.query(
        `
        DELETE FROM public.session
        WHERE sess -> 'user' ->> 'id' = $1::text
        `,
        [userId]
    );
}

export async function deleteUserYouListData(userId, executor = db) {
    await executor.query(
        `
        DELETE FROM fullstack.youlist_movies
        WHERE user_id = $1
        `,
        [userId]
    );
}

export async function deleteUserRecord(userId, executor = db) {
    const result = await executor.query(
        `
        DELETE FROM public.users
        WHERE id = $1
        RETURNING id
        `,
        [userId]
    );

    return result.rows[0] || null;
}

export async function updateUserVerificationToken({ userId, verificationToken }, executor = db) {
    const result = await executor.query(
        `
        UPDATE public.users
        SET verify_token = $1
        WHERE id = $2 AND email_verified = false
        RETURNING id
        `,
        [verificationToken, userId]
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
