const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

function env(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is not configured`);
    return value;
}

function dateOnly(date) {
    return date.toISOString().slice(0, 10);
}

function makeRange(days) {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() - 1);

    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    return {
        startDate: dateOnly(start),
        endDate: dateOnly(end)
    };
}

function makeDailyWindows(startDate, endDate) {
    const windows = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const finalDate = new Date(`${endDate}T00:00:00Z`);

    while (cursor <= finalDate) {
        const next = new Date(cursor);
        next.setUTCDate(next.getUTCDate() + 1);

        windows.push({
            date: dateOnly(cursor),
            startTime: `${dateOnly(cursor)}T00:00:00Z`,
            endTime: `${dateOnly(next)}T00:00:00Z`
        });

        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return windows;
}

async function graph(token, query, variables) {
    const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20000)
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Cloudflare returned HTTP ${response.status}`);
    if (!body) throw new Error("Cloudflare returned an unreadable response");
    if (body.errors?.length) {
        throw new Error(body.errors.map((item) => item.message).join("; "));
    }
    return body.data;
}

function total(rows, field) {
    return rows.reduce((sum, row) => sum + Number(row?.sum?.[field] || 0), 0);
}

function mergeBreakdownRows(allRows, limit = 10) {
    const totals = new Map();

    for (const rows of allRows) {
        for (const row of rows) {
            totals.set(row.name, (totals.get(row.name) || 0) + Number(row.requests || 0));
        }
    }

    return [...totals.entries()]
        .map(([name, requests]) => ({ name, requests }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, limit);
}

async function getDaily(token, zoneId, range) {
    const query = `
        query Daily($zone: string!, $from: Date!, $to: Date!) {
            viewer {
                zones(filter: { zoneTag: $zone }) {
                    rows: httpRequests1dGroups(
                        limit: 31
                        filter: { date_geq: $from, date_leq: $to }
                    ) {
                        dimensions { date }
                        sum { requests pageViews bytes cachedRequests cachedBytes threats }
                        uniq { uniques }
                    }
                }
            }
        }
    `;

    const data = await graph(token, query, {
        zone: zoneId,
        from: range.startDate,
        to: range.endDate
    });

    return data?.viewer?.zones?.[0]?.rows || [];
}

async function getBreakdownForWindow(token, zoneId, window, dimension) {
    const query = `
        query Breakdown($zone: string!, $from: Time!, $to: Time!) {
            viewer {
                zones(filter: { zoneTag: $zone }) {
                    rows: httpRequestsAdaptiveGroups(
                        limit: 1000
                        orderBy: [count_DESC]
                        filter: {
                            datetime_geq: $from
                            datetime_lt: $to
                            requestSource: "eyeball"
                        }
                    ) {
                        count
                        dimensions { ${dimension} }
                    }
                }
            }
        }
    `;

    const data = await graph(token, query, {
        zone: zoneId,
        from: window.startTime,
        to: window.endTime
    });

    return (data?.viewer?.zones?.[0]?.rows || []).map((row) => ({
        name: String(row?.dimensions?.[dimension] ?? "unknown"),
        requests: Number(row?.count || 0)
    }));
}

async function getBreakdowns(token, zoneId, range, warnings) {
    const windows = makeDailyWindows(range.startDate, range.endDate);
    const dimensions = [
        ["topCountries", "clientCountryName", 10],
        ["topPaths", "clientRequestPath", 10],
        ["statusCodes", "edgeResponseStatus", 20],
        ["cacheStatuses", "cacheStatus", 20]
    ];

    const collected = Object.fromEntries(dimensions.map(([key]) => [key, []]));

    for (const window of windows) {
        const dayResults = await Promise.all(dimensions.map(async ([key, dimension]) => {
            try {
                const rows = await getBreakdownForWindow(token, zoneId, window, dimension);
                return { key, rows };
            } catch (error) {
                warnings.push(`${dimension} (${window.date}): ${error.message}`);
                return { key, rows: [] };
            }
        }));

        for (const result of dayResults) {
            collected[result.key].push(result.rows);
        }
    }

    return Object.fromEntries(dimensions.map(([key, , limit]) => [
        key,
        mergeBreakdownRows(collected[key], limit)
    ]));
}

export async function getCloudflareAnalyticsReport({ days = 7 } = {}) {
    const count = Math.max(1, Math.min(31, Number.parseInt(days, 10) || 7));
    const token = env("CLOUDFLARE_API_TOKEN");
    const zoneId = env("CLOUDFLARE_ZONE_ID");
    const range = makeRange(count);
    const daily = await getDaily(token, zoneId, range);
    const warnings = [];
    const breakdowns = await getBreakdowns(token, zoneId, range, warnings);

    const requests = total(daily, "requests");
    const bytes = total(daily, "bytes");
    const cachedRequests = total(daily, "cachedRequests");
    const cachedBytes = total(daily, "cachedBytes");

    return {
        generatedAt: new Date().toISOString(),
        period: { days: count, startDate: range.startDate, endDate: range.endDate },
        totals: {
            requests,
            pageViews: total(daily, "pageViews"),
            uniqueVisitorsEstimate: Math.max(0, ...daily.map((row) => Number(row?.uniq?.uniques || 0))),
            bytes,
            cachedRequests,
            cachedBytes,
            threats: total(daily, "threats"),
            cacheRequestRatio: requests ? cachedRequests / requests : 0,
            cacheByteRatio: bytes ? cachedBytes / bytes : 0
        },
        ...breakdowns,
        warnings,
        daily: daily.map((row) => ({
            date: row?.dimensions?.date,
            requests: Number(row?.sum?.requests || 0),
            pageViews: Number(row?.sum?.pageViews || 0),
            bytes: Number(row?.sum?.bytes || 0),
            cachedRequests: Number(row?.sum?.cachedRequests || 0),
            threats: Number(row?.sum?.threats || 0),
            uniqueVisitorsEstimate: Number(row?.uniq?.uniques || 0)
        })).sort((a, b) => String(a.date).localeCompare(String(b.date)))
    };
}
