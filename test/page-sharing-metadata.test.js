import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

const PUBLIC_SHARE_PAGES = [
    {
        path: "/",
        title: "Phishtopia | Home of the Improbable",
        image: "https://phishtopia.com/share/home.png"
    },
    {
        path: "/archive",
        title: "Project Archive | Phishtopia",
        image: "https://phishtopia.com/share/archive.png"
    },
    {
        path: "/contact",
        title: "Contact Phishtopia",
        image: "https://phishtopia.com/share/contact.png"
    },
    {
        path: "/privacy",
        title: "Privacy at Phishtopia",
        image: "https://phishtopia.com/share/privacy.png"
    },
    {
        path: "/echotrace",
        title: "EchoTrace | EVE Echoes Player Intelligence",
        image: "https://phishtopia.com/share/echotrace.png"
    },
    {
        path: "/storecalc",
        title: "StoreCalc Online | Commissary Order Calculator",
        image: "https://phishtopia.com/share/storecalc.png"
    }
];

const SHARE_FILES = [
    "home.png",
    "youlist.png",
    "echotrace.png",
    "storecalc.png",
    "archive.png",
    "contact.png",
    "privacy.png"
];

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

function escaped(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("public pages publish distinct Open Graph and Twitter sharing information", async () => {
    const observedImages = new Set();

    for (const page of PUBLIC_SHARE_PAGES) {
        const response = await fetch(`${baseUrl}${page.path}`, {
            redirect: "manual",
            headers: { accept: "text/html" }
        });
        assert.equal(response.status, 200, `${page.path} should render directly`);
        const html = await response.text();

        assert.match(html, new RegExp(`<meta property="og:title" content="${escaped(page.title)}">`));
        assert.match(html, new RegExp(`<meta name="twitter:title" content="${escaped(page.title)}">`));
        assert.match(html, new RegExp(`<meta property="og:image" content="${escaped(page.image)}">`));
        assert.match(html, new RegExp(`<meta property="og:image:secure_url" content="${escaped(page.image)}">`));
        assert.match(html, new RegExp(`<meta name="twitter:image" content="${escaped(page.image)}">`));
        assert.match(html, /<meta property="og:image:type" content="image\/png">/);
        assert.match(html, /<meta property="og:image:width" content="1200">/);
        assert.match(html, /<meta property="og:image:height" content="630">/);
        assert.match(html, /<meta property="og:image:alt" content="[^"]+">/);
        assert.match(html, /<meta name="twitter:image:alt" content="[^"]+">/);
        assert.doesNotMatch(html, /<meta name="description" content="Home of the Improbable\.">/);

        observedImages.add(page.image);
    }

    assert.equal(observedImages.size, PUBLIC_SHARE_PAGES.length);
});

test("every dedicated share card is a cacheable 1200 by 630 PNG", async () => {
    const hashes = new Set();

    for (const fileName of SHARE_FILES) {
        const localImage = await readFile(join(rootDir, "public/share", fileName));
        assert.deepEqual(
            [...localImage.subarray(0, 8)],
            [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        );
        assert.equal(localImage.readUInt32BE(16), 1200);
        assert.equal(localImage.readUInt32BE(20), 630);
        hashes.add(localImage.toString("base64"));

        const response = await fetch(`${baseUrl}/share/${fileName}`, { redirect: "manual" });
        assert.equal(response.status, 200, `/share/${fileName} should return 200`);
        assert.match(response.headers.get("content-type") || "", /^image\/png\b/);
        assert.match(response.headers.get("cache-control") || "", /public/);
    }

    assert.equal(hashes.size, SHARE_FILES.length);
});

test("YouList has dedicated sharing content even though the application requires login", async () => {
    const header = await readFile(join(rootDir, "views/partials/header.ejs"), "utf8");

    assert.match(header, /'youlist':\s*\{/);
    assert.match(header, /title:\s*'YouList \| Build Your Watchlist'/);
    assert.match(header, /image:\s*'https:\/\/phishtopia\.com\/share\/youlist\.png'/);

    const response = await fetch(`${baseUrl}/youlist`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") || "", /\/auth\/login\?returnTo=/);
});

test("non-public account and authentication pages retain a branded fallback card", async () => {
    const header = await readFile(join(rootDir, "views/partials/header.ejs"), "utf8");

    assert.match(header, /sharePage\.image \|\| 'https:\/\/phishtopia\.com\/images\/share-card\.png'/);
    assert.match(header, /sharePage\.imageType \|\| 'image\/png'/);
});