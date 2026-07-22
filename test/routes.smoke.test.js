import assert from "node:assert/strict";
import { after, before, test } from "node:test";

let server;
let baseUrl;

before(async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "test-only-session-secret-that-is-long-enough";
    process.env.SITE_URL = "https://phishtopia.com";
    process.env.PREWARM_TMDB_CACHE = "false";

    delete process.env.DATABASE_URL;
    delete process.env.DB_HOST;

    const { createApp } = await import("../src/app.js");
    const app = await createApp();

    await new Promise((resolve, reject) => {
        server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve());
    });

    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
});

async function request(path, options = {}) {
    return fetch(`${baseUrl}${path}`, {
        redirect: "manual",
        ...options
    });
}

test("health endpoint reports the service as available", async () => {
    const response = await request("/health");
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.status, "ok");
    assert.equal(body.service, "phishtopia");
});

test("readiness endpoint fails closed when PostgreSQL is not configured", async () => {
    const response = await request("/ready");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const body = await response.json();
    assert.equal(body.status, "not_ready");
    assert.equal(body.service, "phishtopia");
    assert.deepEqual(body.dependencies, { postgres: "unavailable" });
});

test("surviving public pages render successfully", async () => {
    const routes = [
        "/",
        "/contact",
        "/auth/login",
        "/auth/register",
        "/echotrace",
        "/storecalc"
    ];

    for (const route of routes) {
        const response = await request(route);
        assert.equal(response.status, 200, `${route} should return 200`);
        assert.match(response.headers.get("content-type") || "", /text\/html/);
    }
});

test("homepage advertises complete social preview metadata", async () => {
    const response = await request("/");
    assert.equal(response.status, 200);

    const body = await response.text();
    assert.match(body, /property="og:image" content="https:\/\/phishtopia\.com\/images\/share-card\.png"/);
    assert.match(body, /property="og:image:type" content="image\/png"/);
    assert.match(body, /property="og:image:width" content="1200"/);
    assert.match(body, /property="og:image:height" content="630"/);
    assert.match(body, /property="og:image:alt" content="[^"]+"/);
    assert.match(body, /name="twitter:image" content="https:\/\/phishtopia\.com\/images\/share-card\.png"/);
    assert.match(body, /name="twitter:image:alt" content="[^"]+"/);
});

test("social share image is a cacheable 1200x630 PNG", async () => {
    const response = await request("/images/share-card.png");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /^image\/png/);
    assert.match(response.headers.get("cache-control") || "", /public/);

    const image = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(
        [...image.subarray(0, 8)],
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    );
    assert.equal(image.readUInt32BE(16), 1200);
    assert.equal(image.readUInt32BE(20), 630);
});

test("database-less login previews return a clear service-unavailable message", async () => {
    const response = await request("/auth/login", {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            username: "preview-user",
            password: "not-a-real-password"
        })
    });

    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /unavailable in the local preview because no database is configured/i);
});

test("YouList still requires authentication", async () => {
    const response = await request("/youlist");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/auth/login");
});

test("retired course and legacy routes return 404", async () => {
    const retiredRoutes = [
        "/player-int",
        "/playerint",
        "/projects",
        "/project25",
        "/project28",
        "/project29",
        "/project30",
        "/project33-1",
        "/project33-2",
        "/project33-3",
        "/simon",
        "/intm-logo",
        "/static",
        "/static/20-Simon/"
    ];

    for (const route of retiredRoutes) {
        const response = await request(route);
        assert.equal(response.status, 404, `${route} should return 404`);
    }
});

test("the remaining home alias redirects to the canonical homepage", async () => {
    const response = await request("/home");
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("location"), "https://phishtopia.com/");
});

test("core static assets are still served", async () => {
    const response = await request("/styles/main.css");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/css/);
});
