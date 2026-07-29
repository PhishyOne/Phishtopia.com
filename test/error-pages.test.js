import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import ejs from "ejs";
import express from "express";

import { ERROR_PAGES, getErrorPage } from "../src/config/errorPages.js";
import { viewsDir } from "../src/config/paths.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { sendErrorResponse } from "../src/middleware/errorResponses.js";

let appServer;
let appBaseUrl;
let responseServer;
let responseBaseUrl;

async function listen(app) {
    const server = await new Promise((resolve, reject) => {
        const listeningServer = app.listen(0, "127.0.0.1", error => {
            if (error) reject(error);
            else resolve(listeningServer);
        });
    });

    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
    };
}

async function close(server) {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

before(async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "test-only-session-secret-that-is-long-enough";
    process.env.SITE_URL = "https://phishtopia.com";
    process.env.PREWARM_TMDB_CACHE = "false";
    delete process.env.DATABASE_URL;
    delete process.env.DB_HOST;

    const { createApp } = await import("../src/app.js");
    const appResult = await listen(await createApp());
    appServer = appResult.server;
    appBaseUrl = appResult.baseUrl;

    const responseApp = express();
    responseApp.set("view engine", "ejs");
    responseApp.set("views", viewsDir);
    responseApp.engine("ejs", ejs.__express);
    responseApp.locals.basedir = viewsDir;

    responseApp.get("/403", (req, res, next) => {
        const error = new Error("restricted preview");
        error.status = 403;
        next(error);
    });
    responseApp.get("/429", (req, res) => sendErrorResponse(req, res, 429));
    responseApp.get("/500", (req, res, next) => {
        const error = new Error("secret database host: internal-db.example");
        error.status = 500;
        next(error);
    });
    responseApp.get("/internal/boom", (req, res, next) => {
        next(new Error("private stack detail"));
    });
    responseApp.use(errorHandler);

    const responseResult = await listen(responseApp);
    responseServer = responseResult.server;
    responseBaseUrl = responseResult.baseUrl;
});

after(async () => {
    await Promise.all([close(appServer), close(responseServer)]);
});

test("error-page definitions are immutable and preserve supported statuses", () => {
    assert.ok(Object.isFrozen(ERROR_PAGES));
    assert.deepEqual(Object.keys(ERROR_PAGES), ["400", "403", "404", "405", "410", "429", "500"]);

    for (const page of Object.values(ERROR_PAGES)) {
        assert.ok(Object.isFrozen(page));
        assert.equal(getErrorPage(page.status), page);
    }

    const generic = getErrorPage(418);
    assert.equal(generic.status, 418);
    assert.equal(generic.apiMessage, "Request failed");
    assert.equal(getErrorPage("invalid"), ERROR_PAGES[500]);
});

test("unknown browser routes render the branded 404 without leaking internals", async () => {
    const response = await fetch(`${appBaseUrl}/this-page-does-not-exist`, {
        headers: { accept: "text/html" },
        redirect: "manual"
    });

    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type") || "", /^text\/html\b/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");

    const html = await response.text();
    assert.match(html, /<body class="error-page">/);
    assert.match(html, /class="error-stage error-stage--404 error-stage--scene-ready"/);
    assert.match(html, /--error-scene: url\('\/images\/errors\/404\.webp'\)/);
    assert.match(html, /This page is off the map\./);
    assert.match(html, /drifted into uncharted waters/);
    assert.match(html, /href="\/styles\/errors\.css"/);
    assert.match(html, /src="\/images\/phishLogo\.png"/);
    assert.match(html, /href="\/archive"/);
    assert.doesNotMatch(html, /Error:\s|node_modules|DATABASE_URL|internal-db/);
});

test("malformed request bodies use the cinematic 400 for browsers and JSON for APIs", async () => {
    const browserResponse = await fetch(`${appBaseUrl}/contact`, {
        method: "POST",
        headers: {
            accept: "text/html",
            "content-type": "application/json"
        },
        body: "{",
        redirect: "manual"
    });

    assert.equal(browserResponse.status, 400);
    assert.match(browserResponse.headers.get("content-type") || "", /^text\/html\b/);
    const html = await browserResponse.text();
    assert.match(html, /This request drifted off course\./);
    assert.match(html, /\/images\/errors\/400\.webp/);
    assert.match(html, /error-stage--scene-ready/);
    assert.doesNotMatch(html, /SyntaxError|Unexpected end|node_modules/);

    const apiResponse = await fetch(`${appBaseUrl}/internal/not-a-real-endpoint`, {
        method: "POST",
        headers: {
            accept: "application/json",
            "content-type": "application/json"
        },
        body: "{",
        redirect: "manual"
    });

    assert.equal(apiResponse.status, 400);
    assert.deepEqual(await apiResponse.json(), {
        success: false,
        status: 400,
        error: "Bad request"
    });
});

