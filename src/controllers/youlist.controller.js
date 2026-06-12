import { fetchTMDBItem, searchTMDB } from "../services/tmdb.service.js";
import {
    createYouListComment,
    editYouListComment,
    getPagedYouList,
    isValidMediaType,
    removeYouListComment
} from "../services/youlist.service.js";

export function renderYouListPage(req, res) {
    res.render("project34", {
        bodyClass: "project34",
        extraStyles: ["/project34/styles/main.css"],
        extraScripts: ["/js/canvas.js", "/js/youlist.js"],
        movieList: JSON.stringify([]),
        user: req.session.user || null,
        currentUrl: req.originalUrl
    });
}

export async function searchMedia(req, res) {
    try {
        const results = await searchTMDB(req.query.q);
        res.json(results);
    } catch (err) {
        console.error("TMDB search error:", err);
        res.status(500).json({ error: "TMDB search failed" });
    }
}

export async function getMediaDetails(req, res) {
    try {
        const { type, id } = req.params;

        if (!isValidMediaType(type)) {
            return res.status(400).json({ error: "Invalid media type" });
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
        const list = await getPagedYouList(req.query.page);
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

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Add comment error:", err);
        res.status(500).json({ error: "Failed to add comment" });
    }
}

export async function editComment(req, res) {
    try {
        const result = await editYouListComment({
            commentId: req.params.id,
            comment: req.body.comment,
            userId: req.session.user?.id
        });

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Edit comment error:", err);
        res.status(500).json({ error: "Failed to edit comment" });
    }
}

export async function deleteComment(req, res) {
    try {
        const result = await removeYouListComment({
            commentId: req.params.id,
            userId: req.session.user?.id
        });

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Delete comment error:", err);
        res.status(500).json({ error: "Failed to delete comment" });
    }
}
