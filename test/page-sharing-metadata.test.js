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
        image: "https://phishtopia.com/share/home.svg"
    },
    {
        path: "/archive",
        title: "Project Archive | Phishtopia",
        image: "https://phishtopia.com/share/archive.svg"
    },
    {
        path: "/contact",
        title: "Contact Phishtopia",
        image: "https://phishtopia.com/share/contact.svg"
    },
    {
        path: "/privacy",
        title: "Privacy at Phishtopia",
        image: "https://phishtopia.com/share/privacy.svg"
    },
    {
        path: "/echotrace",
        title: "EchoTrace | EVE Player Intelligence",
        image: "https://phishtopia.com/share/echotrace.svg"
    },
    {
        path: "/storecalc",
        title: "StoreCalc Online | Commissary Order Calculator",
        image: "https://phishtopia.com/share/storecalc.svg"
    }
];

const SHARE_FILES = [
    "home.svg",
    "youlist.svg",
    "echotrace.svg",
    "storecalc.svg",
    "archive.svg",
    "contact.svg",
    "privacy.svg"
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
        assert.match(html, /<meta property="og:image:type" content="image\/svg\+xml">/);
        assert.match(html, /<meta property="og:image:width" content="1200">/);
        assert.match(html, /<meta property="og:image:height" content="630">/);
        assert.match(html, /<meta property="og:image:alt" content="[^"]+">/);
        assert.match(html, /<meta name="twitter:image:alt" content="[^"]+">/);
        assert.doesNotMatch(html, /<meta name="description" content="Home of the Improbable\.">/);

        observedImages.add(page.image);
    }

    assert.equal(observedImages.size, PUBLIC_SHARE_PAGES.length);
});

test("every dedicated share card is self-contained, accessible, and 1200 by 630", async () => {
    const titles = new Set();

    for (const fileName of SHARE_FILES) {
        const source = await readFile(join(rootDir, "public/share", fileName), "utf8");
        assert.match(source, /<svg[^>]+width="1200"[^>]+height="630"[^>]+viewBox="0 0 1200 630"/);
        assert.match(source, /role="img"/);
        assert.match(source, /aria-labelledby="title desc"/);
        assert.match(source, /<title id="title">[^<]+<\/title>/);
        assert.match(source, /<desc id="desc">[^<]+<\/desc>/);
        assert.doesNotMatch(source, /https?:\/\//);

        const title = source.match(/<title id="title">([^<]+)<\/title>/)?.[1];
        assert.ok(title);
        titles.add(title);

        const response = await fetch(`${baseUrl}/share/${fileName}`, { redirect: "manual" });
        assert.equal(response.status, 200, `/share/${fileName} should return 200`);
        assert.match(response.headers.get("content-type") || "", /^image\/svg\+xml\b/);
    }

    assert.equal(titles.size, SHARE_FILES.length);
});

test("YouList has dedicated sharing content even though the application requires login", async () => {
    const header = await readFile(join(rootDir, "views/partials/header.ejs"), "utf8");

    assert.match(header, /'youlist':\s*\{/);
    assert.match(header, /title:\s*'YouList \| Build Your Watchlist'/);
    assert.match(header, /image:\s*'https:\/\/phishtopia\.com\/share\/youlist\.svg'/);

    const response = await fetch(`${baseUrl}/youlist`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") || "", /\/auth\/login\?returnTo=/);
});

test("non-public account and authentication pages retain a branded fallback card", async () => {
    const header = await readFile(join(rootDir, "views/partials/header.ejs"), "utf8");

    assert.match(header, /sharePage\.image \|\| 'https:\/\/phishtopia\.com\/images\/share-card\.png'/);
    assert.match(header, /sharePage\.imageType \|\| 'image\/png'/);
});
