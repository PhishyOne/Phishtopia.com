import express from "express";

import { pageLocals } from "../config/pageAssets.js";
import { COURSE_ARCHIVE } from "../data/courseArchive.js";

export function buildPagesRouter() {
    const router = express.Router();

    router.get("/", (req, res) => {
        res.render("index", pageLocals("home"));
    });

    router.get("/archive", (req, res) => {
        res.render("archive", pageLocals("archive", { archive: COURSE_ARCHIVE }));
    });

    router.get("/contact", (req, res) => {
        res.render("contact", pageLocals("contact"));
    });

    return router;
}
