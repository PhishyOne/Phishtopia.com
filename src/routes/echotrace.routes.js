import express from "express";
import axios from "axios";
import { parse } from "csv-parse/sync";

const router = express.Router();

function getColor(count, maxCount) {
    if (!maxCount || maxCount <= 0) return "#00ff00";

    const pct = (count / maxCount) * 100;
    let r;
    let g;
    const b = 0;

    if (pct <= 32) {
        const t = pct / 32;
        r = Math.round(t * 255);
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

function renderEchoTrace(res, options = {}) {
    return res.render("player-int", {
        error: options.error ?? null,
        playerName: options.playerName ?? null,
        topRegions: options.topRegions ?? [],
        hourlyPercentages: options.hourlyPercentages ?? [],
        startDate: options.startDate ?? null,
        endDate: options.endDate ?? null,
        killSelected: options.killSelected ?? true,
        deathSelected: options.deathSelected ?? true,
        extraStyles: ["/styles/player-int.css"],
        extraScripts: ["/js/little-logo.js", "/js/player-int.js"],
        bodyClass: "player-int"
    });
}

async function fetchAllPagesParallel(baseUrl) {
    const maxPages = 10;
    const requests = [];

    for (let page = 1; page <= maxPages; page += 1) {
        requests.push(axios.get(`${baseUrl}&page=${page}`));
    }

    const responses = await Promise.allSettled(requests);
    let allData = [];

    responses.forEach(response => {
        if (response.status !== "fulfilled" || !response.value.data) return;

        try {
            const pageData = parse(response.value.data, {
                columns: true,
                skip_empty_lines: true
            });
            allData = allData.concat(pageData);
        } catch (error) {
            console.warn("Parse error on EchoTrace page data:", error.message);
        }
    });

    return allData;
}

function parseDateBoundary(value, endOfDay = false) {
    if (!value) return null;

    const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    const date = new Date(`${value}${suffix}`);

    if (Number.isNaN(date.getTime())) {
        throw new Error("Invalid date filter");
    }

    return date;
}

router.get("/", (req, res) => {
    renderEchoTrace(res);
});

router.get("/submit", async (req, res) => {
    const playerInput = req.query.name?.trim();
    const killSelected = Boolean(req.query.kill);
    const deathSelected = Boolean(req.query.death);

    try {
        if (!playerInput) {
            return renderEchoTrace(res, {
                error: "Please enter a player name or ID.",
                startDate: req.query.start || null,
                endDate: req.query.end || null,
                killSelected,
                deathSelected
            });
        }

        const isPlayerId = /^\d+$/.test(playerInput);
        const killerParam = isPlayerId ? "killer_id" : "killer_name";
        const victimParam = isPlayerId ? "victim_id" : "victim_name";
        const requests = [];

        if (killSelected || (!killSelected && !deathSelected)) {
            requests.push(fetchAllPagesParallel(
                `https://echoes.mobi/api/killmails?${killerParam}=${encodeURIComponent(playerInput)}`
            ));
        }

        if (deathSelected || (!killSelected && !deathSelected)) {
            requests.push(fetchAllPagesParallel(
                `https://echoes.mobi/api/killmails?${victimParam}=${encodeURIComponent(playerInput)}`
            ));
        }

        let allData = (await Promise.all(requests)).flat();
        const startDate = parseDateBoundary(req.query.start);
        const endDate = parseDateBoundary(req.query.end, true);

        if (startDate || endDate) {
            allData = allData.filter(row => {
                const rawDate = row.date_killed || row.date_created || row.date_updated;
                if (!rawDate) return false;

                const date = new Date(rawDate);
                if (Number.isNaN(date.getTime())) return false;
                if (startDate && date < startDate) return false;
                if (endDate && date > endDate) return false;
                return true;
            });
        }

        const totalCount = allData.length || 1;
        const regionMap = {};
        let globalMaxSystemCount = 0;

        allData.forEach(row => {
            const region = row.region || "Unknown Region";
            const constellation = row.constellation || "Unknown Constellation";
            const system = row.system || "Unknown System";

            if (!regionMap[region]) {
                regionMap[region] = { count: 0, constellations: {} };
            }
            regionMap[region].count += 1;

            if (!regionMap[region].constellations[constellation]) {
                regionMap[region].constellations[constellation] = { count: 0, systems: {} };
            }
            regionMap[region].constellations[constellation].count += 1;

            if (!regionMap[region].constellations[constellation].systems[system]) {
                regionMap[region].constellations[constellation].systems[system] = { count: 0 };
            }
            regionMap[region].constellations[constellation].systems[system].count += 1;

            const systemCount = regionMap[region].constellations[constellation].systems[system].count;
            globalMaxSystemCount = Math.max(globalMaxSystemCount, systemCount);
        });

        const regions = Object.entries(regionMap).map(([regionName, regionData]) => {
            const constellations = Object.entries(regionData.constellations).map(([constellationName, constellationData]) => {
                const systems = Object.entries(constellationData.systems).map(([systemName, systemData]) => ({
                    name: systemName,
                    count: systemData.count,
                    percent: Number(((systemData.count / totalCount) * 100).toFixed(1)),
                    color: getColor(systemData.count, globalMaxSystemCount)
                }));

                return {
                    name: constellationName,
                    count: constellationData.count,
                    percent: Number(((constellationData.count / totalCount) * 100).toFixed(1)),
                    color: getColor(constellationData.count, globalMaxSystemCount),
                    systems: topN(systems, 5)
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

        const topRegions = topN(regions, 5);
        const maxBarHeight = 300;
        const hourlyCounts = Array(24).fill(0);

        allData.forEach(row => {
            const date = new Date(row.date_killed || row.date_created || row.date_updated);
            if (!Number.isNaN(date.getTime())) {
                hourlyCounts[date.getUTCHours()] += 1;
            }
        });

        const hourlyPercentages = hourlyCounts.map((count, hour) => ({
            hour: String(hour).padStart(2, "0"),
            height: Math.round((count / totalCount) * maxBarHeight),
            percent: Number(((count / totalCount) * 100).toFixed(1))
        }));

        return renderEchoTrace(res, {
            playerName: playerInput,
            topRegions,
            hourlyPercentages,
            startDate: req.query.start || null,
            endDate: req.query.end || null,
            killSelected,
            deathSelected
        });
    } catch (error) {
        console.error("Error in /echotrace/submit:", error);
        return renderEchoTrace(res, {
            error: "Failed to fetch or process data.",
            startDate: req.query.start || null,
            endDate: req.query.end || null,
            killSelected,
            deathSelected
        });
    }
});

export default router;
