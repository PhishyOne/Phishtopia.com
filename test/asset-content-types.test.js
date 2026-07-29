import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const publicDir = join(rootDir, "public");

const EXPECTED_ASSETS = new Map([
    ["/styles/main.css", /^text\/css\b/],
    ["/styles/archive.css", /^text\/css\b/],
    ["/styles/errors.css", /^text\/css\b/],
    ["/styles/errors-cinematic.css", /^text\/css\b/],
    ["/styles/youlist.css", /^text\/css\b/],
    ["/styles/youlist-mobile.css", /^text\/css\b/],
    ["/styles/echotrace.css", /^text\/css\b/],
    ["/js/auth.js", /javascript/],
    ["/js/canvas.js", /javascript/],
    ["/js/echotrace-logo.js", /javascript/],
    ["/js/echotrace.js", /javascript/],
    ["/js/error-scenes.js", /javascript/],
    ["/js/register.js", /javascript/],
    ["/js/youlist.js", /javascript/],
    ["/images/discord.svg", /^image\/svg\+xml\b/],
    ["/images/errors/403.webp", /^image\/webp\b/],
    ["/images/errors/404.webp", /^image\/webp\b/],
    ["/images/errors/429.webp", /^image\/webp\b/],
    ["/images/errors/500.webp", /^image\/webp\b/],
    ["/images/errors/502.webp", /^image\/webp\b/],
    ["/images/errors/503.webp", /^image\/webp\b/],
    ["/images/errors/504.webp", /^image\/webp\b/],
    ["/images/logoBG.jpg", /^image\/jpeg\b/],
    ["/images/phishLogo.png", /^image\/png\b/],
    ["/images/share-card.png", /^image\/png\b/],
    ["/images/youtube.svg", /^image\/svg\+xml\b/],
    ["/images/youlist-placeholder.jpg", /^image\/jpeg\b/],
    ["/fonts/evealpha-bold.ttf", /^font\/ttf\b/]
]);

async function listFiles(baseDir, relativePath) {
    const entries = await readdir(join(baseDir, relativePath), { withFileTypes: true });
    const paths = [];

    for (const entry of entries) {
        const child = join(relativePath, entry.name);
        if (entry.isDirectory()) paths.push(...await listFiles(baseDir, child));
        else paths.push(child.replaceAll("\\", "/"));
    }

    return paths;
}

test("active frontend asset inventory is explicit and contains no orphan files", async () => {
    const actualAssets = (await Promise.all([
        listFiles(publicDir, "styles"),
        listFiles(publicDir, "js"),
        listFiles(publicDir, "images"),
        listFiles(publicDir, "fonts")
    ])).flat().map(path => `/${path}`).sort();

    assert.deepEqual(actualAssets, [...EXPECTED_ASSETS.keys()].sort());
});

test("every inventoried asset has a production source reference", async () => {
    const sourceRoots = ["src", "views", "public/styles", "public/js", "ops/nginx"];
    const sourceFiles = (await Promise.all(sourceRoots.map(path => listFiles(rootDir, path))))
        .flat()
        .filter(path => [".js", ".ejs", ".css", ".conf"].includes(extname(path)));
    const sourceText = (await Promise.all(
        sourceFiles.map(path => readFile(join(rootDir, path), "utf8"))
    )).join("\n");

    for (const assetPath of EXPECTED_ASSETS.keys()) {
        assert.ok(sourceText.includes(assetPath), `${assetPath} should have an active production reference`);
    }
});

test("font declarations live in EchoTrace CSS instead of the shared header", async () => {
    const header = await readFile(join(rootDir, "views/partials/header.ejs"), "utf8");
    const echoTraceCss = await readFile(join(publicDir, "styles/echotrace.css"), "utf8");

    assert.doesNotMatch(header, /@font-face/);
    assert.doesNotMatch(header, /evealpha_bold\.ttf/);
    assert.match(echoTraceCss, /font-family:\s*'Shentox'/);
    assert.match(echoTraceCss, /\/fonts\/evealpha-bold\.ttf/);
    assert.doesNotMatch(echoTraceCss, /\/styles\/evealpha_bold\.ttf/);
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

test("every active local asset returns its expected content type", async () => {
    for (const [assetPath, expectedType] of EXPECTED_ASSETS) {
        const response = await fetch(`${baseUrl}${assetPath}`, { redirect: "manual" });
        assert.equal(response.status, 200, `${assetPath} should return 200`);
        assert.match(
            response.headers.get("content-type") || "",
            expectedType,
            `${assetPath} should use the expected content type`
        );
    }

    const retiredFont = await fetch(`${baseUrl}/styles/evealpha_bold.ttf`, { redirect: "manual" });
    assert.equal(retiredFont.status, 404);
});