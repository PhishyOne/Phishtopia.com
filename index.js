// =====================
// Load environment variables
// =====================
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { readdirSync, mkdirSync, existsSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Database connection (required)
import db from "./app-brewery-server/db.js";

// =====================
// Routers
// =====================
import playerIntRoutes from "./app-brewery-server/routes/player-int.js";
import project25Routes from "./app-brewery-server/routes/project25.js";
import project28Routes from "./app-brewery-server/routes/project28.js";
import project29Routes from "./app-brewery-server/routes/project29.js";
import project30Routes from "./app-brewery-server/routes/project30.js";
import project331Routes from "./app-brewery-server/routes/project33-1.js";
import project332Routes from "./app-brewery-server/routes/project33-2.js";

// =====================
// Constants
// =====================
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3002;
const PROJECTS = ["project25", "project28", "project29", "project30", "project33-1", "project33-2"];
const CANVAS_PAGES = ["index", "projects", "contact"];

// =====================
// Logs setup
// =====================
const logDir = join(__dirname, "logs");
if (!existsSync(logDir)) mkdirSync(logDir);
const errorLogFile = join(logDir, "errors.log");
const accessLogFile = join(logDir, "unique_ips.log");
const seenIPs = new Set();

// =====================
// Express setup
// =====================
const app = express();
app.use(express.urlencoded({ extended: true }));

// EJS setup
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

// =====================
// Logging middleware
// =====================
// Unique IPs for static requests
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const isStatic = req.url.endsWith(".css") || req.url.endsWith(".js") || req.url.endsWith(".png");

    if (isStatic && !seenIPs.has(ip)) {
        seenIPs.add(ip);
        const msg = `[${new Date().toISOString()}] [UNIQUE IP] ${ip} requested ${req.url}\n`;
        appendFileSync(accessLogFile, msg);
        console.log(msg.trim());
    }

    next();
});

// =====================
// Serve static folders
// =====================
// Main public folder
app.use(express.static(join(__dirname, "public")));

// Old static projects
app.use("/static", express.static(join(__dirname, "views/app-brewery-static")));

// Auto-serve project public folders
const projectsDir = join(__dirname, "app-brewery-server/public");
readdirSync(projectsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .forEach(dirent => {
        const projName = dirent.name;
        app.use(`/${projName}`, express.static(join(projectsDir, projName)));
        console.log(`Serving static folder for project: ${projName}`);
    });

// =====================
// Mount routers
// =====================
app.use("/player-int", playerIntRoutes);
app.use("/project25", project25Routes);
app.use("/project28", project28Routes);
app.use("/project29", project29Routes);
app.use("/project30", project30Routes);
app.use("/api", project30Routes); // API endpoint
app.use("/project33-1", project331Routes);
app.use("/project33-2", project332Routes);

// =====================
// Auto-generate EJS routes
// =====================
const viewFiles = readdirSync(join(__dirname, "views"))
    .filter(f => f.endsWith(".ejs") && f !== "player-int.ejs");

viewFiles.forEach(file => {
    const name = file.replace(".ejs", "");
    const isProject = name.startsWith("project");

    app.get(name === "index" ? "/" : `/${name}`, (req, res) => {
        const styles = isProject ? [`/${name}/styles/main.css`] : ["/styles/main.css"];
        if (name === "project33-2") styles.push(`/${name}/styles/new.css`);

        const scripts = [];
        if (CANVAS_PAGES.includes(name)) scripts.push("/js/canvas.js");
        if (name === "index") scripts.push("/index.js");

        res.render(name, {
            bodyClass: name,
            extraStyles: styles,
            extraScripts: scripts
        });
    });
});

// =====================
// Error logging middleware
// =====================
app.use((err, req, res, next) => {
    const msg = `[${new Date().toISOString()}] [ERROR] ${req.method} ${req.url} - ${err.message}\n${err.stack}\n`;
    appendFileSync(errorLogFile, msg);
    console.error(msg.trim());
    res.status(500).send("Something went wrong!");
});

// =====================
// Start server
// =====================
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
