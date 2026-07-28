export const YOU_LIST_MAX_COMMENT_LENGTH = 1000;
export const YOU_LIST_MAX_SEARCH_LENGTH = 100;
export const YOU_LIST_MAX_PAGE = 10000;

const VALID_MEDIA_TYPES = new Set(["movie", "tv"]);
const POSITIVE_INTEGER = /^[1-9]\d{0,9}$/;
const MAX_DATABASE_INTEGER = 2147483647;

export function isValidMediaType(type) {
    return VALID_MEDIA_TYPES.has(type);
}

export function normalizePositiveInteger(value) {
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DATABASE_INTEGER) {
            return null;
        }
        return value;
    }

    if (typeof value !== "string" || !POSITIVE_INTEGER.test(value)) {
        return null;
    }

    const parsed = Number(value);
    return parsed <= MAX_DATABASE_INTEGER ? parsed : null;
}

export function normalizeComment(value) {
    if (typeof value !== "string") return null;
    const comment = value.trim();
    if (!comment || comment.length > YOU_LIST_MAX_COMMENT_LENGTH) return null;
    return comment;
}

export function normalizeSearchQuery(value) {
    if (typeof value !== "string") return "";
    const query = value.trim();
    if (query.length > YOU_LIST_MAX_SEARCH_LENGTH) return null;
    return query;
}

export function normalizePage(value) {
    const page = normalizePositiveInteger(value ?? 1);
    if (page === null || page > YOU_LIST_MAX_PAGE) return 1;
    return page;
}
