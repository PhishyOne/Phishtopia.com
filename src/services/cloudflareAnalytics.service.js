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

    const afterEnd = new Date(end);
    afterEnd.setUTCDate(afterEnd.getUTCDate() + 1);

    return {
        startDate: dateOnly(start),
        endDate: dateOnly(end),
        startTime: `${dateOnly(start)}T00:00:00Z`,
        endTime: `${dateOnly(afterEnd)}T00:00:00Z`
    };
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

async function getBreakdown(token, zoneId, range, dimension) {
    const query = `
        query Breakdown($zone: string!, $from: Time!, $to: Time!) {
            viewer {
                zones(filter: { zoneTag: $zone }) {
                    rows: httpRequestsAdaptiveGroups(
                        limit: 10
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
        from: range.startTime,
        to: range.endTime
    });

    return (data?.viewer?.zones?.[0]?.rows || []).map((row) => ({
        name: String(row?.dimensions?.[dimension] ?? "unknown"),
        requests: Number(row?.count || 0)
    }));
}

export async function getCloudflareAnalyticsReport({ days = 7 } = {}) {
    const count = Math.max(1, Math.min(31, Number.parseInt(days, 10) || 7));
    const token = env("CLOUDFLARE_API_TOKEN");
    const zoneId = env("CLOUDFLARE_ZONE_ID");
    const range = makeRange(count);
    const daily = await getDaily(token, zoneId, range);
    const warnings = [];

    async function optionalBreakdown(dimension) {
        try {
            return await getBreakdown(token, zoneId, range, dimension);
        } catch (error) {
            warnings.push(`${dimension}: ${error.message}`);
            return [];
        }
    }

    const [topCountries, topPaths, statusCodes, cacheStatuses] = await Promise.all([
        optionalBreakdown("clientCountryName"),
        optionalBreakdown("clientRequestPath"),
        optionalBreakdown("edgeResponseStatus"),
        optionalBreakdown("cacheStatus")
    ]);

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
        topCountries,
        topPaths,
        statusCodes,
        cacheStatuses,
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
