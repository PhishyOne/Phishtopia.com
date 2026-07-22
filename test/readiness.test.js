import assert from "node:assert/strict";
import { test } from "node:test";

import { createReadinessHandler } from "../src/services/readiness.service.js";

function createResponseRecorder() {
    return {
        body: null,
        headers: new Map(),
        statusCode: null,
        set(name, value) {
            this.headers.set(name.toLowerCase(), value);
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

async function runReadiness(options) {
    const response = createResponseRecorder();
    const handler = createReadinessHandler(options);
    await handler({}, response);
    return response;
}

test("readiness reports ready after the fixed PostgreSQL probe succeeds", async () => {
    let receivedQuery;
    const response = await runReadiness({
        timeoutMs: 100,
        query: async query => {
            receivedQuery = query;
            return { rows: [{ "?column?": 1 }] };
        }
    });

    assert.deepEqual(receivedQuery, {
        text: "SELECT 1",
        query_timeout: 100
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.body.status, "ready");
    assert.equal(response.body.service, "phishtopia");
    assert.equal(response.body.dependencies.postgres, "ready");
    assert.ok(Number.isFinite(Date.parse(response.body.timestamp)));
});

test("readiness fails closed without exposing PostgreSQL errors", async () => {
    const sensitiveMessage = "password=do-not-return host=private-db.internal";
    const response = await runReadiness({
        timeoutMs: 100,
        query: async () => {
            throw new Error(sensitiveMessage);
        }
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.body.status, "not_ready");
    assert.equal(response.body.service, "phishtopia");
    assert.equal(response.body.dependencies.postgres, "unavailable");
    assert.doesNotMatch(JSON.stringify(response.body), /do-not-return|private-db/i);
});

test("readiness returns 503 within its deadline when PostgreSQL hangs", async () => {
    const startedAt = Date.now();
    const response = await runReadiness({
        timeoutMs: 25,
        query: () => new Promise(() => {})
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "not_ready");
    assert.equal(response.body.dependencies.postgres, "unavailable");
    assert.ok(elapsedMs < 500, `readiness took ${elapsedMs}ms`);
});
