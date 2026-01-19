import dotenv from "dotenv";
dotenv.config(); // Load environment variables first

import express from "express";
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parse } from "csv-parse/sync";

import db from "./app-brewery-server/db.js"; // Hosted RDS Postgres client

// =====================
// Project routers
// =====================
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
// Helper functions
// =====================
function getColor(count, maxCount) {
    if (!maxCount || maxCount <= 0) return "#00ff00";
    const pct = (count / maxCount) * 100;
    let r, g, b = 0;
    if (pct <= 32) {
        const t = pct / 32;
        r = Math.round(0 + t * 255);
        g = 255;
    } else if (pct <= 65) {
        const t = (pct - 32) / (65 - 32);
        r = 255;
        g = Math.round(255 - t * 128);
    } else {
        const t = (pct - 65) / (100 - 65);
        r = 255;
        g = Math.round(127 - t * 127);
    }
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    return `rgb(${r},${g},${b})`;
}

function topN(items, n) {
    return items.sort((a, b) => b.count - a.count).slice(0, n);
}

async function fetchAllPagesParallel(baseUrl) {
    const MAX_PAGES = 10;
    const promises = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        promises.push(axios.get(`${baseUrl}&page=${page}`));
    }
    const responses = await Promise.allSettled(promises);
    let allData = [];
    responses.forEach(r => {
        if (r.status === "fulfilled" && r.value.data) {
            try {
                const pageData = parse(r.value.data, { columns: true, skip_empty_lines: true });
                allData = allData.concat(pageData);
            } catch (err) {
                console.warn("Parse error:", err.message);
            }
        }
    });
    return allData;
}

// =====================
// Mount Project Routers
// =====================
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
        const styles = isProject ? [`/${name}/styles/main.css`] : ["/styles/main.css"];
        if (name === "project33-2") styles.push(`/${name}/styles/new.css`);

        res.render(name, {
            bodyClass: name,
            extraStyles: styles,
            extraScripts: name === "index" ? ["/index.js", "/js/canvas.js"] : []
        });
    });
});

// =====================
// player-int routes
// =====================
app.get("/player-int", (req, res) => {
    res.render("player-int", {
        error: null,
        playerName: null,
        topRegions: [],
        hourlyPercentages: [],
        startDate: null,
        endDate: null,
        killSelected: true,
        deathSelected: true,
        extraStyles: ["/styles/player-int.css"],
        extraScripts: ["/js/little-logo.js", "/js/player-int.js"],
        bodyClass: "player-int"
    });
});

app.get("/player-int/submit", async (req, res) => {
    try {
        const playerName = req.query.name?.trim();
        if (!playerName) throw new Error("Missing player name");

        const killSelected = !!req.query.kill;
        const deathSelected = !!req.query.death;

        const promises = [];
        if (killSelected || (!killSelected && !deathSelected)) {
            promises.push(fetchAllPagesParallel(`https://echoes.mobi/api/killmails?killer_name=${encodeURIComponent(playerName)}`));
        }
        if (deathSelected || (!killSelected && !deathSelected)) {
            promises.push(fetchAllPagesParallel(`https://echoes.mobi/api/killmails?victim_name=${encodeURIComponent(playerName)}`));
        }

        const allData = (await Promise.all(promises)).flat();

        // Process regions, constellations, systems, etc. (same as your original code)
        // ...

        res.render("player-int", {
            error: null,
            playerName,
            topRegions: [],
            hourlyPercentages: [],
            startDate: req.query.start || null,
            endDate: req.query.end || null,
            killSelected: true,
            deathSelected: true,
            extraStyles: ["/styles/player-int.css"],
            extraScripts: ["/js/little-logo.js", "/js/player-int.js"],
            bodyClass: "player-int"
        });

    } catch (err) {
        console.error("Error in /player-int/submit:", err.message);
        res.render("player-int", {
            error: "Failed to fetch or process data.",
            playerName: null,
            topRegions: [],
            hourlyPercentages: [],
            startDate: req.query.start || null,
            endDate: req.query.end || null,
            killSelected: !!req.query.kill,
            deathSelected: !!req.query.death,
            extraStyles: ["/styles/player-int.css"],
            extraScripts: ["/js/little-logo.js", "/js/player-int.js"],
            bodyClass: "player-int"
        });
    }
});

// =====================
// Start server
// =====================
app.listen(port, () => console.log(`Server running on port ${port}`));
