import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const publicDir = join(rootDir, "public");

const PUBLIC_CANONICAL_URLS = [
    "https://phishtopia.com/",
    "https://phishtopia.com/archive",
    "https://phishtopia.com/contact",
    "https://phishtopia.com/privacy",
    "https://phishtopia.com/echotrace",
    "https://phishtopia.com/storecalc"
];

const PRIVATE_OR_UTILITY_PATHS = [
    "/account",
    "/auth",
    "/dashboard",
    "/echotrace/submit",
    "/health",
    "/internal",
    "/ready",
    "/youlist"
];

function sitemapLocations(xml) {
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
}

test("robots.txt permits public crawling and points to the canonical sitemap", async () => {
    const robots = await readFile(join(publicDir, "robots.txt"), "utf8");

    assert.match(robots, /^User-agent: \*$/m);
    assert.match(robots, /^Allow: \/$/m);
    assert.match(robots, /^Sitemap: https:\/\/phishtopia\.com\/sitemap\.xml$/m);
    assert.match(robots, /disappointed fish/i);

    for (const path of PRIVATE_OR_UTILITY_PATHS) {
        assert.match(robots, new RegExp(`^Disallow: ${path.replace("/", "\\/")}$`, "m"));
    }
});

test("sitemap contains only the intended public canonical pages", async () => {
    const sitemap = await readFile(join(publicDir, "sitemap.xml"), "utf8");
    const locations = sitemapLocations(sitemap);

    assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.deepEqual(locations, PUBLIC_CANONICAL_URLS);
    assert.equal(new Set(locations).size, locations.length, "sitemap URLs should be unique");

    for (const location of locations) {
        assert.ok(location.startsWith("https://phishtopia.com/"));
        for (const privatePath of PRIVATE_OR_UTILITY_PATHS) {
            assert.equal(location.includes(privatePath), false, `${location} should not expose ${privatePath}`);
        }
    }
});

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

test("SEO files are served with crawler-compatible content types", async () => {
    const robots = await fetch(`${baseUrl}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.match(robots.headers.get("content-type") || "", /^text\/plain\b/);

    const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers.get("content-type") || "", /^(?:application|text)\/xml\b/);
});
