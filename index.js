// Load environment variables first
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parse } from "csv-parse/sync";

// Load database connection (Needs this or crash)
import db from "./app-brewery-server/db.js";

// =====================
// Project routers
// =====================
import playerIntRoutes from "./app-brewery-server/routes/player-int.js";
import project25Routes from "./app-brewery-server/routes/project25.js";
import project28Routes from "./app-brewery-server/routes/project28.js";
import project29Routes from "./app-brewery-server/routes/project29.js";
import project30Routes from "./app-brewery-server/routes/project30.js";
import project331Routes from "./app-brewery-server/routes/project33-1.js";
import project332Routes from "./app-brewery-server/routes/project33-2.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3002;

app.use(express.urlencoded({ extended: true }));

// =====================
// Mount Project Routers
// =====================
app.use("/player-int", playerIntRoutes);
app.use("/project25", project25Routes);
app.use("/project28", project28Routes);
app.use("/project29", project29Routes);
app.use("/project30", project30Routes);
app.use("/api", project30Routes); // API endpoint for project30
app.use("/project33-1", project331Routes);
app.use("/project33-2", project332Routes);

// =====================
// Express setup
// =====================
app.set("view engine", "ejs");
app.set("views", [
    join(__dirname, "views"),
    join(__dirname, "app-brewery-server/views")
]);

// Default locals for EJS
app.use((req, res, next) => {
    res.locals.bodyClass = "";
    res.locals.extraStyles = [];
    res.locals.extraScripts = [];
    next();
});

// Log static file requests
app.use((req, res, next) => {
    if (req.url.endsWith(".css") || req.url.endsWith(".js") || req.url.endsWith(".png")) {
        console.log(`[STATIC REQUEST] ${req.method} ${req.url}`);
    }
    next();
});

// Serve backend project public folders
["project25", "project28", "project29", "project30", "project33-1", "project33-2"]
    .forEach(proj => {
        app.use(`/${proj}`, express.static(join(__dirname, "app-brewery-server/public", proj)));
    });

// Serve main public folder
app.use(express.static(join(__dirname, "public")));

// Serve old static projects
app.use("/static", express.static(join(__dirname, "views/app-brewery-static")));

// =====================
// Auto-generate EJS routes
// =====================
const viewFiles = readdirSync(join(__dirname, "views")).filter(f => f.endsWith(".ejs") && f !== "player-int.ejs");

viewFiles.forEach(file => {
    const name = file.replace(".ejs", "");
    const isProject = name.startsWith("project");

    app.get(name === "index" ? "/" : `/${name}`, (req, res) => {
        // Styles
        const styles = isProject ? [`/${name}/styles/main.css`] : ["/styles/main.css"];
        if (name === "project33-2") styles.push(`/${name}/styles/new.css`);

        // Scripts: only include canvas.js for index, projects, and contact pages
        const scripts = [];
        if (["index", "projects", "contact"].includes(name)) {
            scripts.push("/js/canvas.js");
        }
        if (name === "index") scripts.push("/index.js"); // keep index.js for index

        res.render(name, {
            bodyClass: name,
            extraStyles: styles,
            extraScripts: scripts
        });
    });
});

// =====================
// Start server
// =====================
app.listen(port, () => console.log(`Server running on port ${port}`));
