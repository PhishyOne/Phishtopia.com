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

export const YOU_LIST_PAGE_SIZE = 20;
const VALID_MEDIA_TYPES = new Set(["movie", "tv"]);

export function isValidMediaType(type) {
    return VALID_MEDIA_TYPES.has(type);
}

export async function getPagedYouList(page = 1) {
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
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
    if (!movieId || !type || !comment) {
        return { ok: false, status: 400, error: "Missing required fields" };
    }

    if (!isValidMediaType(type)) {
        return { ok: false, status: 400, error: "Invalid media type" };
    }

    await addComment({ movieId, type, comment, userId });
    return { ok: true };
}

export async function editYouListComment({ commentId, comment, userId }) {
    if (!userId || !comment) {
        return { ok: false, status: 400, error: "Invalid request" };
    }

    const updated = await updateComment({ commentId, comment, userId });
    if (!updated) {
        return { ok: false, status: 403, error: "Not allowed" };
    }

    return { ok: true };
}

export async function removeYouListComment({ commentId, userId }) {
    if (!userId) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }

    const deleted = await deleteComment({ commentId, userId });
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
