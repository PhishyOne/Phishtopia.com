import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createShowDashboard } from "../src/controllers/dashboard.controller.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

function fakeResponse() {
    return {
        statusCode: 200,
        view: null,
        locals: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        render(view, locals) {
            this.view = view;
            this.locals = locals;
            return this;
        },
        type() {
            return this;
        },
        send() {
            return this;
        }
    };
}

test("dashboard controller renders an app-neutral account home", async () => {
    const handler = createShowDashboard({
        getAccount: async userId => ({
            ok: true,
            account: {
                id: userId,
                username: "PhishyOne",
                email: "user@example.com",
                emailVerified: true,
                pendingEmail: null,
                role: "admin"
            }
        })
    });
    const response = fakeResponse();

    await handler({ session: { user: { id: 7 } } }, response);

    assert.equal(response.view, "dashboard/index");
    assert.equal(response.locals.title, "Dashboard | Phishtopia");
    assert.equal(response.locals.bodyClass, "dashboard");
    assert.deepEqual(response.locals.extraStyles, ["/styles/dashboard.css"]);
    assert.equal(response.locals.disableAnalytics, true);
    assert.equal(response.locals.robotsContent, "noindex, nofollow");
    assert.equal(response.locals.account.username, "PhishyOne");
});

test("dashboard prioritizes projects and links to feedback and account management", async () => {
    const template = await readFile(join(rootDir, "views/dashboard/index.ejs"), "utf8");

    for (const path of ["/account", "/contact", "/storecalc", "/echotrace", "/youlist"]) {
        assert.ok(template.includes(`href=\"${path}\"`), `dashboard should link to ${path}`);
    }

    assert.match(template, /Explore what’s here, try something new/);
    assert.ok(
        template.indexOf("dashboard-tools") < template.indexOf("dashboard-account-card"),
        "project tools should appear before account management in document order"
    );
    assert.doesNotMatch(template, /continue where you left off/i);
    assert.doesNotMatch(template, /current facility|saved orders|personal templates/i);
});

test("dashboard CSS keeps the hero compact and moves account management below projects on narrow screens", async () => {
    const css = await readFile(join(rootDir, "public/styles/dashboard.css"), "utf8");

    assert.match(css, /min-height:\s*205px/);
    assert.match(css, /grid-template-areas:\s*\n\s*"welcome"\s*\n\s*"tools"\s*\n\s*"account"/);
    assert.match(css, /@media \(max-width: 650px\)[\s\S]*min-height:\s*150px/);
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

test("dashboard requires login and preserves the destination", async () => {
    const response = await fetch(`${baseUrl}/dashboard`, { redirect: "manual" });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/auth/login?returnTo=%2Fdashboard");
});
