import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const HOME_DESCRIPTION = "Phishtopia is an independent collection of practical web tools, unusual experiments, and original projects.";

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

async function render(path) {
    const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
    assert.equal(response.status, 200, `${path} should render successfully`);
    return response.text();
}

function readJsonLd(html) {
    return [...html.matchAll(
        /<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g
    )].map(match => JSON.parse(match[1]));
}

test("homepage publishes one valid WebSite structured-data object", async () => {
    const structuredData = readJsonLd(await render("/"));

    assert.equal(structuredData.length, 1);
    assert.deepEqual(structuredData[0], {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": "https://phishtopia.com/#website",
        url: "https://phishtopia.com/",
        name: "Phishtopia",
        alternateName: "Phishtopia.com",
        description: HOME_DESCRIPTION,
        inLanguage: "en"
    });
});

test("homepage keeps the brand, domain, tagline, and description visually distinct", async () => {
    const html = await render("/");

    assert.match(html, /<h1 class="gradient-text">Phishtopia\.com<\/h1>/);
    assert.match(html, /<p class="hero-tagline"><strong>Home of the Improbable\.<\/strong><\/p>/);
    assert.match(html, new RegExp(`<p class="hero-description">${HOME_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/p>`));
    assert.match(html, new RegExp(`<meta name="description" content="${HOME_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
    assert.doesNotMatch(html, /class="hero-domain"/);
});

test("non-home public pages do not inherit homepage WebSite structured data", async () => {
    for (const path of ["/archive", "/contact", "/privacy", "/echotrace", "/storecalc"]) {
        assert.deepEqual(readJsonLd(await render(path)), [], `${path} should not publish WebSite JSON-LD`);
    }
});
