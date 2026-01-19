import express from "express";
import axios from "axios";
import { parse } from "csv-parse/sync";

const router = express.Router();

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
                console.warn("Parse error on page data:", err.message);
            }
        }
    });

    return allData;
}

// =====================
// Routes
// =====================

// Main player-int page
router.get("/", (req, res) => {
    res.render("player-int", {
        error: null,
        playerName: null,
        topRegions: [],
        hourlyPercentages: [],
        startDate: null,
        endDate: null,
        killSelected: true,
        deathSelected: true,
        extraStyles: ["styles/playint.css"],
        extraScripts: ["js/little-logo.js", "js/playint.js"],
        bodyClass: "playint"
    });
});

// player-int submit route
router.get("/submit", async (req, res) => {
    try {
        const playerName = req.query.name?.trim();
        if (!playerName) {
            return res.render("player-int", {
                error: "Please enter a player name.",
                playerName: null,
                topRegions: [],
                hourlyPercentages: [],
                startDate: req.query.start || null,
                endDate: req.query.end || null,
                killSelected: !!req.query.kill,
                deathSelected: !!req.query.death,
                extraStyles: ["styles/playint.css"],
                extraScripts: ["js/little-logo.js", "js/playint.js"],
                bodyClass: "playint"
            });
        }

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

        if (startDate && isNaN(startDate)) throw new Error("Invalid start date");
        if (endDate && isNaN(endDate)) throw new Error("Invalid end date");

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
            extraStyles: ["styles/playint.css"],
            extraScripts: ["js/little-logo.js", "js/playint.js"],
            bodyClass: "playint"
        });

    } catch (err) {
        console.error("Error in /player-int/submit:", err);
        res.render("player-int", {
            error: "Failed to fetch or process data.",
            playerName: null,
            topRegions: [],
            hourlyPercentages: [],
            startDate: req.query.start || null,
            endDate: req.query.end || null,
            killSelected: !!req.query.kill,
            deathSelected: !!req.query.death,
            extraStyles: ["styles/playint.css"],
            extraScripts: ["js/little-logo.js", "js/playint.js"],
            bodyClass: "playint"
        });
    }
});

export default router;
