import express from "express";
import { readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parse } from "csv-parse/sync";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3002;

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

//==========================================================================
//==========================================================================
// =====================
// App Brewery Routes
// =====================
import project25Routes from "./app-brewery-server/routes/project25.js";
import project28Routes from "./app-brewery-server/routes/project28.js";
import project29Routes from "./app-brewery-server/routes/project29.js";
import project30Routes from "./app-brewery-server/routes/project30.js";
import project331Routes from "./app-brewery-server/routes/project33-1.js";
import project332Routes from "./app-brewery-server/routes/project33-2.js";

// Mount Project routers
app.use("/project25", project25Routes);
app.use("/project28", project28Routes);
app.use("/project29", project29Routes);
app.use("/project30", project30Routes);
app.use("/api", project30Routes);
app.use("/project33-1", project331Routes);
app.use("/project33-2", project332Routes);
//==========================================================================
//==========================================================================

// =====================
// Express setup
// =====================
app.set("view engine", "ejs");
app.set("views", [
    join(__dirname, "views"), // Main Phishtopia Views
    join(__dirname, "app-brewery-server/views") // Backend Projects
]);

app.use((req, res, next) => {
    res.locals.bodyClass = "";
    res.locals.extraStyles = [];
    res.locals.extraScripts = [];
    next();
});

// Log all requests for debugging static files
app.use((req, res, next) => {
    if (req.url.endsWith(".css") || req.url.endsWith(".js") || req.url.endsWith(".png")) {
        console.log(`[STATIC REQUEST] ${req.method} ${req.url}`);
    }
    next();
});

// Serve backend project public folders
const backendProjects = [
    "project25",
    "project28",
    "project29",
    "project30",
    "project33-1",
    "project33-2"
];

backendProjects.forEach(proj => {
    app.use(`/${proj}`, express.static(join(__dirname, "app-brewery-server/public", proj)));
});

// Serve static files
app.use(express.static(join(__dirname, "public")));
  
// Serve old static projects under /static
app.use("/static", express.static(join(__dirname, "views/app-brewery-static")));

// =====================
// Auto-generate simple EJS routes (Phishtopia only)
// =====================
const viewsDir = join(__dirname, "views");
const viewFiles = readdirSync(viewsDir).filter(
    f => f.endsWith(".ejs") && f !== "player-int.ejs"
);

viewFiles.forEach(file => {
    const name = file.replace(".ejs", "");
    const isProject = name.startsWith("project"); // e.g. project33-2

    app.get(name === "index" ? "/" : `/${name}`, (req, res) => {
        // Determine project CSS files
        let styles = [];
        if (isProject) {
            styles.push(`/${name}/styles/main.css`);
            // Include additional project-specific CSS if exists
            if (name === "project33-2") styles.push(`/${name}/styles/new.css`);
        } else {
            styles.push("/styles/main.css");
        }

        res.render(name, {
            bodyClass: name,
            extraStyles: styles,       // always an array
            extraScripts: name === "index" ? ["/index.js", "/js/canvas.js"] : []
        });
    });
});

  
//==========================================================================
//==========================================================================
// =====================
// player-int Routes
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

        let allData = (await Promise.all(promises)).flat();

        const startDate = req.query.start ? new Date(req.query.start) : null;
        const endDate = req.query.end ? new Date(req.query.end) : null;

        if (startDate || endDate) {
            allData = allData.filter(row => {
                const rawDate = row.date_killed || row.date_created || row.date_updated;
                if (!rawDate) return false;
                const d = new Date(rawDate);
                if (isNaN(d)) return false;
                if (startDate && d < startDate) return false;
                if (endDate && d > endDate) return false;
                return true;
            });
        }

        const totalCount = allData.length || 1;
        const regionMap = {};
        let globalMaxSystemCount = 0;

        allData.forEach(row => {
            const region = row.region || "Unknown Region";
            const con = row.constellation || "Unknown Constellation";
            const sys = row.system || "Unknown System";

            if (!regionMap[region]) regionMap[region] = { count: 0, constellations: {} };
            regionMap[region].count++;

            if (!regionMap[region].constellations[con])
                regionMap[region].constellations[con] = { count: 0, systems: {} };
            regionMap[region].constellations[con].count++;

            if (!regionMap[region].constellations[con].systems[sys])
                regionMap[region].constellations[con].systems[sys] = { count: 0 };
            regionMap[region].constellations[con].systems[sys].count++;

            if (regionMap[region].constellations[con].systems[sys].count > globalMaxSystemCount)
                globalMaxSystemCount = regionMap[region].constellations[con].systems[sys].count;
        });

        const regionsArr = Object.entries(regionMap).map(([regionName, regionData]) => {
            const constellations = Object.entries(regionData.constellations).map(([conName, conData]) => {
                const systemsArr = Object.entries(conData.systems).map(([sysName, sysData]) => ({
                    name: sysName,
                    count: sysData.count,
                    percent: Number(((sysData.count / totalCount) * 100).toFixed(1)),
                    color: getColor(sysData.count, globalMaxSystemCount)
                }));
                return {
                    name: conName,
                    count: conData.count,
                    percent: Number(((conData.count / totalCount) * 100).toFixed(1)),
                    color: getColor(conData.count, globalMaxSystemCount),
                    systems: topN(systemsArr, 5)
                };
            });
            return {
                name: regionName,
                count: regionData.count,
                percent: Number(((regionData.count / totalCount) * 100).toFixed(1)),
                color: getColor(regionData.count, globalMaxSystemCount),
                constellations: topN(constellations, 5)
            };
        });

        const topRegions = topN(regionsArr, 5);

        const MAX_BAR_PX = 300;
        const hourlyCounts = Array(24).fill(0);
        allData.forEach(row => {
            const date = new Date(row.date_killed || row.date_created || row.date_updated);
            if (!isNaN(date)) hourlyCounts[date.getUTCHours()]++;
        });

        const hourlyPercentages = hourlyCounts.map((count, hour) => ({
            hour: String(hour).padStart(2, "0"),
            height: Math.round((count / totalCount) * MAX_BAR_PX),
            percent: Number(((count / totalCount) * 100).toFixed(1)),
        }));

        res.render("player-int", {
            error: null,
            playerName,
            topRegions,
            hourlyPercentages,
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
//==========================================================================
//==========================================================================



// =====================
// Start server
// =====================
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