test("known GET-only pages return 405 with an Allow header", async () => {
    const browserResponse = await fetch(`${appBaseUrl}/contact`, {
        method: "POST",
        headers: {
            accept: "text/html",
            "content-type": "application/x-www-form-urlencoded"
        },
        body: "preview=true",
        redirect: "manual"
    });

    assert.equal(browserResponse.status, 405);
    assert.equal(browserResponse.headers.get("allow"), "GET, HEAD");
    assert.match(browserResponse.headers.get("content-type") || "", /^text\/html\b/);
    const html = await browserResponse.text();
    assert.match(html, /You can’t swim that direction\./);
    assert.match(html, /\/images\/errors\/405\.webp/);
    assert.match(html, /error-stage--scene-ready/);

    const apiResponse = await fetch(`${appBaseUrl}/archive`, {
        method: "DELETE",
        headers: { accept: "application/json" },
        redirect: "manual"
    });

    assert.equal(apiResponse.status, 405);
    assert.equal(apiResponse.headers.get("allow"), "GET, HEAD");
    assert.deepEqual(await apiResponse.json(), {
        success: false,
        status: 405,
        error: "Method not allowed"
    });
});

test("retired routes return cinematic 410 while retired assets stay lightweight", async () => {
    const browserResponse = await fetch(`${appBaseUrl}/project25`, {
        headers: { accept: "text/html" },
        redirect: "manual"
    });

    assert.equal(browserResponse.status, 410);
    assert.match(browserResponse.headers.get("content-type") || "", /^text\/html\b/);
    const html = await browserResponse.text();
    assert.match(html, /This page has sunk for good\./);
    assert.match(html, /permanently removed/);
    assert.match(html, /\/images\/errors\/410\.webp/);
    assert.match(html, /error-stage--scene-ready/);

    const apiResponse = await fetch(`${appBaseUrl}/project29`, {
        headers: { accept: "application/json" },
        redirect: "manual"
    });

    assert.equal(apiResponse.status, 410);
    assert.deepEqual(await apiResponse.json(), {
        success: false,
        status: 410,
        error: "Gone"
    });

    const assetResponse = await fetch(`${appBaseUrl}/project34/images/placeholder.png`, {
        redirect: "manual"
    });

    assert.equal(assetResponse.status, 410);
    assert.match(assetResponse.headers.get("content-type") || "", /^text\/plain\b/);
    assert.equal(await assetResponse.text(), "Gone");
});

test("missing API routes return structured JSON instead of an HTML page", async () => {
    const response = await fetch(`${appBaseUrl}/internal/not-a-real-endpoint`, {
        headers: { accept: "application/json" },
        redirect: "manual"
    });

    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type") || "", /^application\/json\b/);
    assert.deepEqual(await response.json(), {
        success: false,
        status: 404,
        error: "Not found"
    });
});

test("missing static assets stay lightweight and non-HTML", async () => {
    const response = await fetch(`${appBaseUrl}/styles/not-real.css`, { redirect: "manual" });

    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type") || "", /^text\/plain\b/);
    assert.equal(await response.text(), "Not found");
});

test("403 and 429 browser responses use their status-specific copy", async () => {
    const cases = [
        [403, "These waters are restricted.", "permission to pass"],
        [429, "Too many requests.", "causing a current"]
    ];

    for (const [status, title, message] of cases) {
        const response = await fetch(`${responseBaseUrl}/${status}`, {
            headers: { accept: "text/html" },
            redirect: "manual"
        });

        assert.equal(response.status, status);
        assert.match(response.headers.get("content-type") || "", /^text\/html\b/);
        const html = await response.text();
        assert.match(html, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(html, new RegExp(message));
        assert.match(html, new RegExp(`/images/errors/${status}\\.webp`));
        assert.match(html, /error-stage--scene-ready/);
    }
});

test("500 responses render safe copy for browsers and safe JSON for APIs", async () => {
    const browserResponse = await fetch(`${responseBaseUrl}/500`, {
        headers: { accept: "text/html" },
        redirect: "manual"
    });

    assert.equal(browserResponse.status, 500);
    assert.match(browserResponse.headers.get("content-type") || "", /^text\/html\b/);
    const html = await browserResponse.text();
    assert.match(html, /Something stirred in the depths\./);
    assert.match(html, /\/images\/errors\/500\.webp/);
    assert.match(html, /error-stage--scene-ready/);
    assert.doesNotMatch(html, /secret database host|internal-db\.example|node_modules/);

    const apiResponse = await fetch(`${responseBaseUrl}/internal/boom`, {
        headers: { accept: "application/json" },
        redirect: "manual"
    });

    assert.equal(apiResponse.status, 500);
    assert.deepEqual(await apiResponse.json(), {
        success: false,
        status: 500,
        error: "Internal server error"
    });
});

test("authentication rate limits use the branded 429 response", async () => {
    let response;

    for (let attempt = 1; attempt <= 11; attempt += 1) {
        response = await fetch(`${appBaseUrl}/auth/login`, {
            method: "POST",
            headers: {
                accept: "text/html",
                "content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                username: `rate-limit-preview-${attempt}`,
                password: "not-a-real-password"
            }),
            redirect: "manual"
        });
    }

    assert.equal(response.status, 429);
    assert.match(response.headers.get("content-type") || "", /^text\/html\b/);
    assert.match(await response.text(), /Too many requests\./);
});
