import express from "express";
import axios from "axios";
import { parse } from "csv-parse/sync";

const router = express.Router();

/* ============================
   Global Color Function (fixed)
   ============================ */
function getColor(count, maxCount) {
    if (!maxCount || maxCount <= 0) return "#00ff00";

    // compute percent of max
    const pct = (count / maxCount) * 100;

    let r, g, b = 0;

    if (pct <= 32) {
        // green → yellow
        const t = pct / 32;
        r = Math.round(0 + t * 255);
        g = 255;
    } else if (pct <= 65) {
        // yellow → orange
        const t = (pct - 32) / (65 - 32);
        r = 255;
        g = Math.round(255 - t * 128); // green decreases
    } else {
        // orange → red
        const t = (pct - 65) / (100 - 65);
        r = 255;
        g = Math.round(127 - t * 127); // green goes to 0
    }

    // clamp
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));

    return `rgb(${r},${g},${b})`;
}


/* ============================
   Helpers
   ============================ */
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
                console.warn("Parse error on page data:", err.message);
            }
        }
    });

    return allData;
}

/* ============================
   ROUTES
   ============================ */

router.get("/", (req, res) => {
    res.render("PlayInt", {
        error: null,
        playerName: null,
        topRegions: [],
        hourlyPercentages: [],
        extraStyles: ["styles/playint.css"],
        extraScripts: [
            "res/js/stars-bg.js",
            "res/js/little-logo.js",
            "res/js/playint-spin.js",
            "res/js/playint.js"
        ],
        bodyClass: "playint"
    });
});

router.get("/submit", async (req, res) => {
    try {
        const playerName = req.query.name?.trim();
        if (!playerName) {
            return res.render("PlayInt", {
                error: "Please enter a player name.",
                playerName: null,
                topRegions: [],
                hourlyPercentages: [],
                extraStyles: ["styles/playint.css"],
                extraScripts: [
                    "res/js/stars-bg.js",
                    "res/js/little-logo.js",
                    "res/js/playint-spin.js",
                    "res/js/playint.js"
                ],
                bodyClass: "playint"
            });
        }

        // Fetch data
        const [dataVictim, dataKiller] = await Promise.all([
            fetchAllPagesParallel(`https://echoes.mobi/api/killmails?victim_name=${encodeURIComponent(playerName)}`),
            fetchAllPagesParallel(`https://echoes.mobi/api/killmails?killer_name=${encodeURIComponent(playerName)}`)
        ]);

        const allData = [...dataVictim, ...dataKiller];
        const totalCount = allData.length || 1;

        // Map data hierarchy
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

        // Build output with consistent color scaling
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

        // Hourly activity
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

        res.render("PlayInt", {
            error: null,
            playerName,
            topRegions,
            hourlyPercentages,
            extraStyles: ["styles/playint.css"],
            extraScripts: [
                "res/js/stars-bg.js",
                "res/js/little-logo.js",
                "res/js/playint-spin.js",
                "res/js/playint.js"
            ],
            bodyClass: "playint"
        });
    } catch (err) {
        console.error("Error in /submit:", err);
        res.render("PlayInt", {
            error: "Failed to fetch or process data.",
            playerName: null,
            topRegions: [],
            hourlyPercentages: [],
            extraStyles: ["styles/playint.css"],
            extraScripts: [
                "res/js/stars-bg.js",
                "res/js/little-logo.js",
                "res/js/playint-spin.js",
                "res/js/playint.js"
            ],
            bodyClass: "playint"
        });
    }
});

export default router;
