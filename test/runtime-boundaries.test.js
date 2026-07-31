import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { COURSE_ARCHIVE } from "../src/data/courseArchive.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const activeViewRoots = [
    "views/partials",
    "views/account",
    "views/dashboard",
    "views/youlist",
    "views/echotrace",
    "views/storecalc"
];
const activeViewFiles = [
    "views/index.ejs",
    "views/archive.ejs",
    "views/contact.ejs",
    "views/login.ejs",
    "views/register.ejs",
    "views/resend-verification.ejs",
    "views/check-email.ejs"
];
const activeAssetFiles = [
    "public/styles/main.css",
    "public/styles/account.css",
    "public/styles/dashboard.css",
    "public/styles/password-policy.css",
    "public/styles/archive.css",
    "public/styles/youlist.css",
    "public/styles/youlist-mobile.css",
    "public/styles/echotrace.css",
    "public/js/canvas.js",
    "public/js/youlist.js",
    "public/js/echotrace.js",
    "public/js/echotrace-logo.js"
];

const retiredRuntimePatterns = [
    /app-brewery-server/,
    /["'`]\/static(?:\/|["'`])/,
    /["'`]\/projects(?:\/|["'`])/,
    /\/project\d[\w-]*(?:\/|["'`])/,
    /project34/,
    /["'`]\/player-int(?:\/|["'`])/,
    /res\.render\(["'`]player-int["'`]/,
    /\/styles\/player-int\.css/,
    /\/js\/player-int\.js/,
    /\/js\/little-logo\.js/,
    /projectAssetsDir/
];

async function listFiles(relativePath) {
    const absolutePath = join(rootDir, relativePath);
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const child = join(relativePath, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(child));
        else files.push(child);
    }

    return files;
}

async function assertFilesAvoidRetiredPaths(files) {
    for (const relativePath of files) {
        const content = await readFile(join(rootDir, relativePath), "utf8");
        for (const pattern of retiredRuntimePatterns) {
            assert.doesNotMatch(content, pattern, `${relativePath} must not reference ${pattern}`);
        }
    }
}

test("active server source has no retired course-work dependencies", async () => {
    const archiveMetadataPath = "src/data/courseArchive.js";
    const sourceFiles = (await listFiles("src")).filter(path =>
        path.endsWith(".js")
        && path !== "src/middleware/staticAssets.js"
        && path !== archiveMetadataPath
    );
    await assertFilesAvoidRetiredPaths(sourceFiles);

    const staticAssets = await readFile(join(rootDir, "src/middleware/staticAssets.js"), "utf8");
    assert.match(staticAssets, /RETIRED_PUBLIC_PATH/);
    assert.match(staticAssets, /project\(\?:25\|28\|29\|30\|33-1\|33-2\|33-3\|34\)/);
    assert.match(staticAssets, /error\.status\s*=\s*410/);
    assert.doesNotMatch(staticAssets, /projectAssetsDir/);

    const archiveMetadata = await readFile(join(rootDir, archiveMetadataPath), "utf8");
    assert.match(archiveMetadata, /archive\/course-projects-2026-07-28/);
    assert.doesNotMatch(archiveMetadata, /currentPath:\s*["'`]\/(?:project|static)/);
});

test("active templates and browser assets use canonical feature paths", async () => {
    const nestedViews = (await Promise.all(activeViewRoots.map(listFiles))).flat();
    await assertFilesAvoidRetiredPaths([
        ...activeViewFiles,
        ...nestedViews,
        ...activeAssetFiles
    ]);

    const youListClient = await readFile(join(rootDir, "public/js/youlist.js"), "utf8");
    assert.match(youListClient, /\/images\/youlist-placeholder\.jpg/);

    const echoTraceRouter = await readFile(join(rootDir, "src/routes/echotrace.routes.js"), "utf8");
    const pageAssets = await readFile(join(rootDir, "src/config/pageAssets.js"), "utf8");
    assert.match(echoTraceRouter, /res\.render\("echotrace\/index", pageLocals\("echotrace"/);
    assert.match(pageAssets, /\/styles\/echotrace\.css/);
    assert.match(pageAssets, /\/js\/echotrace\.js/);
});

test("course archive points to the preserved branch and retains the manifest", async () => {
    const archive = await readFile(join(rootDir, "docs/course-project-archive.md"), "utf8");
    assert.match(archive, /archive\/course-projects-2026-07-28/);

    for (const title of [
        "Chapter 34 - Movie Database (YouList)",
        "Chapter 33-3 - To Do List",
        "Chapter 29 - Capstone Project - Eve Echoes PlayInt",
        "Chapter 20 - Simon",
        "Chapter 13 - Capstone - My Own Site",
        "Chapter 2 - Movie Rank"
    ]) {
        assert.ok(archive.includes(title), `archive should retain ${title}`);
    }

    const projects = [...COURSE_ARCHIVE.backEnd, ...COURSE_ARCHIVE.frontEnd];
    assert.equal(projects.length, 24);
    assert.match(COURSE_ARCHIVE.branchUrl, /archive\/course-projects-2026-07-28/);

    for (const project of projects) {
        assert.match(project.screenshot, /\/blob\/archive\/course-projects-2026-07-28\//);
        assert.match(project.source, /\/tree\/archive\/course-projects-2026-07-28\//);
        assert.ok(
            project.currentPath === null || ["/youlist", "/echotrace"].includes(project.currentPath),
            `${project.title} must not reactivate a retired route`
        );
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

async function request(path) {
    return fetch(`${baseUrl}${path}`, { redirect: "manual" });
}

test("active public pages do not emit retired local URLs", async () => {
    for (const path of ["/", "/archive", "/contact", "/auth/login", "/auth/register", "/echotrace", "/storecalc"]) {
        const response = await request(path);
        assert.equal(response.status, 200, `${path} should return 200`);
        const html = await response.text();
        assert.doesNotMatch(
            html,
            /(?:href|src|action)=["']\/(?:static|projects|project\d[\w-]*|player-int)(?:\/|["'])/
        );
    }
});

test("EchoTrace serves canonical assets while retired paths use 404 or 410 correctly", async () => {
    const canonicalAssets = [
        ["/styles/echotrace.css", /text\/css/],
        ["/js/echotrace.js", /javascript/],
        ["/js/echotrace-logo.js", /javascript/]
    ];

    for (const [path, contentType] of canonicalAssets) {
        const response = await request(path);
        assert.equal(response.status, 200, `${path} should return 200`);
        assert.match(response.headers.get("content-type") || "", contentType);
    }

    for (const path of [
        "/styles/player-int.css",
        "/js/player-int.js",
        "/js/little-logo.js"
    ]) {
        const response = await request(path);
        assert.equal(response.status, 404, `${path} should return 404`);
    }

    for (const path of [
        "/project34/images/placeholder.png",
        "/project29/images/preview.png",
        "/static/20-Simon/",
        "/projects/assets",
        "/player-int"
    ]) {
        const response = await request(path);
        assert.equal(response.status, 410, `${path} should return 410`);
    }
});
