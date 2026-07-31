import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { PAGE_DEFINITIONS, pageLocals } from "../src/config/pageAssets.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

const EXPECTED_PAGES = {
    home: {
        title: "Phishtopia",
        bodyClass: "home-page",
        styles: [],
        scripts: ["/js/canvas.js"]
    },
    contact: {
        title: "Contact Me",
        bodyClass: "contact",
        styles: [],
        scripts: []
    },
    privacy: {
        title: "Privacy | Phishtopia",
        bodyClass: "privacy",
        styles: ["/styles/privacy.css"],
        scripts: []
    },
    archive: {
        title: "Course Project Archive",
        bodyClass: "archive-page",
        styles: ["/styles/archive.css"],
        scripts: ["/js/canvas.js"]
    },
    error: {
        title: "Error | Phishtopia",
        bodyClass: "error-page",
        styles: ["/styles/errors.css", "/styles/errors-cinematic.css"],
        scripts: ["/js/error-scenes.js"]
    },
    login: {
        title: "Login",
        bodyClass: "auth",
        styles: ["/styles/password-toggle.css"],
        scripts: ["/js/auth.js"]
    },
    register: {
        title: "Register",
        bodyClass: "register",
        styles: ["/styles/password-policy.css", "/styles/password-toggle.css"],
        scripts: ["/js/register.js", "/js/auth.js"]
    },
    resendVerification: {
        title: "Resend verification email",
        bodyClass: "auth",
        styles: [],
        scripts: []
    },
    checkEmail: {
        title: "Check your email",
        bodyClass: "auth",
        styles: [],
        scripts: []
    },
    dashboard: {
        title: "Dashboard | Phishtopia",
        bodyClass: "dashboard",
        styles: ["/styles/dashboard.css"],
        scripts: []
    },
    account: {
        title: "Account | Phishtopia",
        bodyClass: "account",
        styles: ["/styles/account.css", "/styles/password-policy.css", "/styles/password-toggle.css"],
        scripts: ["/js/auth.js"]
    },
    accountDeleted: {
        title: "Account deleted | Phishtopia",
        bodyClass: "account account-deleted",
        styles: ["/styles/account.css"],
        scripts: []
    },
    youlist: {
        title: "YouList - Movies",
        bodyClass: "youlist",
        styles: ["/styles/youlist.css", "/styles/youlist-mobile.css"],
        scripts: ["/js/canvas.js", "/js/youlist.js"]
    },
    echotrace: {
        title: "EchoTrace",
        bodyClass: "player-int",
        styles: ["/styles/echotrace.css"],
        scripts: ["/js/echotrace-logo.js", "/js/echotrace.js"]
    },
    storecalc: {
        title: "StoreCalc Online",
        bodyClass: "storecalc",
        styles: ["/styles/storecalc.css"],
        scripts: ["/js/storecalc.js"]
    }
};

test("page definitions are complete, immutable, and return isolated locals", () => {
    assert.deepEqual(PAGE_DEFINITIONS, EXPECTED_PAGES);
    assert.ok(Object.isFrozen(PAGE_DEFINITIONS));

    for (const page of Object.values(PAGE_DEFINITIONS)) {
        assert.ok(Object.isFrozen(page));
        assert.ok(Object.isFrozen(page.styles));
        assert.ok(Object.isFrozen(page.scripts));
    }

    const locals = pageLocals("youlist", { csrfToken: "token" });
    assert.equal(locals.csrfToken, "token");
    locals.extraStyles.push("/styles/not-real.css");
    locals.extraScripts.push("/js/not-real.js");
    assert.deepEqual(PAGE_DEFINITIONS.youlist.styles, EXPECTED_PAGES.youlist.styles);
    assert.deepEqual(PAGE_DEFINITIONS.youlist.scripts, EXPECTED_PAGES.youlist.scripts);
    assert.throws(() => pageLocals("missing-page"), /Unknown page definition/);
});

