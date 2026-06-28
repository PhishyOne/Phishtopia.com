import db from "./pool.js";

export async function countYouListItems() {
    const result = await db.query("SELECT COUNT(*) AS total FROM fullstack.youlist_movies");
    return parseInt(result.rows[0].total, 10);
}

export async function findPagedYouListMedia({ limit, offset }) {
    const result = await db.query(
        `
        SELECT movie_id, type
        FROM (
            SELECT movie_id, type, MAX(id) AS last_id
            FROM fullstack.youlist_movies
            GROUP BY movie_id, type
        ) AS t
        ORDER BY last_id DESC
        LIMIT $1 OFFSET $2;
        `,
        [limit, offset]
    );

    return result.rows;
}

export async function findCommentsForMedia({ movieId, type }) {
    const result = await db.query(
        `
        SELECT m.id, m.comment, m.user_id, u.username
        FROM fullstack.youlist_movies m
        JOIN public.users u
        ON m.user_id = u.id
        WHERE m.movie_id = $1 AND m.type = $2
        ORDER BY m.id DESC
        `,
        [movieId, type]
    );

    return result.rows;
}

export async function addComment({ movieId, type, comment, userId }) {
    await db.query(
        `
        INSERT INTO fullstack.youlist_movies (movie_id, type, comment, user_id)
        VALUES ($1, $2, $3, $4)
        `,
        [movieId, type, comment, userId]
    );
}

export async function updateComment({ commentId, comment, userId }) {
    const result = await db.query(
        `
        UPDATE fullstack.youlist_movies
        SET comment = $1
        WHERE id = $2 AND user_id = $3
        RETURNING id
        `,
        [comment, commentId, userId]
    );

    return result.rows[0] || null;
}

export async function deleteComment({ commentId, userId }) {
    const result = await db.query(
        `
        DELETE FROM fullstack.youlist_movies
        WHERE id = $1 AND user_id = $2
        RETURNING id
        `,
        [commentId, userId]
    );

    return result.rows[0] || null;
}

export async function findRecentYouListMedia(limit = 20) {
    const result = await db.query(
        `
        SELECT movie_id, type, comment
        FROM fullstack.youlist_movies
        ORDER BY id DESC
        LIMIT $1
        `,
        [limit]
    );

    return result.rows;
}
