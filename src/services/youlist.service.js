import {
    addComment,
    countYouListItems,
    deleteComment,
    findCommentsForMedia,
    findPagedYouListMedia,
    findRecentYouListMedia,
    updateComment
} from "../db/youlist.queries.js";
import { fetchTMDBItem } from "./tmdb.service.js";
import {
    isValidMediaType,
    normalizeComment,
    normalizePage,
    normalizePositiveInteger
} from "./youlist.validation.js";

export const YOU_LIST_PAGE_SIZE = 20;
export { isValidMediaType } from "./youlist.validation.js";

export async function getPagedYouList(page = 1) {
    const safePage = normalizePage(page);
    const offset = (safePage - 1) * YOU_LIST_PAGE_SIZE;
    const totalItems = await countYouListItems();
    const totalPages = Math.ceil(totalItems / YOU_LIST_PAGE_SIZE);
    const mediaRows = await findPagedYouListMedia({
        limit: YOU_LIST_PAGE_SIZE,
        offset
    });

    const results = await Promise.all(
        mediaRows.map(async ({ movie_id, type }) => {
            const [comments, tmdb] = await Promise.all([
                findCommentsForMedia({ movieId: movie_id, type }),
                fetchTMDBItem(type, movie_id)
            ]);

            return {
                ...tmdb,
                comments
            };
        })
    );

    return {
        page: safePage,
        pageSize: YOU_LIST_PAGE_SIZE,
        totalItems,
        totalPages,
        results
    };
}

export async function createYouListComment({ movieId, type, comment, userId }) {
    const safeMovieId = normalizePositiveInteger(movieId);
    const safeUserId = normalizePositiveInteger(userId);
    const safeComment = normalizeComment(comment);

    if (safeMovieId === null || safeUserId === null || safeComment === null) {
        return { ok: false, status: 400, error: "Invalid request" };
    }

    if (!isValidMediaType(type)) {
        return { ok: false, status: 400, error: "Invalid media type" };
    }

    await addComment({ movieId: safeMovieId, type, comment: safeComment, userId: safeUserId });
    return { ok: true };
}

export async function editYouListComment({ commentId, comment, userId }) {
    const safeCommentId = normalizePositiveInteger(commentId);
    const safeUserId = normalizePositiveInteger(userId);
    const safeComment = normalizeComment(comment);

    if (safeCommentId === null || safeUserId === null || safeComment === null) {
        return { ok: false, status: 400, error: "Invalid request" };
    }

    const updated = await updateComment({
        commentId: safeCommentId,
        comment: safeComment,
        userId: safeUserId
    });
    if (!updated) {
        return { ok: false, status: 403, error: "Not allowed" };
    }

    return { ok: true };
}

export async function removeYouListComment({ commentId, userId }) {
    const safeCommentId = normalizePositiveInteger(commentId);
    const safeUserId = normalizePositiveInteger(userId);

    if (safeCommentId === null || safeUserId === null) {
        return { ok: false, status: 400, error: "Invalid request" };
    }

    const deleted = await deleteComment({ commentId: safeCommentId, userId: safeUserId });
    if (!deleted) {
        return { ok: false, status: 403, error: "Not allowed" };
    }

    return { ok: true };
}

export async function prewarmYouListCache() {
    const rows = await findRecentYouListMedia(20);

    await Promise.all(
        rows.map(row =>
            fetchTMDBItem(row.type, row.movie_id)
                .catch(() => null)
        )
    );
}
