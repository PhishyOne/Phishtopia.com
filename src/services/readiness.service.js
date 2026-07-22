import pool from "../db/pool.js";

export const READINESS_TIMEOUT_MS = 1500;

export async function checkPostgresReadiness({
    query = pool.query.bind(pool),
    timeoutMs = READINESS_TIMEOUT_MS
} = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError("Readiness timeout must be a positive number.");
    }

    let timeoutId;
    const timeoutResult = new Promise(resolve => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
        timeoutId.unref?.();
    });

    const queryResult = Promise.resolve()
        .then(() =>
            query({
                text: "SELECT 1",
                query_timeout: timeoutMs
            })
        )
        .then(
            () => true,
            () => false
        );

    try {
        return await Promise.race([queryResult, timeoutResult]);
    } finally {
        clearTimeout(timeoutId);
    }
}

export function createReadinessHandler(options = {}) {
    return async function readinessHandler(req, res) {
        const ready = await checkPostgresReadiness(options);

        res.set("Cache-Control", "no-store");
        return res.status(ready ? 200 : 503).json({
            status: ready ? "ready" : "not_ready",
            service: "phishtopia",
            dependencies: {
                postgres: ready ? "ready" : "unavailable"
            },
            timestamp: new Date().toISOString()
        });
    };
}
