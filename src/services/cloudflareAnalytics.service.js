const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

function requireEnvironment(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} is not configured`);
    }
    return value;
}

function toDateString(date) {
    return date.toISOString().slice(0, 10);
}

function buildDateRange(days) {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() - 1);

    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    return {
        startDate: toDateString(start),
        endDate: toDateString(end)
    };
}

function sumRows(rows, field) {
    return rows.reduce((total, row) => total + Number(row?.sum?.[field] || 0), 0);
}

function maxUniqueUsers(rows) {
    return rows.reduce((maximum, row) => {
        return Math.max(maximum, Number(row?.uniq?.uniques || 0));
    }, 0);
}

function aggregateDimension(rows, dimensionName, limit = 10) {
    return rows
        .map((row) => ({
            name: String(row?.dimensions?.[dimensionName] ?? "unknown"),
            requests: Number(row?.count ?? row?.sum?.requests ?? 0)
        }))
        .filter((row) => row.requests > 0)
        .sort((a, b) => b.requests - a.requests)
        .slice(0, limit);
}

async function runCloudflareQuery({ token, zoneId, startDate, endDate }) {
    const query = `
        query PhishtopiaWeeklyAnalytics(
            $zoneTag: string!
            $startDate: Date!
            $endDate: Date!
        ) {
            viewer {
                zones(filter: { zoneTag: $zoneTag }) {
                    daily: httpRequests1dGroups(
                        limit: 1000
                        filter: { date_geq: $startDate, date_leq: $endDate }
                    ) {
                        dimensions { date }
                        sum {
                            requests
                            pageViews
                            bytes
                            cachedRequests
                            cachedBytes
                            threats
                        }
                        uniq { uniques }
                    }
                    countries: httpRequestsAdaptiveGroups(
                        limit: 10
                        orderBy: [count_DESC]
                        filter: { date_geq: $startDate, date_leq: $endDate }
                    ) {
                        count
                        dimensions { clientCountryName }
                    }
                    paths: httpRequestsAdaptiveGroups(
                        limit: 10
                        orderBy: [count_DESC]
                        filter: { date_geq: $startDate, date_leq: $endDate }
                    ) {
                        count
                        dimensions { clientRequestPath }
                    }
                    statuses: httpRequestsAdaptiveGroups(
                        limit: 20
                        orderBy: [count_DESC]
                        filter: { date_geq: $startDate, date_leq: $endDate }
                    ) {
                        count
                        dimensions { edgeResponseStatus }
                    }
                    cacheStatuses: httpRequestsAdaptiveGroups(
                        limit: 20
                        orderBy: [count_DESC]
                        filter: { date_geq: $startDate, date_leq: $endDate }
                    ) {
                        count
                        dimensions { cacheStatus }
                    }
                }
            }
        }
    `;

    const response = await fetch(CLOUDFLARE_GRAPHQL_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            query,
            variables: {
                zoneTag: zoneId,
                startDate,
                endDate
            }
        }),
        signal: AbortSignal.timeout(20_000)
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(`Cloudflare returned HTTP ${response.status}`);
    }

    if (!payload) {
        throw new Error("Cloudflare returned an unreadable response");
    }

    if (payload.errors?.length) {
        const message = payload.errors.map((error) => error.message).join("; ");
        throw new Error(`Cloudflare GraphQL error: ${message}`);
    }

    const zone = payload.data?.viewer?.zones?.[0];
    if (!zone) {
        throw new Error("Cloudflare did not return analytics for the configured zone");
    }

    return zone;
}

export async function getCloudflareAnalyticsReport({ days = 7 } = {}) {
    const normalizedDays = Math.max(1, Math.min(31, Number.parseInt(days, 10) || 7));
    const token = requireEnvironment("CLOUDFLARE_API_TOKEN");
    const zoneId = requireEnvironment("CLOUDFLARE_ZONE_ID");
    const { startDate, endDate } = buildDateRange(normalizedDays);

    const zone = await runCloudflareQuery({ token, zoneId, startDate, endDate });
    const daily = zone.daily || [];

    const requests = sumRows(daily, "requests");
    const cachedRequests = sumRows(daily, "cachedRequests");
    const bytes = sumRows(daily, "bytes");
    const cachedBytes = sumRows(daily, "cachedBytes");

    return {
        generatedAt: new Date().toISOString(),
        period: {
            days: normalizedDays,
            startDate,
            endDate
        },
        totals: {
            requests,
            pageViews: sumRows(daily, "pageViews"),
            peakDailyUniqueVisitors: maxUniqueUsers(daily),
            bytes,
            cachedRequests,
            cachedBytes,
            threats: sumRows(daily, "threats"),
            cacheRequestRatio: requests > 0 ? cachedRequests / requests : 0,
            cacheByteRatio: bytes > 0 ? cachedBytes / bytes : 0
        },
        topCountries: aggregateDimension(zone.countries || [], "clientCountryName"),
        topPaths: aggregateDimension(zone.paths || [], "clientRequestPath"),
        statusCodes: aggregateDimension(zone.statuses || [], "edgeResponseStatus", 20),
        cacheStatuses: aggregateDimension(zone.cacheStatuses || [], "cacheStatus", 20),
        daily: daily
            .map((row) => ({
                date: row?.dimensions?.date,
                requests: Number(row?.sum?.requests || 0),
                pageViews: Number(row?.sum?.pageViews || 0),
                bytes: Number(row?.sum?.bytes || 0),
                cachedRequests: Number(row?.sum?.cachedRequests || 0),
                threats: Number(row?.sum?.threats || 0),
                uniqueVisitors: Number(row?.uniq?.uniques || 0)
            }))
            .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    };
}
