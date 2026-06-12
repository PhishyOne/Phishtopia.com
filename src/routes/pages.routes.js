import express from "express";
import { readdirSync } from "fs";
import { join } from "path";
import { viewsDir } from "../config/paths.js";

const CANVAS_PAGES = new Set(["index", "projects", "contact", "youlist", "register", "login"]);

function buildPageOptions(req, name) {
    const isProject = name.startsWith("project") && name !== "projects";
    const extraStyles = isProject ? [`/${name}/styles/main.css`] : ["/styles/main.css"];
    const extraScripts = [];

    if (name === "project33-2") extraStyles.push(`/${name}/styles/new.css`);
    if (CANVAS_PAGES.has(name)) extraScripts.push("/js/canvas.js");

    return {
        bodyClass: name,
        extraStyles,
        extraScripts,
        user: req.session?.user || null,
        currentUrl: req.originalUrl
    };
}

export function buildPagesRouter() {
    const router = express.Router();

    router.get("/projects", (req, res) => {
        res.render("projects", {
            bodyClass: "projects",
            user: req.session?.user || null,
            currentUrl: req.originalUrl,
            extraStyles: ["/styles/main.css"],
            extraScripts: []
        });
    });

    const viewFiles = readdirSync(viewsDir)
        .filter(file => file.endsWith(".ejs") && file !== "player-int.ejs");

    viewFiles.forEach(file => {
        const name = file.replace(".ejs", "");
        const routePath = name === "index" ? "/" : `/${name}`;

        router.get(routePath, (req, res, next) => {
            if (name === "youlist") return next();
            res.render(name, buildPageOptions(req, name));
        });
    });

    return router;
}
