import express from "express";

import { pageLocals } from "../config/pageAssets.js";

export function buildPagesRouter() {
    const router = express.Router();

    router.get("/", (req, res) => {
        res.render("index", pageLocals("home"));
    });

    router.get("/contact", (req, res) => {
        res.render("contact", pageLocals("contact"));
    });

    return router;
}
