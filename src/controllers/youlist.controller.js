import { fetchTMDBItem, searchTMDB } from "../services/tmdb.service.js";
import {
    createYouListComment,
    editYouListComment,
    getPagedYouList,
    removeYouListComment
} from "../services/youlist.service.js";
import {
    isValidMediaType,
    normalizePage,
    normalizePositiveInteger,
    normalizeSearchQuery
} from "../services/youlist.validation.js";

function noStore(res) {
    res.set("Cache-Control", "no-store");
}

function sendMutationResult(res, result) {
    noStore(res);
    if (!result.ok) {
        return res.status(result.status).json({ success: false, error: result.error });
    }
    return res.json({ success: true });
}

export function renderYouListPage(req, res) {
    noStore(res);
    res.render("project34", {
        bodyClass: "project34",
        extraStyles: [
            "/project34/styles/main.css",
            "/styles/youlist-mobile.css"
        ],
        extraScripts: ["/js/canvas.js", "/js/youlist.js"],
        user: req.session.user || null,
        csrfToken: res.locals.csrfToken,
        currentUrl: req.originalUrl
    });
}

export async function searchMedia(req, res) {
    try {
        const query = normalizeSearchQuery(req.query.q);
        if (query === null) {
            return res.status(400).json({ error: "Search query is too long" });
        }
        if (query.length < 2) return res.json([]);

        const results = await searchTMDB(query);
        res.json(results);
    } catch (err) {
        console.error("TMDB search error:", err);
        res.status(500).json({ error: "TMDB search failed" });
    }
}

export async function getMediaDetails(req, res) {
    try {
        const { type } = req.params;
        const id = normalizePositiveInteger(req.params.id);

        if (!isValidMediaType(type) || id === null) {
            return res.status(400).json({ error: "Invalid media item" });
        }

        const item = await fetchTMDBItem(type, id);
        res.json(item);
    } catch (err) {
        console.error("TMDB detail error:", err);
        res.status(500).json({ error: "Failed to fetch item details" });
    }
}

export async function getList(req, res) {
    try {
        noStore(res);
        const list = await getPagedYouList(normalizePage(req.query.page));
        res.json(list);
    } catch (err) {
        console.error("Grouped list fetch error:", err);
        res.status(500).json({ error: "Failed to load list" });
    }
}

export async function createComment(req, res) {
    try {
        const result = await createYouListComment({
            movieId: req.body.movie_id,
            type: req.body.type,
            comment: req.body.comment,
            userId: req.session.user?.id
        });
        sendMutationResult(res, result);
    } catch (err) {
        console.error("Add comment error:", err);
        noStore(res);
        res.status(500).json({ success: false, error: "Failed to add comment" });
    }
}

export async function editComment(req, res) {
    try {
        const result = await editYouListComment({
            commentId: req.params.id,
            comment: req.body.comment,
            userId: req.session.user?.id
        });
        sendMutationResult(res, result);
    } catch (err) {
        console.error("Edit comment error:", err);
        noStore(res);
        res.status(500).json({ success: false, error: "Failed to edit comment" });
    }
}

export async function deleteComment(req, res) {
    try {
        const result = await removeYouListComment({
            commentId: req.params.id,
            userId: req.session.user?.id
        });
        sendMutationResult(res, result);
    } catch (err) {
        console.error("Delete comment error:", err);
        noStore(res);
        res.status(500).json({ success: false, error: "Failed to delete comment" });
    }
}
