import express from "express";

import { pageLocals } from "../config/pageAssets.js";
import { COURSE_ARCHIVE } from "../data/courseArchive.js";
import { methodNotAllowed } from "../middleware/errorResponses.js";

const pageMethodNotAllowed = methodNotAllowed(["GET", "HEAD"]);
const HOME_DESCRIPTION = "Phishtopia is an independent collection of practical web tools, unusual experiments, and original projects.";

export function buildPagesRouter() {
    const router = express.Router();

    router.get("/", (req, res) => {
        res.render("index", pageLocals("home", {
            pageDescription: HOME_DESCRIPTION
        }));
    });

    router.get("/archive", (req, res) => {
        res.render("archive", pageLocals("archive", { archive: COURSE_ARCHIVE }));
    });

    router.get("/contact", (req, res) => {
        res.render("contact", pageLocals("contact"));
    });

    router.get("/privacy", (req, res) => {
        res.render("privacy", pageLocals("privacy", {
            pageDescription: "Learn what Phishtopia collects, why it is used, and how to ask questions about your data."
        }));
    });

    router.all(["/", "/archive", "/contact", "/privacy"], pageMethodNotAllowed);

    return router;
}