test("routes, controllers, and error middleware use page definitions instead of scattered asset arrays", async () => {
    const renderSources = [
        "src/routes/pages.routes.js",
        "src/controllers/auth.controller.js",
        "src/controllers/account.controller.js",
        "src/controllers/dashboard.controller.js",
        "src/controllers/youlist.controller.js",
        "src/routes/echotrace.routes.js",
        "src/controllers/storecalc.controller.js",
        "src/middleware/errorResponses.js"
    ];

    for (const relativePath of renderSources) {
        const source = await readFile(join(rootDir, relativePath), "utf8");
        assert.match(source, /pageLocals\(/, `${relativePath} should use pageLocals`);
        assert.doesNotMatch(source, /extraStyles\s*:/, `${relativePath} should not declare styles`);
        assert.doesNotMatch(source, /extraScripts\s*:/, `${relativePath} should not declare scripts`);
    }
});

test("active templates do not override page metadata or asset declarations", async () => {
    const templates = [
        "views/index.ejs",
        "views/archive.ejs",
        "views/contact.ejs",
        "views/privacy.ejs",
        "views/login.ejs",
        "views/register.ejs",
        "views/resend-verification.ejs",
        "views/check-email.ejs",
        "views/dashboard/index.ejs",
        "views/account/index.ejs",
        "views/account/deleted.ejs",
        "views/youlist/index.ejs",
        "views/echotrace/index.ejs",
        "views/storecalc/index.ejs",
        "views/errors/error.ejs"
    ];

    for (const relativePath of templates) {
        const template = await readFile(join(rootDir, relativePath), "utf8");
        assert.doesNotMatch(
            template,
            /include\([^)]*(?:title|bodyClass|extraStyles|extraScripts)/,
            `${relativePath} should consume render locals without overriding them`
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

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertRenderedPage(path, pageName, expectedStatus = 200) {
    const definition = EXPECTED_PAGES[pageName];
    const response = await fetch(`${baseUrl}${path}`, {
        redirect: "manual",
        headers: { accept: "text/html" }
    });
    assert.equal(response.status, expectedStatus, `${path} should return ${expectedStatus}`);
    const html = await response.text();

    assert.match(html, new RegExp(`<title>${escapeRegex(definition.title)}</title>`));
    assert.match(html, new RegExp(`<body class="${escapeRegex(definition.bodyClass)}">`));
    assert.match(html, /<link rel="stylesheet" href="\/styles\/main\.css">/);

    for (const style of definition.styles) {
        assert.match(html, new RegExp(`href="${escapeRegex(style)}"`));
    }
    for (const script of definition.scripts) {
        assert.match(html, new RegExp(`src="${escapeRegex(script)}"`));
    }

    return html;
}

test("public routes render the titles, body classes, and assets from page definitions", async () => {
    await assertRenderedPage("/", "home");
    await assertRenderedPage("/archive", "archive");
    await assertRenderedPage("/contact", "contact");
    const privacyHtml = await assertRenderedPage("/privacy", "privacy");
    assert.match(privacyHtml, /<link rel="canonical" href="https:\/\/phishtopia\.com\/privacy">/);
    assert.match(privacyHtml, /<meta name="description" content="Learn what Phishtopia collects/);
    assert.match(privacyHtml, /<meta property="og:title" content="Privacy \| Phishtopia">/);
    const deletedHtml = await assertRenderedPage("/account/deleted", "accountDeleted");
    assert.match(deletedHtml, /Your Phishtopia account has been deleted/);
    assert.match(deletedHtml, /<meta name="robots" content="noindex, nofollow">/);
    await assertRenderedPage("/auth/login", "login");
    await assertRenderedPage("/auth/register", "register");
    await assertRenderedPage("/auth/resend-verification", "resendVerification");
    await assertRenderedPage("/echotrace", "echotrace");
    await assertRenderedPage("/storecalc", "storecalc");
    await assertRenderedPage("/definitely-not-a-real-page", "error", 404);
});
