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
    login: {
        title: "Login",
        bodyClass: "auth",
        styles: [],
        scripts: ["/js/auth.js"]
    },
    register: {
        title: "Register",
        bodyClass: "register",
        styles: [],
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
        styles: [],
        scripts: []
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

test("routes and controllers use page definitions instead of scattered asset arrays", async () => {
    const renderSources = [
        "src/routes/pages.routes.js",
        "src/controllers/auth.controller.js",
        "src/controllers/youlist.controller.js",
        "src/routes/echotrace.routes.js",
        "src/controllers/storecalc.controller.js"
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
        "views/contact.ejs",
        "views/login.ejs",
        "views/register.ejs",
        "views/resend-verification.ejs",
        "views/check-email.ejs",
        "views/youlist/index.ejs",
        "views/echotrace/index.ejs",
        "views/storecalc/index.ejs"
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

async function assertRenderedPage(path, pageName) {
    const definition = EXPECTED_PAGES[pageName];
    const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
    assert.equal(response.status, 200, `${path} should return 200`);
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
}

test("public routes render the titles, body classes, and assets from page definitions", async () => {
    await assertRenderedPage("/", "home");
    await assertRenderedPage("/contact", "contact");
    await assertRenderedPage("/auth/login", "login");
    await assertRenderedPage("/auth/register", "register");
    await assertRenderedPage("/auth/resend-verification", "resendVerification");
    await assertRenderedPage("/echotrace", "echotrace");
    await assertRenderedPage("/storecalc", "storecalc");
});
