
import express from "express";
import axios from "axios";
import { parse } from "csv-parse/sync";

const router = express.Router();

/* ============================
   Color Scaling Helper
   ============================ */
function getColor(count, maxCount) {
    if (!maxCount || maxCount <= 0) return '#00ff00'; // green default
    const ratio = Math.max(0, Math.min(1, count / maxCount));

    // Green → Yellow → Red gradient
    if (ratio <= 0.5) {
        const t = ratio / 0.5; // 0..1
        const r = Math.round(255 * t);
        const g = 255;
        return `rgb(${r},${g},0)`;
    } else {
        const t = (ratio - 0.5) / 0.5; // 0..1
        const r = 255;
        const g = Math.round(255 * (1 - t));
        return `rgb(${r},${g},0)`;
    }
}

/* ============================
   Utility to pick top N
   ============================ */
function topN(items, n) {
    return items.sort((a, b) => b.count - a.count).slice(0, n);
}

/* ============================
   Fetch all pages in parallel
   ============================ */
async function fetchAllPagesParallel(baseUrl) {
    const MAX_PAGES = 10;
    const promises = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        promises.push(axios.get(`${baseUrl}&page=${page}`));
    }

    const responses = await Promise.allSettled(promises);
    let allData = [];

    responses.forEach(r => {
        if (r.status === 'fulfilled' && r.value.data) {
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
    res.render("/views/PlayInt", {
        error: null,
        playerName: null,
        topRegions: [],
        hourlyPercentages: []
    });
});

router.get("/submit", async (req, res) => {
    try {
        const playerName = req.query.name?.trim();
        if (!playerName) {
            return res.render("/views/PlayInt", {
                error: "Please enter a player name.",
                playerName: null,
                topRegions: [],
                hourlyPercentages: []
            });
        }

        // Fetch kills and losses in parallel
        const [dataVictim, dataKiller] = await Promise.all([
            fetchAllPagesParallel(`https://echoes.mobi/api/killmails?victim_name=${encodeURIComponent(playerName)}`),
            fetchAllPagesParallel(`https://echoes.mobi/api/killmails?killer_name=${encodeURIComponent(playerName)}`)
        ]);

        const allData = [...dataVictim, ...dataKiller];
        const totalCount = allData.length || 1;

        // Aggregate region → constellation → system
        const regionMap = {};
        let maxSystemCount = 0;

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

            const sysCount = Number(regionMap[region].constellations[con].systems[sys].count);
            if (sysCount > maxSystemCount) maxSystemCount = sysCount;
        });

        // Build hierarchy with explicit numeric counts
        const regionsArr = Object.entries(regionMap).map(([regionName, regionData]) => {
            const regionCount = Number(regionData.count);
            const constellations = Object.entries(regionData.constellations).map(([conName, conData]) => {
                const conCount = Number(conData.count);
                const systemsArr = Object.entries(conData.systems).map(([sysName, sysData]) => {
                    const sysCount = Number(sysData.count);
                    return {
                        name: sysName,
                        count: sysCount,
                        percent: Number(((sysCount / totalCount) * 100).toFixed(1)),
                        color: getColor(sysCount, maxSystemCount)
                    };
                });

                const maxSysCountInCon = Math.max(...systemsArr.map(s => s.count), 0);
                return {
                    name: conName,
                    count: conCount,
                    percent: Number(((conCount / totalCount) * 100).toFixed(1)),
                    color: getColor(conCount, maxSysCountInCon),
                    systems: topN(systemsArr, 5)
                };
            });

            const maxConstCountInRegion = Math.max(...constellations.map(c => c.count), 0);
            return {
                name: regionName,
                count: regionCount,
                percent: Number(((regionCount / totalCount) * 100).toFixed(1)),
                color: getColor(regionCount, Math.max(...Object.values(regionMap).map(r => Number(r.count)))),
                constellations: topN(constellations, 5),
                maxConstellationCount: maxConstCountInRegion
            };
        });

        const topRegions = topN(regionsArr, 5);

        // Hourly chart
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

        res.render("/views/PlayInt", {
            error: null,
            playerName,
            topRegions,
            hourlyPercentages
        });
    } catch (err) {
        console.error("Error in /submit:", err);
        res.render("/views/PlayInt", {
            error: "Failed to fetch or process data.",
            playerName: null,
            topRegions: [],
            hourlyPercentages: []
        });
    }
});

export default router;