const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

function requiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is not configured`);
    return value;
}

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function dateRange(days) {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() - 1);

    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const exclusiveEnd = new Date(end);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);

    return {
        startDate: isoDate(start),
        endDate: isoDate(end),
        startTime: `${isoDate(start)}T00:00:00Z`,
        endTime: `${isoDate(exclusiveEnd)}T00:00:00Z`
    };
}

function sum(rows, field) {
    return rows.reduce((total, row) => total + Number(row?.sum?.[field] || 0), 0);
}

function rank(rows, dimension, limit = 10) {
    return (rows || [])
        .map((row) => ({
            name: String(row?.dimensions?.[dimension] ?? "unknown"),
            requests: Number(row?.count || 0)
        }))
        .filter((row) => row.requests > 0)
        .sort((a, b) => b.requests - a.requests)
        .slice(0, limit);
}

async function queryCloudflare({ token, zoneId, range }) {
    const query = `
        query WeeklyReport(
            $zoneTag: string!
            $startDate: Date!
            $endDate: Date!
            $startTime: Time!
            $endTime: Time!
        ) {
            viewer {
                zones(filter: { zoneTag: $zoneTag }) {
                    daily: httpRequests1dGroups(
                        limit: 31
                        filter: { date_geq: $startDate, date_leq: $endDate }
                    ) {
                        dimensions { date }
                        sum { requests pageViews bytes cachedRequests cachedBytes threats }
                        uniq { uniques }
                    }
                    countries: httpRequestsAdaptiveGroups(
                        limit: 10
                        orderBy: [count_DESC]
                        filter: { datetime_geq: $startTime, datetime_lt: $endTime, requestSource: "eyeball" }
                    ) { count dimensions { clientCountryName } }
                    paths: httpRequestsAdaptiveGroups(
                        limit: 10
                        orderBy: [count_DESC]
                        filter: { datetime_geq: $startTime, datetime_lt: $endTime, requestSource: "eyeball" }
                    ) { count dimensions { clientRequestPath } }
                    statuses: httpRequestsAdaptiveGroups(
                        limit: 20
                        orderBy: [count_DESC]
                        filter: { datetime_geq: $startTime, datetime_lt: $endTime, requestSource: "eyeball" }
                    ) { count dimensions { edgeResponseStatus } }
                    cacheStatuses: httpRequestsAdaptiveGroups(
                        limit: 20
                        orderBy: [count_DESC]
                        filter: { datetime_geq: $startTime, datetime_lt: $endTime, requestSource: "eyeball" }
                    ) { count dimensions { cacheStatus } }
                }
            }
        }
    `;

    const response = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            query,
            variables: { zoneTag: zoneId, ...range }
        }),
        signal: AbortSignal.timeout(20_000)
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Cloudflare returned HTTP ${response.status}`);
    if (!payload) throw new Error("Cloudflare returned an unreadable response");
    if (payload.errors?.length) {
        throw new Error(`Cloudflare GraphQL error: ${payload.errors.map((item) => item.message).join("; ")}`);
    }

    const zone = payload.data?.viewer?.zones?.[0];
    if (!zone) throw new Error("Cloudflare returned no analytics for the configured zone");
    return zone;
}

export async function getCloudflareAnalyticsReport({ days = 7 } = {}) {
    const normalizedDays = Math.max(1, Math.min(31, Number.parseInt(days, 10) || 7));
    const range = dateRange(normalizedDays);
    const zone = await queryCloudflare({
        token: requiredEnv("CLOUDFLARE_API_TOKEN"),
        zoneId: requiredEnv("CLOUDFLARE_ZONE_ID"),
        range
    });

    const daily = zone.daily || [];
    const requests = sum(daily, "requests");
    const bytes = sum(daily, "bytes");
    const cachedRequests = sum(daily, "cachedRequests");
    const cachedBytes = sum(daily, "cachedBytes");

    return {
        generatedAt: new Date().toISOString(),
        period: {
            days: normalizedDays,
            startDate: range.startDate,
            endDate: range.endDate
        },
        totals: {
            requests,
            pageViews: sum(daily, "pageViews"),
            peakDailyUniqueVisitors: Math.max(0, ...daily.map((row) => Number(row?.uniq?.uniques || 0))),
            bytes,
            cachedRequests,
            cachedBytes,
            threats: sum(daily, "threats"),
            cacheRequestRatio: requests ? cachedRequests / requests : 0,
            cacheByteRatio: bytes ? cachedBytes / bytes : 0
        },
        topCountries: rank(zone.countries, "clientCountryName"),
        topPaths: rank(zone.paths, "clientRequestPath"),
        statusCodes: rank(zone.statuses, "edgeResponseStatus", 20),
        cacheStatuses: rank(zone.cacheStatuses, "cacheStatus", 20),
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
