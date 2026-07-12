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
        server = app.listen(0, "127.0.0.1", resolve);
        server.once("error", reject);
    });

    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    if (!server) return;
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
