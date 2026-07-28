import express from "express";
import { requireLogin } from "../middleware/requireLogin.js";
import { provideCsrfToken, requireCsrfToken } from "../middleware/csrf.js";
import {
    createComment,
    deleteComment,
    editComment,
    getList,
    getMediaDetails,
    renderYouListPage,
    searchMedia
} from "../controllers/youlist.controller.js";
import { prewarmYouListCache } from "../services/youlist.service.js";

const router = express.Router();

router.get("/", requireLogin, provideCsrfToken, renderYouListPage);
router.get("/api/search", requireLogin, searchMedia);
router.get("/api/item/:type/:id", requireLogin, getMediaDetails);
router.get("/api/list", requireLogin, getList);
router.post("/api/comment", requireLogin, requireCsrfToken, createComment);
router.put("/api/comment/:id", requireLogin, requireCsrfToken, editComment);
router.delete("/api/comment/:id", requireLogin, requireCsrfToken, deleteComment);

if (process.env.PREWARM_TMDB_CACHE === "true") {
    prewarmYouListCache()
        .then(() => console.log("TMDB cache pre-warmed for first page!"))
        .catch(err => console.error("Cache pre-warm error:", err));
}

export default router;
