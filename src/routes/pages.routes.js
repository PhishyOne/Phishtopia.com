import express from "express";

function pageOptions(req, bodyClass, extraScripts = []) {
    return {
        bodyClass,
        extraStyles: [],
        extraScripts,
        user: req.session?.user || null,
        currentUrl: req.originalUrl
    };
}

export function buildPagesRouter() {
    const router = express.Router();

    router.get("/", (req, res) => {
        res.render("index", pageOptions(req, "home-page", ["/js/canvas.js"]));
    });

    router.get("/contact", (req, res) => {
        res.render("contact", pageOptions(req, "contact"));
    });

    return router;
}
