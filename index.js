// Load environment variables & imports
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import ejs from "ejs";
import { readdirSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import "./app-brewery-server/db.js"; // Database connection
import session from "express-session";
import authRoutes from "./app-brewery-server/routes/auth.js";

// Routers ////////////////////////////////////////////////////////////////////
import playerIntRoutes from "./app-brewery-server/routes/player-int.js";
import project25Routes from "./app-brewery-server/routes/project25.js";
import project28Routes from "./app-brewery-server/routes/project28.js";
import project29Routes from "./app-brewery-server/routes/project29.js";
import project30Routes from "./app-brewery-server/routes/project30.js";
import project331Routes from "./app-brewery-server/routes/project33-1.js";
import project332Routes from "./app-brewery-server/routes/project33-2.js";
import project333Routes from "./app-brewery-server/routes/project33-3.js";
import project34Routes from "./app-brewery-server/routes/project34.js";

// =====================
// Constants
// =====================
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3002;
const CANVAS_PAGES = ["index", "projects", "contact", "youlist", "register", "login"];
// Logs setup
const logDir = join(__dirname, "logs");
mkdirSync(logDir, { recursive: true });
const errorLogFile = join(logDir, "errors.log");
const accessLogFile = join(logDir, "unique_ips.log");
const seenIPs = new Set();

// =====================
// Middleware
// =====================

// Body parsing
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Default EJS locals
app.use((req, res, next) => {
    res.locals.extraStyles = [];
    res.locals.extraScripts = [];
    res.locals.user = req.session?.user || null;
    res.locals.currentUrl = req.originalUrl;
    next();
});

// Serve static folders
app.use(express.static(join(__dirname, "public"))); // Main public folder
app.use("/static", express.static(join(__dirname, "views/app-brewery-static"))); // Old static projects
app.use("/projects/assets", express.static(join(__dirname, "public/projects")));

// Auto-serve project public folders
const projectsDir = join(__dirname, "app-brewery-server/public");
readdirSync(projectsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .forEach(dirent => {
        const projName = dirent.name;
        app.use(`/${projName}`, express.static(join(projectsDir, projName)));
    });

// Logging middleware for unique IPs requesting static assets
app.use((req, res, next) => {
    const isStatic = /\.(css|js|png)$/.test(req.url);
    const ip = req.ip || req.socket.remoteAddress;
    if (isStatic && !seenIPs.has(ip)) {
        seenIPs.add(ip);
        const msg = `[${new Date().toISOString()}] [UNIQUE IP] ${ip} requested ${req.url}\n`;
        appendFileSync(accessLogFile, msg);
        console.log(msg.trim());
    }
    next();
});

// View engine setup
app.set("view engine", "ejs");
app.set("views", join(__dirname, "views"));
app.engine("ejs", ejs.__express); 
app.locals.basedir = app.get("views");

// Session setup
const isProd = process.env.NODE_ENV === "production";

app.use(session({
    name: "sid",
    secret: process.env.SESSION_SECRET || "devsecret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProd ? true : false, // <-- force false locally
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 2
    }
}));

// Make the user ID available in all templates
app.use((req, res, next) => {
    res.locals.user = req.session?.user || null;
    next();
});

// TEMP LOG
app.use((req, res, next) => {
    console.log("SESSION:", req.session);
    next();
});

app.use("/auth", authRoutes);
app.use("/youlist", project34Routes);

//Protect Route
app.get("/projects", (req, res) => {
    res.render("projects", {
        bodyClass: "projects",
        user: req.session?.user || null,
        currentUrl: req.originalUrl,
        extraStyles: ["/styles/main.css"],
        extraScripts: []
    });
});

// Mount routers /////////////////////////////////////////////////////
const APP_ROUTES = {
    "player-int": playerIntRoutes,
    "project25": project25Routes,
    "project28": project28Routes,
    "project29": project29Routes,
    "project30": project30Routes,
    "project33-1": project331Routes,
    "project33-2": project332Routes,
    "project33-3": project333Routes,
};
Object.entries(APP_ROUTES).forEach(([name, router]) => {
    app.use(`/${name}`, router);
});

// Auto-generate EJS routes
const viewFiles = readdirSync(join(__dirname, "views"))
    .filter(f => f.endsWith(".ejs") && f !== "player-int.ejs");
viewFiles.forEach(file => {
    const name = file.replace(".ejs", "");
    const isProject = name.startsWith("project") && name !== "projects";
    app.get(name === "index" ? "/" : `/${name}`, (req, res) => {
        if (req.url !== "/" && req.url !== `/${name}`) return res.sendStatus(404);
        if (name === "youlist") return;
        const styles = isProject ? [`/${name}/styles/main.css`] : ["/styles/main.css"];
        if (name === "project33-2") styles.push(`/${name}/styles/new.css`);
        const scripts = [];
        if (CANVAS_PAGES.includes(name)) scripts.push("/js/canvas.js");
        res.render(name, {
            bodyClass: name,
            extraStyles: styles,
            extraScripts: scripts,
            user: req.session?.user || null,
            currentUrl: req.originalUrl
        });
    });
});

// Error logging middleware
app.use((err, req, res, next) => {
    const msg = `[${new Date().toISOString()}] [ERROR] ${req.method} ${req.url} - ${err.message}\n${err.stack}\n`;
    appendFileSync(errorLogFile, msg);
    console.error(msg.trim());
    res.status(500).send("Something went wrong!");
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));