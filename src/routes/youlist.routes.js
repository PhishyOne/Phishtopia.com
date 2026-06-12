import express from "express";
import { requireLogin } from "../middleware/requireLogin.js";
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

router.get("/", requireLogin, renderYouListPage);
router.get("/api/search", searchMedia);
router.get("/api/item/:type/:id", getMediaDetails);
router.get("/api/list", getList);
router.post("/api/comment", requireLogin, createComment);
router.put("/api/comment/:id", requireLogin, editComment);
router.delete("/api/comment/:id", requireLogin, deleteComment);

if (process.env.PREWARM_TMDB_CACHE === "true") {
    prewarmYouListCache()
        .then(() => console.log("TMDB cache pre-warmed for first page!"))
        .catch(err => console.error("Cache pre-warm error:", err));
}

export default router;
