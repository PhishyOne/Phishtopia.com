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

    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
});

test("EchoTrace metadata consistently identifies EVE Echoes", async () => {
    const response = await fetch(`${baseUrl}/echotrace`, { redirect: "manual" });
    assert.equal(response.status, 200);

    const html = await response.text();

    assert.match(
        html,
        /<meta property="og:title" content="EchoTrace \| EVE Echoes Player Intelligence">/
    );
    assert.match(
        html,
        /<meta name="description" content="Explore public EVE Echoes character signals and connections with EchoTrace\.">/
    );
    assert.match(
        html,
        /<meta property="og:image:alt" content="A futuristic radar display and connected star map for EVE Echoes player intelligence\.">/
    );
    assert.match(
        html,
        /<meta name="twitter:image:alt" content="A futuristic radar display and connected star map for EVE Echoes player intelligence\.">/
    );
    assert.doesNotMatch(html, /EVE Online/);
});
